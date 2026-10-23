import { DatabaseManager } from '../storage/DatabaseManager';
import { SupplierParsedItem } from '../parser/XmlParserService';
import { ProductDelta } from '../types';

export class DiffEngine {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  public calculateDeltas(profileId: string, items: SupplierParsedItem[]): ProductDelta[] {
    const deltas: ProductDelta[] = [];
    const cacheMap = this.db.getProfileCacheMap(profileId);

    for (const item of items) {
      const cached = cacheMap.get(item.identifier) || null;

      const hasPriceChange = cached === null || cached.lastPrice !== item.price;
      const hasStockChange = cached === null || cached.lastStock !== item.stock;

      if (hasPriceChange || hasStockChange) {
        deltas.push({
          profileId,
          identifier: item.identifier,
          identifierField: item.identifierField,
          oldPrice: cached?.lastPrice,
          newPrice: item.price,
          oldStock: cached?.lastStock,
          newStock: item.stock,
          hasPriceChange,
          hasStockChange
        });
      }
    }

    return deltas;
  }

  public commitDeltas(profileId: string, deltas: ProductDelta[]): void {
    if (deltas.length === 0) return;
    this.db.batchUpdateCacheEntries(
      profileId,
      deltas.map(d => ({
        identifier: d.identifier,
        price: d.newPrice,
        stock: d.newStock
      }))
    );
  }
}
