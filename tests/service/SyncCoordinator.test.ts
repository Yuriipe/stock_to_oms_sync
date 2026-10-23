import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { SyncCoordinator } from '../../src/service/SyncCoordinator';
import { DatabaseManager } from '../../src/storage/DatabaseManager';
import { XmlParserService } from '../../src/parser/XmlParserService';
import { DiffEngine } from '../../src/diff/DiffEngine';
import { FeedProfile } from '../../src/types';
import { NbpRateService } from '../../src/service/NbpRateService';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('SyncCoordinator', () => {
  let db: DatabaseManager;
  let xmlParser: XmlParserService;
  let diffEngine: DiffEngine;
  let coordinator: SyncCoordinator;

  const testProfile: FeedProfile = {
    id: 'test-profile-1',
    name: 'Test Profile',
    enabled: true,
    sourceType: 'url',
    sourcePath: 'https://example.com/feed.xml',
    targetInventoryId: 999,
    targetWarehouseId: 'bl_123',
    targetPriceGroupId: 55,
    identifierField: 'sku',
    mapping: {
      itemTag: 'item',
      identifierField: 'sku',
      skuPath: 'sku',
      eanPath: 'ean',
      pricePath: 'price',
      stockPath: 'stock',
      namePath: 'name'
    },
    syncIntervalMinutes: 30
  };

  beforeEach(() => {
    vi.clearAllMocks();
    NbpRateService.clearCache();
    db = new DatabaseManager(':memory:');
    db.initialize();
    db.updateSettings({ baseLinkerToken: 'valid-token' });
    db.saveProfile(testProfile);

    xmlParser = new XmlParserService();
    diffEngine = new DiffEngine(db);
    coordinator = new SyncCoordinator(db, xmlParser, diffEngine);
  });

  it('should auto-create products in BaseLinker when XML has products that Base does not contain', async () => {
    const xml = `
      <catalog>
        <item>
          <sku>NEW-PROD-1</sku>
          <name>New Product 1</name>
          <price>49.99</price>
          <stock>15</stock>
        </item>
        <item>
          <sku>NEW-PROD-2</sku>
          <name>New Product 2 Zero Stock</name>
          <price>29.99</price>
          <stock>0</stock>
        </item>
      </catalog>
    `;

    // 1. Mock XML download
    mockedAxios.get.mockResolvedValueOnce({ data: xml });

    // 2. Mock BaseLinker fetchAllInventoryProducts -> returns empty catalog
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', products: {} }
    });

    // 3. Mock addInventoryProduct for NEW-PROD-1
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', product_id: 10001 }
    });

    // 4. Mock addInventoryProduct for NEW-PROD-2 (even with stock 0, it should be created)
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', product_id: 10002 }
    });

    const result = await coordinator.syncProfile(testProfile.id);

    expect(result.success).toBe(true);
    expect(result.itemsProcessed).toBe(2);
    expect(result.message).toContain('Created 2 new items in BaseLinker');

    // Check products in local SQLite DB
    const list = db.getBaseProductsList(testProfile.targetInventoryId);
    expect(list.total).toBe(2);
    const skus = list.products.map(p => p.sku);
    expect(skus).toContain('NEW-PROD-1');
    expect(skus).toContain('NEW-PROD-2');
  });

  it('should delete products from table if they no longer exist in Base or contain nothing except ID', async () => {
    // Pre-populate DB with an item that was deleted in Base and an item with no SKU/EAN
    db.upsertBaseProducts(testProfile.targetInventoryId, [
      { productId: 88881, sku: 'DELETED-IN-BASE' },
      { productId: 88882, sku: '', ean: '' } // contains nothing except ID
    ]);
    expect(db.getBaseProductsCount(testProfile.targetInventoryId)).toBe(2);

    const xml = `
      <catalog>
        <item>
          <sku>EXISTING-1</sku>
          <price>19.99</price>
          <stock>5</stock>
        </item>
      </catalog>
    `;

    mockedAxios.get.mockResolvedValueOnce({ data: xml });

    // Mock BaseLinker returning only EXISTING-1
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        status: 'SUCCESS',
        products: {
          '7777': { id: 7777, sku: 'EXISTING-1', ean: '' }
        }
      }
    });

    // Mock price update
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', counter: 1 }
    });

    // Mock stock update
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', counter: 1 }
    });

    const result = await coordinator.syncProfile(testProfile.id);

    expect(result.success).toBe(true);

    // DELETED-IN-BASE and empty product 88882 should be gone from table
    const list = db.getBaseProductsList(testProfile.targetInventoryId);
    expect(list.total).toBe(1);
    expect(list.products[0].productId).toBe(7777);
    expect(list.products[0].sku).toBe('EXISTING-1');
  });

  it('should auto-create products when item has empty SKU and falls back to product_id, even with lack of price', async () => {
    const xml = `
      <catalog>
        <item>
          <product_id>386333526</product_id>
          <name>Poduszka Masło Pluszowa</name>
          <sku></sku>
          <ean></ean>
          <stock>0</stock>
          <price>0</price>
        </item>
      </catalog>
    `;

    mockedAxios.get.mockResolvedValueOnce({ data: xml });
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', products: {} }
    });
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', product_id: 386333526 }
    });

    const result = await coordinator.syncProfile(testProfile.id);
    expect(result.success).toBe(true);
    expect(result.itemsProcessed).toBe(1);
    expect(result.message).toContain('Created 1 new items in BaseLinker');

    const list = db.getBaseProductsList(testProfile.targetInventoryId);
    expect(list.total).toBe(1);
    expect(list.products[0].productId).toBe(386333526);
    expect(list.products[0].sku).toBe('386333526');
  });

  it('should apply price multiplier and NBP exchange rate during sync', async () => {
    const priceProfile: FeedProfile = {
      ...testProfile,
      id: 'price-mod-profile',
      priceMultiplier: 1.20, // +20%
      priceCurrency: 'EUR'
    };
    db.saveProfile(priceProfile);

    // Mock NBP API response for EUR
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('api.nbp.pl')) {
        return {
          data: [{
            table: 'A',
            rates: [{ code: 'EUR', mid: 4.50 }]
          }]
        };
      }
      // Feed XML
      return {
        data: `
          <catalog>
            <item>
              <sku>EUR-PROD-1</sku>
              <name>Euro Item</name>
              <price>10.00</price>
              <stock>5</stock>
            </item>
          </catalog>
        `
      };
    });

    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', products: {} }
    });
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', product_id: 9901 }
    });

    const result = await coordinator.syncProfile(priceProfile.id);
    expect(result.success).toBe(true);

    // Calculated price: 10.00 (EUR) * 4.50 (rate) * 1.20 (multiplier) = 54.00 PLN
    const cached = db.getCacheEntry(priceProfile.id, 'EUR-PROD-1');
    expect(cached?.lastPrice).toBe(54.00);
  });

  it('should correctly divide when converting PLN to EUR', async () => {
    const plnToEurProfile: FeedProfile = {
      ...testProfile,
      id: 'pln-to-eur-profile',
      priceSourceCurrency: 'PLN',
      priceTargetCurrency: 'EUR',
      priceOperator: '*',
      priceModifierValue: 1.0
    };
    db.saveProfile(plnToEurProfile);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('api.nbp.pl')) {
        return {
          data: [{
            table: 'A',
            rates: [{ code: 'EUR', mid: 4.00 }]
          }]
        };
      }
      return {
        data: `
          <catalog>
            <item>
              <sku>PLN-PROD-1</sku>
              <price>100.00</price>
              <stock>5</stock>
            </item>
          </catalog>
        `
      };
    });

    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', products: {} }
    });
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', product_id: 9902 }
    });

    const result = await coordinator.syncProfile(plnToEurProfile.id);
    expect(result.success).toBe(true);

    // 100.00 PLN converted to EUR at 4.00 PLN/EUR -> 100 / 4.00 = 25.00 EUR
    const cached = db.getCacheEntry(plnToEurProfile.id, 'PLN-PROD-1');
    expect(cached?.lastPrice).toBe(25.00);
  });

  it('should apply division and plus/minus operators', async () => {
    const divProfile: FeedProfile = {
      ...testProfile,
      id: 'div-profile',
      priceSourceCurrency: 'PLN',
      priceTargetCurrency: 'PLN',
      priceOperator: '/',
      priceModifierValue: 2.0
    };
    db.saveProfile(divProfile);

    mockedAxios.get.mockImplementation(async () => ({
      data: `
        <catalog>
          <item>
            <sku>DIV-PROD-1</sku>
            <price>50.00</price>
            <stock>2</stock>
          </item>
        </catalog>
      `
    }));

    mockedAxios.post.mockResolvedValueOnce({ data: { status: 'SUCCESS', products: {} } });
    mockedAxios.post.mockResolvedValueOnce({ data: { status: 'SUCCESS', product_id: 9903 } });

    const result = await coordinator.syncProfile(divProfile.id);
    expect(result.success).toBe(true);
    // 50.00 / 2.0 = 25.00
    expect(db.getCacheEntry(divProfile.id, 'DIV-PROD-1')?.lastPrice).toBe(25.00);
  });

  it('should stop synchronization when requested', async () => {
    const slowProfile: FeedProfile = {
      ...testProfile,
      id: 'slow-profile'
    };
    db.saveProfile(slowProfile);

    mockedAxios.get.mockImplementation(async () => {
      // simulate stop before completion
      coordinator.stopSync(slowProfile.id);
      return {
        data: `
          <catalog>
            <item>
              <sku>SLOW-1</sku>
              <price>10.00</price>
              <stock>1</stock>
            </item>
          </catalog>
        `
      };
    });

    const result = await coordinator.syncProfile(slowProfile.id);
    expect(result.success).toBe(false);
    expect(result.message).toContain('przerwana');
  });

  it('should change stock to 0 during sync if availability tag value is false or 0, even with fixedStock', async () => {
    const availProfile: FeedProfile = {
      ...testProfile,
      id: 'avail-profile',
      fixedStock: 50,
      mapping: {
        ...testProfile.mapping,
        availabilityPath: 'availability'
      }
    };
    db.saveProfile(availProfile);

    // Initial cache entries so diff engine detects changes
    db.updateCacheEntry(availProfile.id, 'PROD-AVAIL-TRUE', 10.0, 5);
    db.updateCacheEntry(availProfile.id, 'PROD-AVAIL-FALSE', 10.0, 15);
    db.updateCacheEntry(availProfile.id, 'PROD-AVAIL-ZERO', 10.0, 15);

    mockedAxios.get.mockResolvedValueOnce({
      data: `
        <catalog>
          <item>
            <sku>PROD-AVAIL-TRUE</sku>
            <price>10.00</price>
            <stock>12</stock>
            <availability>true</availability>
          </item>
          <item>
            <sku>PROD-AVAIL-FALSE</sku>
            <price>10.00</price>
            <stock>15</stock>
            <availability>false</availability>
          </item>
          <item>
            <sku>PROD-AVAIL-ZERO</sku>
            <price>10.00</price>
            <stock>8</stock>
            <availability>0</availability>
          </item>
        </catalog>
      `
    });

    // 1. Mock fetchAllInventoryProducts returning the 3 existing products
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        status: 'SUCCESS',
        products: {
          '7001': { id: 7001, sku: 'PROD-AVAIL-TRUE', ean: '', name: 'True' },
          '7002': { id: 7002, sku: 'PROD-AVAIL-FALSE', ean: '', name: 'False' },
          '7003': { id: 7003, sku: 'PROD-AVAIL-ZERO', ean: '', name: 'Zero' }
        }
      }
    });

    // 2. Mock updateInventoryProductsStock
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: 'SUCCESS', counter: 3 }
    });

    const result = await coordinator.syncProfile(availProfile.id);
    expect(result.success).toBe(true);
    expect(result.itemsProcessed).toBe(3);

    // Verify cache has stock 0 for false and zero availability, and 50 (fixedStock) for true
    expect(db.getCacheEntry(availProfile.id, 'PROD-AVAIL-TRUE')?.lastStock).toBe(50);
    expect(db.getCacheEntry(availProfile.id, 'PROD-AVAIL-FALSE')?.lastStock).toBe(0);
    expect(db.getCacheEntry(availProfile.id, 'PROD-AVAIL-ZERO')?.lastStock).toBe(0);
  }, 15000);
});
