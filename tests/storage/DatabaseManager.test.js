"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const DatabaseManager_1 = require("../../src/storage/DatabaseManager");
(0, vitest_1.describe)('DatabaseManager & Storage Repository', () => {
    let dbManager;
    (0, vitest_1.beforeEach)(() => {
        // In-memory isolated database
        dbManager = new DatabaseManager_1.DatabaseManager(':memory:');
        dbManager.initialize();
    });
    (0, vitest_1.it)('should initialize tables without throwing', () => {
        const settings = dbManager.getSettings();
        (0, vitest_1.expect)(settings).toBeDefined();
        (0, vitest_1.expect)(settings.serverPort).toBe(3890);
        (0, vitest_1.expect)(settings.baseLinkerToken).toBe('');
    });
    (0, vitest_1.it)('should update and retrieve global settings', () => {
        dbManager.updateSettings({
            baseLinkerToken: 'test-token-123',
            autoStartOnBoot: true,
            minimizeToTray: true,
            serverPort: 4000
        });
        const settings = dbManager.getSettings();
        (0, vitest_1.expect)(settings.baseLinkerToken).toBe('test-token-123');
        (0, vitest_1.expect)(settings.autoStartOnBoot).toBe(true);
        (0, vitest_1.expect)(settings.serverPort).toBe(4000);
    });
    (0, vitest_1.it)('should create, list, update, and delete feed profiles', () => {
        const profile = {
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
        (0, vitest_1.expect)(profiles).toHaveLength(1);
        (0, vitest_1.expect)(profiles[0].id).toBe('profile-1');
        (0, vitest_1.expect)(profiles[0].mapping.itemTag).toBe('product');
        // Update profile
        profile.name = 'Updated Supplier Name';
        profile.syncIntervalMinutes = 60;
        dbManager.saveProfile(profile);
        const updated = dbManager.getProfileById('profile-1');
        (0, vitest_1.expect)(updated?.name).toBe('Updated Supplier Name');
        (0, vitest_1.expect)(updated?.syncIntervalMinutes).toBe(60);
        // Delete profile
        dbManager.deleteProfile('profile-1');
        (0, vitest_1.expect)(dbManager.getProfiles()).toHaveLength(0);
    });
    (0, vitest_1.it)('should store and query sync logs', () => {
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
        (0, vitest_1.expect)(logs).toHaveLength(1);
        (0, vitest_1.expect)(logs[0].itemsProcessed).toBe(150);
    });
});
