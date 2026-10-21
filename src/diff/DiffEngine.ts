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

    for (const item of items) {
      const cached = this.db.getCacheEntry(profileId, item.identifier);

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
    for (const delta of deltas) {
      this.db.updateCacheEntry(profileId, delta.identifier, delta.newPrice, delta.newStock);
    }
  }
}
