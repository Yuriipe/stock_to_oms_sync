import Database from 'better-sqlite3';
import { AppSettings, FeedProfile, SyncLogEntry } from '../types';

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath: string = 'boltline.sqlite') {
    this.db = new Database(dbPath);
  }

  public initialize(): void {
    // App Settings Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        baseLinkerToken TEXT NOT NULL DEFAULT '',
        autoStartOnBoot INTEGER NOT NULL DEFAULT 0,
        minimizeToTray INTEGER NOT NULL DEFAULT 1,
        serverPort INTEGER NOT NULL DEFAULT 3890,
        githubToken TEXT DEFAULT '',
        updateRepo TEXT DEFAULT 'https://github.com/Yuriipe/stock_to_oms_sync.git'
      );
    `);

    // Add columns if table already existed without them
    try {
      this.db.exec(`ALTER TABLE app_settings ADD COLUMN githubToken TEXT DEFAULT ''`);
    } catch {
      // Column may already exist
    }
    try {
      this.db.exec(`ALTER TABLE app_settings ADD COLUMN updateRepo TEXT DEFAULT 'https://github.com/Yuriipe/stock_to_oms_sync.git'`);
    } catch {
      // Column may already exist
    }

    // Ensure default settings row exists
    const settings = this.db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
    if (!settings) {
      this.db.prepare(`
        INSERT INTO app_settings (id, baseLinkerToken, autoStartOnBoot, minimizeToTray, serverPort, githubToken, updateRepo)
        VALUES (1, '', 0, 1, 3890, '', 'https://github.com/Yuriipe/stock_to_oms_sync.git')
      `).run();
    }

    // Feed Profiles Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feed_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sourceType TEXT NOT NULL,
        sourcePath TEXT NOT NULL,
        authHeader TEXT,
        targetInventoryId INTEGER NOT NULL,
        targetWarehouseId TEXT NOT NULL,
        targetPriceGroupId INTEGER NOT NULL,
        identifierField TEXT NOT NULL DEFAULT 'sku',
        mappingJson TEXT NOT NULL,
        syncIntervalMinutes INTEGER NOT NULL DEFAULT 30,
        fixedStock INTEGER DEFAULT NULL,
        lastSyncAt TEXT,
        lastSyncStatus TEXT,
        lastSyncMessage TEXT
      );
    `);

    try {
      this.db.exec(`ALTER TABLE feed_profiles ADD COLUMN fixedStock INTEGER DEFAULT NULL`);
    } catch {
      // Column may already exist
    }

    // BaseLinker Products Table (Persistent cache of BaseLinker items per inventory)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS baselinker_products (
        inventoryId INTEGER NOT NULL,
        productId INTEGER NOT NULL,
        sku TEXT,
        ean TEXT,
        hasImages INTEGER NOT NULL DEFAULT 0,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (inventoryId, productId)
      );
      CREATE INDEX IF NOT EXISTS idx_bl_sku ON baselinker_products(inventoryId, sku);
      CREATE INDEX IF NOT EXISTS idx_bl_ean ON baselinker_products(inventoryId, ean);
    `);

    try {
      this.db.exec(`ALTER TABLE baselinker_products ADD COLUMN hasImages INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column may already exist
    }

    // Sync Cache Table (Stores last known state per profile and identifier)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_cache (
        profileId TEXT NOT NULL,
        identifier TEXT NOT NULL,
        lastPrice REAL,
        lastStock INTEGER,
        lastSeenAt TEXT NOT NULL,
        PRIMARY KEY (profileId, identifier)
      );
    `);

    // Sync Execution Logs Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profileId TEXT,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        itemsProcessed INTEGER NOT NULL DEFAULT 0,
        pricesUpdated INTEGER NOT NULL DEFAULT 0,
        stocksUpdated INTEGER NOT NULL DEFAULT 0,
        message TEXT
      );
    `);
  }

  public getSettings(): AppSettings {
    const row = this.db.prepare(`
      SELECT baseLinkerToken, autoStartOnBoot, minimizeToTray, serverPort, githubToken, updateRepo
      FROM app_settings WHERE id = 1
    `).get() as {
      baseLinkerToken: string;
      autoStartOnBoot: number;
      minimizeToTray: number;
      serverPort: number;
      githubToken?: string;
      updateRepo?: string;
    };

    return {
      baseLinkerToken: row.baseLinkerToken,
      autoStartOnBoot: Boolean(row.autoStartOnBoot),
      minimizeToTray: Boolean(row.minimizeToTray),
      serverPort: row.serverPort,
      githubToken: row.githubToken || '',
      updateRepo: row.updateRepo || 'https://github.com/Yuriipe/stock_to_oms_sync.git'
    };
  }

  public updateSettings(settings: Partial<AppSettings>): void {
    const current = this.getSettings();
    const updated = { ...current, ...settings };

    this.db.prepare(`
      UPDATE app_settings
      SET baseLinkerToken = ?, autoStartOnBoot = ?, minimizeToTray = ?, serverPort = ?, githubToken = ?, updateRepo = ?
      WHERE id = 1
    `).run(
      updated.baseLinkerToken,
      updated.autoStartOnBoot ? 1 : 0,
      updated.minimizeToTray ? 1 : 0,
      updated.serverPort,
      updated.githubToken || '',
      updated.updateRepo || ''
    );
  }

  public getProfiles(): FeedProfile[] {
    const rows = this.db.prepare('SELECT * FROM feed_profiles').all() as Array<{
      id: string;
      name: string;
      enabled: number;
      sourceType: 'url' | 'file';
      sourcePath: string;
      authHeader?: string;
      targetInventoryId: number;
      targetWarehouseId: string;
      targetPriceGroupId: number;
      identifierField: 'sku' | 'ean';
      mappingJson: string;
      syncIntervalMinutes: number;
      fixedStock?: number | null;
      lastSyncAt?: string;
      lastSyncStatus?: 'idle' | 'running' | 'success' | 'error';
      lastSyncMessage?: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: Boolean(r.enabled),
      sourceType: r.sourceType,
      sourcePath: r.sourcePath,
      authHeader: r.authHeader || undefined,
      targetInventoryId: r.targetInventoryId,
      targetWarehouseId: r.targetWarehouseId,
      targetPriceGroupId: r.targetPriceGroupId,
      identifierField: r.identifierField,
      mapping: JSON.parse(r.mappingJson),
      syncIntervalMinutes: r.syncIntervalMinutes,
      fixedStock: r.fixedStock !== null && r.fixedStock !== undefined ? Number(r.fixedStock) : undefined,
      lastSyncAt: r.lastSyncAt || undefined,
      lastSyncStatus: r.lastSyncStatus || undefined,
      lastSyncMessage: r.lastSyncMessage || undefined
    }));
  }

  public getProfileById(id: string): FeedProfile | null {
    const row = this.db.prepare('SELECT * FROM feed_profiles WHERE id = ?').get(id) as {
      id: string;
      name: string;
      enabled: number;
      sourceType: 'url' | 'file';
      sourcePath: string;
      authHeader?: string;
      targetInventoryId: number;
      targetWarehouseId: string;
      targetPriceGroupId: number;
      identifierField: 'sku' | 'ean';
      mappingJson: string;
      syncIntervalMinutes: number;
      fixedStock?: number | null;
      lastSyncAt?: string;
      lastSyncStatus?: 'idle' | 'running' | 'success' | 'error';
      lastSyncMessage?: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      sourceType: row.sourceType,
      sourcePath: row.sourcePath,
      authHeader: row.authHeader || undefined,
      targetInventoryId: row.targetInventoryId,
      targetWarehouseId: row.targetWarehouseId,
      targetPriceGroupId: row.targetPriceGroupId,
      identifierField: row.identifierField,
      mapping: JSON.parse(row.mappingJson),
      syncIntervalMinutes: row.syncIntervalMinutes,
      fixedStock: row.fixedStock !== null && row.fixedStock !== undefined ? Number(row.fixedStock) : undefined,
      lastSyncAt: row.lastSyncAt || undefined,
      lastSyncStatus: row.lastSyncStatus || undefined,
      lastSyncMessage: row.lastSyncMessage || undefined
    };
  }

  public saveProfile(profile: FeedProfile): void {
    const stmt = this.db.prepare(`
      INSERT INTO feed_profiles (
        id, name, enabled, sourceType, sourcePath, authHeader,
        targetInventoryId, targetWarehouseId, targetPriceGroupId,
        identifierField, mappingJson, syncIntervalMinutes, fixedStock,
        lastSyncAt, lastSyncStatus, lastSyncMessage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        sourceType = excluded.sourceType,
        sourcePath = excluded.sourcePath,
        authHeader = excluded.authHeader,
        targetInventoryId = excluded.targetInventoryId,
        targetWarehouseId = excluded.targetWarehouseId,
        targetPriceGroupId = excluded.targetPriceGroupId,
        identifierField = excluded.identifierField,
        mappingJson = excluded.mappingJson,
        syncIntervalMinutes = excluded.syncIntervalMinutes,
        fixedStock = excluded.fixedStock,
        lastSyncAt = excluded.lastSyncAt,
        lastSyncStatus = excluded.lastSyncStatus,
        lastSyncMessage = excluded.lastSyncMessage
    `);

    stmt.run(
      profile.id,
      profile.name,
      profile.enabled ? 1 : 0,
      profile.sourceType,
      profile.sourcePath,
      profile.authHeader || null,
      profile.targetInventoryId,
      profile.targetWarehouseId,
      profile.targetPriceGroupId,
      profile.identifierField,
      JSON.stringify(profile.mapping),
      profile.syncIntervalMinutes,
      profile.fixedStock !== undefined && profile.fixedStock !== null ? Number(profile.fixedStock) : null,
      profile.lastSyncAt || null,
      profile.lastSyncStatus || null,
      profile.lastSyncMessage || null
    );
  }

  public deleteProfile(id: string): void {
    this.db.prepare('DELETE FROM feed_profiles WHERE id = ?').run(id);
  }

  public addSyncLog(entry: SyncLogEntry): void {
    this.db.prepare(`
      INSERT INTO sync_logs (profileId, timestamp, status, itemsProcessed, pricesUpdated, stocksUpdated, message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.profileId,
      entry.timestamp,
      entry.status,
      entry.itemsProcessed,
      entry.pricesUpdated,
      entry.stocksUpdated,
      entry.message
    );
  }

  public getSyncLogs(profileId?: string, limit: number = 50): SyncLogEntry[] {
    const query = profileId
      ? 'SELECT * FROM sync_logs WHERE profileId = ? ORDER BY id DESC LIMIT ?'
      : 'SELECT * FROM sync_logs ORDER BY id DESC LIMIT ?';

    const rows = profileId
      ? (this.db.prepare(query).all(profileId, limit) as SyncLogEntry[])
      : (this.db.prepare(query).all(limit) as SyncLogEntry[]);

    return rows;
  }

  public getCacheEntry(profileId: string, identifier: string): { lastPrice?: number; lastStock?: number } | null {
    const row = this.db.prepare(`
      SELECT lastPrice, lastStock FROM sync_cache WHERE profileId = ? AND identifier = ?
    `).get(profileId, identifier) as { lastPrice: number | null; lastStock: number | null } | undefined;

    if (!row) return null;
    return {
      lastPrice: row.lastPrice ?? undefined,
      lastStock: row.lastStock ?? undefined
    };
  }

  public updateCacheEntry(profileId: string, identifier: string, price?: number, stock?: number): void {
    this.db.prepare(`
      INSERT INTO sync_cache (profileId, identifier, lastPrice, lastStock, lastSeenAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profileId, identifier) DO UPDATE SET
        lastPrice = COALESCE(excluded.lastPrice, sync_cache.lastPrice),
        lastStock = COALESCE(excluded.lastStock, sync_cache.lastStock),
        lastSeenAt = excluded.lastSeenAt
    `).run(profileId, identifier, price ?? null, stock ?? null, new Date().toISOString());
  }

  public close(): void {
    this.db.close();
  }

  // BaseLinker Products Cache Methods
  public getBaseProductsCount(inventoryId: number): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM baselinker_products WHERE inventoryId = ?').get(inventoryId) as { cnt: number } | undefined;
    return row?.cnt || 0;
  }

  public getBaseProductsMultiMap(inventoryId: number, identifierField: 'sku' | 'ean'): Map<string, number[]> {
    const field = identifierField === 'sku' ? 'sku' : 'ean';
    const rows = this.db.prepare(`
      SELECT productId, ${field} as identifier
      FROM baselinker_products
      WHERE inventoryId = ? AND ${field} IS NOT NULL AND ${field} != ''
    `).all(inventoryId) as Array<{ productId: number; identifier: string }>;

    const map = new Map<string, number[]>();
    for (const r of rows) {
      if (r.identifier) {
        const key = r.identifier.trim();
        const existing = map.get(key);
        if (existing) {
          existing.push(r.productId);
        } else {
          map.set(key, [r.productId]);
        }
      }
    }
    return map;
  }

  public getBaseProductsMap(inventoryId: number, identifierField: 'sku' | 'ean'): Map<string, number> {
    const field = identifierField === 'sku' ? 'sku' : 'ean';
    const rows = this.db.prepare(`
      SELECT productId, ${field} as identifier
      FROM baselinker_products
      WHERE inventoryId = ? AND ${field} IS NOT NULL AND ${field} != ''
    `).all(inventoryId) as Array<{ productId: number; identifier: string }>;

    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.identifier) {
        map.set(r.identifier.trim(), r.productId);
      }
    }
    return map;
  }

  public getBaseProductsInfoMultiMap(
    inventoryId: number,
    identifierField: 'sku' | 'ean'
  ): Map<string, Array<{ productId: number; hasImages: boolean }>> {
    const field = identifierField === 'sku' ? 'sku' : 'ean';
    const rows = this.db.prepare(`
      SELECT productId, ${field} as identifier, hasImages
      FROM baselinker_products
      WHERE inventoryId = ? AND ${field} IS NOT NULL AND ${field} != ''
    `).all(inventoryId) as Array<{ productId: number; identifier: string; hasImages: number }>;

    const map = new Map<string, Array<{ productId: number; hasImages: boolean }>>();
    for (const r of rows) {
      if (r.identifier) {
        const key = r.identifier.trim();
        const existing = map.get(key);
        const item = { productId: r.productId, hasImages: Boolean(r.hasImages) };
        if (existing) {
          existing.push(item);
        } else {
          map.set(key, [item]);
        }
      }
    }
    return map;
  }

  public markProductHasImages(inventoryId: number, productId: number, hasImages: boolean = true): void {
    this.db.prepare(`
      UPDATE baselinker_products
      SET hasImages = ?
      WHERE inventoryId = ? AND productId = ?
    `).run(hasImages ? 1 : 0, inventoryId, productId);
  }

  public upsertBaseProducts(
    inventoryId: number,
    products: Array<{ productId: number; sku?: string; ean?: string; hasImages?: boolean }>
  ): void {
    if (products.length === 0) return;
    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO baselinker_products (inventoryId, productId, sku, ean, hasImages, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(inventoryId, productId) DO UPDATE SET
        sku = excluded.sku,
        ean = excluded.ean,
        hasImages = CASE WHEN excluded.hasImages = 1 THEN 1 ELSE baselinker_products.hasImages END,
        updatedAt = excluded.updatedAt
    `);

    const insertMany = this.db.transaction((items: Array<{ productId: number; sku?: string; ean?: string; hasImages?: boolean }>) => {
      for (const item of items) {
        insert.run(
          inventoryId,
          item.productId,
          item.sku || null,
          item.ean || null,
          item.hasImages ? 1 : 0,
          now
        );
      }
    });

    insertMany(products);
  }

  /**
   * Reconciles the local SQLite BaseLinker products cache with current products from BaseLinker.
   * - Deletes any products that contain nothing except ID (missing both SKU and EAN).
   * - Deletes any cached products for this inventory that no longer exist in BaseLinker.
   * - Upserts current valid products.
   */
  public syncBaseProducts(
    inventoryId: number,
    products: Array<{ productId: number; sku?: string; ean?: string }>
  ): { updated: number; deleted: number } {
    // Filter out products containing nothing except ID (both SKU and EAN missing/empty)
    const validProducts = products.filter(
      p => (p.sku && p.sku.trim() !== '') || (p.ean && p.ean.trim() !== '')
    );

    const now = new Date().toISOString();
    let deletedCount = 0;

    const runSync = this.db.transaction(() => {
      // 1. Delete products in this inventory that have empty SKU and empty EAN (only an ID)
      const cleanEmpty = this.db.prepare(`
        DELETE FROM baselinker_products
        WHERE inventoryId = ? AND (sku IS NULL OR trim(sku) = '') AND (ean IS NULL OR trim(ean) = '')
      `).run(inventoryId);
      deletedCount += cleanEmpty.changes;

      // 2. Delete products that no longer exist in BaseLinker
      if (validProducts.length === 0) {
        const delAll = this.db.prepare('DELETE FROM baselinker_products WHERE inventoryId = ?').run(inventoryId);
        deletedCount += delAll.changes;
      } else {
        const existingRows = this.db.prepare(
          'SELECT productId FROM baselinker_products WHERE inventoryId = ?'
        ).all(inventoryId) as Array<{ productId: number }>;

        const currentSet = new Set(validProducts.map(p => p.productId));
        const idsToDelete = existingRows.map(r => r.productId).filter(id => !currentSet.has(id));

        if (idsToDelete.length > 0) {
          const delStmt = this.db.prepare('DELETE FROM baselinker_products WHERE inventoryId = ? AND productId = ?');
          for (const id of idsToDelete) {
            delStmt.run(inventoryId, id);
          }
          deletedCount += idsToDelete.length;
        }

        // 3. Upsert valid products
        const insert = this.db.prepare(`
          INSERT INTO baselinker_products (inventoryId, productId, sku, ean, updatedAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(inventoryId, productId) DO UPDATE SET
            sku = excluded.sku,
            ean = excluded.ean,
            updatedAt = excluded.updatedAt
        `);

        for (const item of validProducts) {
          insert.run(
            inventoryId,
            item.productId,
            item.sku ? item.sku.trim() : null,
            item.ean ? item.ean.trim() : null,
            now
          );
        }
      }
    });

    runSync();
    return { updated: validProducts.length, deleted: deletedCount };
  }

  public deleteBaseProduct(inventoryId: number, productId: number): boolean {
    const res = this.db.prepare('DELETE FROM baselinker_products WHERE inventoryId = ? AND productId = ?').run(inventoryId, productId);
    return res.changes > 0;
  }

  public deleteEmptyBaseProducts(inventoryId: number): number {
    const res = this.db.prepare(`
      DELETE FROM baselinker_products
      WHERE inventoryId = ? AND (sku IS NULL OR trim(sku) = '') AND (ean IS NULL OR trim(ean) = '')
    `).run(inventoryId);
    return res.changes;
  }

  public saveSingleBaseProduct(inventoryId: number, productId: number, sku?: string, ean?: string, hasImages?: boolean): void {
    if ((!sku || sku.trim() === '') && (!ean || ean.trim() === '')) {
      return;
    }
    this.upsertBaseProducts(inventoryId, [{ productId, sku: sku?.trim(), ean: ean?.trim(), hasImages }]);
  }

  public getBaseProductsList(inventoryId: number, limit: number = 100, offset: number = 0): { total: number; products: Array<{ productId: number; sku?: string; ean?: string; updatedAt: string }> } {
    const totalRow = this.db.prepare('SELECT COUNT(*) as cnt FROM baselinker_products WHERE inventoryId = ?').get(inventoryId) as { cnt: number } | undefined;
    const total = totalRow?.cnt || 0;

    const rows = this.db.prepare(`
      SELECT productId, sku, ean, updatedAt
      FROM baselinker_products
      WHERE inventoryId = ?
      ORDER BY productId DESC
      LIMIT ? OFFSET ?
    `).all(inventoryId, limit, offset) as Array<{ productId: number; sku: string | null; ean: string | null; updatedAt: string }>;

    return {
      total,
      products: rows.map(r => ({
        productId: r.productId,
        sku: r.sku || undefined,
        ean: r.ean || undefined,
        updatedAt: r.updatedAt
      }))
    };
  }
}
