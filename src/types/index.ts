export interface XmlFieldMapping {
  itemTag: string;
  identifierField: 'sku' | 'ean';
  skuPath: string;
  eanPath: string;
  pricePath: string;
  stockPath: string;
  namePath?: string;
}

export interface FeedProfile {
  id: string;
  name: string;
  enabled: boolean;
  sourceType: 'url' | 'file';
  sourcePath: string;
  authHeader?: string;
  targetInventoryId: number;
  targetWarehouseId: string;
  targetPriceGroupId: number;
  identifierField: 'sku' | 'ean';
  mapping: XmlFieldMapping;
  syncIntervalMinutes: number;
  fixedStock?: number | null;
  lastSyncAt?: string;
  lastSyncStatus?: 'idle' | 'running' | 'success' | 'error';
  lastSyncMessage?: string;
}

export interface AppSettings {
  baseLinkerToken: string;
  autoStartOnBoot: boolean;
  minimizeToTray: boolean;
  serverPort: number;
  githubToken?: string;
  updateRepo?: string;
}

export interface ProductDelta {
  profileId: string;
  identifier: string; // SKU or EAN value
  identifierField: 'sku' | 'ean';
  oldPrice?: number;
  newPrice?: number;
  oldStock?: number;
  newStock?: number;
  hasPriceChange: boolean;
  hasStockChange: boolean;
}

export interface SyncLogEntry {
  id?: number;
  profileId: string;
  timestamp: string;
  status: 'success' | 'error';
  itemsProcessed: number;
  pricesUpdated: number;
  stocksUpdated: number;
  message: string;
}
