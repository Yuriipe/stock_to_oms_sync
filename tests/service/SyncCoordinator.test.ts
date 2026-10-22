import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { SyncCoordinator } from '../../src/service/SyncCoordinator';
import { DatabaseManager } from '../../src/storage/DatabaseManager';
import { XmlParserService } from '../../src/parser/XmlParserService';
import { DiffEngine } from '../../src/diff/DiffEngine';
import { FeedProfile } from '../../src/types';

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
});
