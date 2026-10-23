import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../../src/storage/DatabaseManager';
import { FeedProfile } from '../../src/types';

describe('DatabaseManager & Storage Repository', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    // In-memory isolated database
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();
  });

  it('should initialize tables without throwing', () => {
    const settings = dbManager.getSettings();
    expect(settings).toBeDefined();
    expect(settings.serverPort).toBe(3890);
    expect(settings.baseLinkerToken).toBe('');
  });

  it('should update and retrieve global settings', () => {
    dbManager.updateSettings({
      baseLinkerToken: 'test-token-123',
      autoStartOnBoot: true,
      minimizeToTray: true,
      serverPort: 4000
    });

    const settings = dbManager.getSettings();
    expect(settings.baseLinkerToken).toBe('test-token-123');
    expect(settings.autoStartOnBoot).toBe(true);
    expect(settings.serverPort).toBe(4000);
  });

  it('should create, list, update, and delete feed profiles', () => {
    const profile: FeedProfile = {
      id: 'profile-1',
      name: 'Supplier XML Feed 1',
      enabled: true,
      sourceType: 'url',
      sourcePath: 'https://example.com/feed.xml',
      targetInventoryId: 101,
      targetWarehouseId: 'bl_1',
      targetPriceGroupId: 201,
      identifierField: 'sku',
      mapping: {
        itemTag: 'product',
        identifierField: 'sku',
        skuPath: 'sku',
        eanPath: 'ean',
        pricePath: 'price',
        stockPath: 'qty'
      },
      syncIntervalMinutes: 30
    };

    dbManager.saveProfile(profile);

    const profiles = dbManager.getProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe('profile-1');
    expect(profiles[0].mapping.itemTag).toBe('product');

    // Update profile
    profile.name = 'Updated Supplier Name';
    profile.syncIntervalMinutes = 60;
    dbManager.saveProfile(profile);

    const updated = dbManager.getProfileById('profile-1');
    expect(updated?.name).toBe('Updated Supplier Name');
    expect(updated?.syncIntervalMinutes).toBe(60);

    // Delete profile
    dbManager.deleteProfile('profile-1');
    expect(dbManager.getProfiles()).toHaveLength(0);
  });

  it('should save and retrieve price multiplier, currency, and group modifiers', () => {
    const profile: FeedProfile = {
      id: 'profile-price-test',
      name: 'Price Profile',
      enabled: true,
      sourceType: 'url',
      sourcePath: 'https://example.com/feed.xml',
      targetInventoryId: 101,
      targetWarehouseId: 'bl_1',
      targetPriceGroupId: 201,
      identifierField: 'sku',
      mapping: {
        itemTag: 'product',
        identifierField: 'sku',
        skuPath: 'sku',
        eanPath: 'ean',
        pricePath: 'price',
        stockPath: 'qty'
      },
      syncIntervalMinutes: 30,
      priceMultiplier: 1.25,
      priceCurrency: 'EUR',
      priceSourceCurrency: 'EUR',
      priceTargetCurrency: 'PLN',
      priceOperator: '/',
      priceModifierValue: 1.25,
      groupPriceModifiers: {
        'Elektronika': 1.15,
        'Akcesoria': 1.30
      }
    };

    dbManager.saveProfile(profile);

    const retrieved = dbManager.getProfileById('profile-price-test');
    expect(retrieved).toBeDefined();
    expect(retrieved?.priceMultiplier).toBe(1.25);
    expect(retrieved?.priceCurrency).toBe('EUR');
    expect(retrieved?.priceSourceCurrency).toBe('EUR');
    expect(retrieved?.priceTargetCurrency).toBe('PLN');
    expect(retrieved?.priceOperator).toBe('/');
    expect(retrieved?.priceModifierValue).toBe(1.25);
    expect(retrieved?.groupPriceModifiers).toEqual({
      'Elektronika': 1.15,
      'Akcesoria': 1.30
    });
  });

  it('should store and query sync logs', () => {
    dbManager.addSyncLog({
      profileId: 'profile-1',
      timestamp: new Date().toISOString(),
      status: 'success',
      itemsProcessed: 150,
      pricesUpdated: 10,
      stocksUpdated: 25,
      message: 'Sync completed successfully'
    });

    const logs = dbManager.getSyncLogs('profile-1', 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].itemsProcessed).toBe(150);
  });

  it('should support multiple products with identical SKU in getBaseProductsMultiMap', () => {
    dbManager.upsertBaseProducts(101, [
      { productId: 1001, sku: 'ART-7714' },
      { productId: 1002, sku: 'ART-7714' },
      { productId: 1003, sku: 'EASY-99' }
    ]);

    const multiMap = dbManager.getBaseProductsMultiMap(101, 'sku');
    expect(multiMap.get('ART-7714')).toEqual([1001, 1002]);
    expect(multiMap.get('EASY-99')).toEqual([1003]);
  });

  it('should reconcile BaseLinker products with syncBaseProducts, deleting removed and empty items', () => {
    // Initial cache with 3 items: 1 normal, 1 to be removed from BaseLinker, 1 empty (only ID)
    dbManager.upsertBaseProducts(101, [
      { productId: 1001, sku: 'SKU-A' },
      { productId: 1002, sku: 'SKU-TO-DELETE' },
      { productId: 1003, sku: '', ean: '' } // contains nothing except ID
    ]);

    expect(dbManager.getBaseProductsCount(101)).toBe(3);

    // Sync with fresh BaseLinker state: only productId 1001 and new 1004 exist
    const result = dbManager.syncBaseProducts(101, [
      { productId: 1001, sku: 'SKU-A-UPDATED' },
      { productId: 1004, sku: 'SKU-NEW' }
    ]);

    expect(result.updated).toBe(2);
    expect(result.deleted).toBe(2); // 1003 (empty) and 1002 (no longer in Base)
    expect(dbManager.getBaseProductsCount(101)).toBe(2);

    const list = dbManager.getBaseProductsList(101);
    const ids = list.products.map(p => p.productId);
    expect(ids).toContain(1001);
    expect(ids).toContain(1004);
    expect(ids).not.toContain(1002);
    expect(ids).not.toContain(1003);
  });

  it('should delete a single product with deleteBaseProduct', () => {
    dbManager.upsertBaseProducts(101, [{ productId: 5001, sku: 'SKU-5001' }]);
    expect(dbManager.getBaseProductsCount(101)).toBe(1);

    const deleted = dbManager.deleteBaseProduct(101, 5001);
    expect(deleted).toBe(true);
    expect(dbManager.getBaseProductsCount(101)).toBe(0);
  });

  it('should clean up products with missing SKU and EAN with deleteEmptyBaseProducts', () => {
    dbManager.upsertBaseProducts(101, [
      { productId: 6001, sku: 'VALID' },
      { productId: 6002, sku: '', ean: '' },
      { productId: 6003, sku: undefined, ean: undefined }
    ]);

    expect(dbManager.getBaseProductsCount(101)).toBe(3);

    const cleaned = dbManager.deleteEmptyBaseProducts(101);
    expect(cleaned).toBe(2);
    expect(dbManager.getBaseProductsCount(101)).toBe(1);
  });

  it('should refuse to save products containing nothing except ID in saveSingleBaseProduct', () => {
    dbManager.saveSingleBaseProduct(101, 7001, '', '');
    expect(dbManager.getBaseProductsCount(101)).toBe(0);

    dbManager.saveSingleBaseProduct(101, 7002, 'SKU-VALID', undefined);
    expect(dbManager.getBaseProductsCount(101)).toBe(1);
  });
});
