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
});
