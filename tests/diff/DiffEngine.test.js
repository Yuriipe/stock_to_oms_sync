"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const DiffEngine_1 = require("../../src/diff/DiffEngine");
const DatabaseManager_1 = require("../../src/storage/DatabaseManager");
(0, vitest_1.describe)('DiffEngine', () => {
    let dbManager;
    let diffEngine;
    (0, vitest_1.beforeEach)(() => {
        dbManager = new DatabaseManager_1.DatabaseManager(':memory:');
        dbManager.initialize();
        diffEngine = new DiffEngine_1.DiffEngine(dbManager);
    });
    (0, vitest_1.it)('should detect both price and stock changes against cache', () => {
        // Initial cache state
        dbManager.updateCacheEntry('prof-1', 'SKU-001', 50.0, 10);
        const incoming = [
            {
                identifier: 'SKU-001',
                identifierField: 'sku',
                price: 55.0, // changed
                stock: 5 // changed
            },
            {
                identifier: 'SKU-002',
                identifierField: 'sku',
                price: 100.0, // new item
                stock: 20
            }
        ];
        const deltas = diffEngine.calculateDeltas('prof-1', incoming);
        (0, vitest_1.expect)(deltas).toHaveLength(2);
        const item1 = deltas.find((d) => d.identifier === 'SKU-001');
        (0, vitest_1.expect)(item1?.hasPriceChange).toBe(true);
        (0, vitest_1.expect)(item1?.oldPrice).toBe(50.0);
        (0, vitest_1.expect)(item1?.newPrice).toBe(55.0);
        (0, vitest_1.expect)(item1?.hasStockChange).toBe(true);
        (0, vitest_1.expect)(item1?.oldStock).toBe(10);
        (0, vitest_1.expect)(item1?.newStock).toBe(5);
        const item2 = deltas.find((d) => d.identifier === 'SKU-002');
        (0, vitest_1.expect)(item2?.hasPriceChange).toBe(true);
        (0, vitest_1.expect)(item2?.hasStockChange).toBe(true);
    });
    (0, vitest_1.it)('should omit deltas when price and stock remain identical', () => {
        dbManager.updateCacheEntry('prof-1', 'SKU-UNCHANGED', 30.0, 50);
        const incoming = [
            {
                identifier: 'SKU-UNCHANGED',
                identifierField: 'sku',
                price: 30.0,
                stock: 50
            }
        ];
        const deltas = diffEngine.calculateDeltas('prof-1', incoming);
        (0, vitest_1.expect)(deltas).toHaveLength(0);
    });
    (0, vitest_1.it)('should commit deltas to cache', () => {
        const incoming = [
            {
                identifier: 'SKU-COMMITTED',
                identifierField: 'sku',
                price: 99.99,
                stock: 12
            }
        ];
        const deltas = diffEngine.calculateDeltas('prof-1', incoming);
        diffEngine.commitDeltas('prof-1', deltas);
        const cached = dbManager.getCacheEntry('prof-1', 'SKU-COMMITTED');
        (0, vitest_1.expect)(cached?.lastPrice).toBe(99.99);
        (0, vitest_1.expect)(cached?.lastStock).toBe(12);
    });
});
