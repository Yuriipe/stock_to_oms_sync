import { describe, it, expect, beforeEach } from 'vitest';
import { DiffEngine } from '../../src/diff/DiffEngine';
import { DatabaseManager } from '../../src/storage/DatabaseManager';
import { SupplierParsedItem } from '../../src/parser/XmlParserService';

describe('DiffEngine', () => {
  let dbManager: DatabaseManager;
  let diffEngine: DiffEngine;

  beforeEach(() => {
    dbManager = new DatabaseManager(':memory:');
    dbManager.initialize();
    diffEngine = new DiffEngine(dbManager);
  });

  it('should detect both price and stock changes against cache', () => {
    // Initial cache state
    dbManager.updateCacheEntry('prof-1', 'SKU-001', 50.0, 10);

    const incoming: SupplierParsedItem[] = [
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

    expect(deltas).toHaveLength(2);

    const item1 = deltas.find((d) => d.identifier === 'SKU-001');
    expect(item1?.hasPriceChange).toBe(true);
    expect(item1?.oldPrice).toBe(50.0);
    expect(item1?.newPrice).toBe(55.0);
    expect(item1?.hasStockChange).toBe(true);
    expect(item1?.oldStock).toBe(10);
    expect(item1?.newStock).toBe(5);

    const item2 = deltas.find((d) => d.identifier === 'SKU-002');
    expect(item2?.hasPriceChange).toBe(true);
    expect(item2?.hasStockChange).toBe(true);
  });

  it('should omit deltas when price and stock remain identical', () => {
    dbManager.updateCacheEntry('prof-1', 'SKU-UNCHANGED', 30.0, 50);

    const incoming: SupplierParsedItem[] = [
      {
        identifier: 'SKU-UNCHANGED',
        identifierField: 'sku',
        price: 30.0,
        stock: 50
      }
    ];

    const deltas = diffEngine.calculateDeltas('prof-1', incoming);
    expect(deltas).toHaveLength(0);
  });

  it('should commit deltas to cache', () => {
    const incoming: SupplierParsedItem[] = [
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
    expect(cached?.lastPrice).toBe(99.99);
    expect(cached?.lastStock).toBe(12);
  });
});
