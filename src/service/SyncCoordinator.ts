import fs from 'fs';
import axios from 'axios';
import { DatabaseManager } from '../storage/DatabaseManager';
import { BaseLinkerClient } from '../baselinker/BaseLinkerClient';
import { resolveLocalFilePath } from '../utils/fileResolver';
import { XmlParserService } from '../parser/XmlParserService';
import { DiffEngine } from '../diff/DiffEngine';
import { FeedProfile } from '../types';

export interface SyncExecutionResult {
  profileId: string;
  success: boolean;
  itemsProcessed: number;
  pricesUpdated: number;
  stocksUpdated: number;
  message: string;
}

export class SyncCoordinator {
  private db: DatabaseManager;
  private xmlParser: XmlParserService;
  private diffEngine: DiffEngine;

  constructor(db: DatabaseManager, xmlParser: XmlParserService, diffEngine: DiffEngine) {
    this.db = db;
    this.xmlParser = xmlParser;
    this.diffEngine = diffEngine;
  }

  private async loadXmlContent(profile: FeedProfile): Promise<string> {
    if (profile.sourceType === 'file') {
      const resolvedPath = resolveLocalFilePath(profile.sourcePath);
      if (!resolvedPath) {
        throw new Error(`Local file not found: ${profile.sourcePath}`);
      }
      return fs.readFileSync(resolvedPath, 'utf-8');
    } else {
      const headers: Record<string, string> = {};
      if (profile.authHeader) {
        headers['Authorization'] = profile.authHeader;
      }
      const response = await axios.get(profile.sourcePath, {
        headers,
        timeout: 60000,
        responseType: 'text'
      });
      return response.data;
    }
  }

  public async syncProfile(profileId: string): Promise<SyncExecutionResult> {
    const profile = this.db.getProfileById(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    const settings = this.db.getSettings();
    if (!settings.baseLinkerToken) {
      throw new Error('BaseLinker API token is not configured in settings.');
    }

    const client = new BaseLinkerClient(settings.baseLinkerToken);

    try {
      // 1. Fetch XML
      const xmlData = await this.loadXmlContent(profile);

      // 2. Parse items using profile mapping
      const items = this.xmlParser.parseXml(xmlData, profile.mapping);
      if (items.length === 0) {
        const msg = 'Parsed 0 items. Check XML structure and mapping settings.';
        this.logAndSaveStatus(profile, 'error', 0, 0, 0, msg);
        return {
          profileId,
          success: false,
          itemsProcessed: 0,
          pricesUpdated: 0,
          stocksUpdated: 0,
          message: msg
        };
      }

      // Apply fixed stock override if configured for this profile
      if (profile.fixedStock !== undefined && profile.fixedStock !== null) {
        const fixedVal = Number(profile.fixedStock);
        for (const item of items) {
          item.stock = fixedVal;
        }
      }

      // 3. Match against BaseLinker product IDs using local DB cache
      // Check if we already have cached products for targetInventoryId in SQLite
      const cachedCount = this.db.getBaseProductsCount(profile.targetInventoryId);
      if (cachedCount === 0) {
        const fetchedProducts = await client.fetchAllInventoryProducts(profile.targetInventoryId);
        if (fetchedProducts.length > 0) {
          this.db.upsertBaseProducts(profile.targetInventoryId, fetchedProducts);
        }
      }

      let blProductMultiMap = this.db.getBaseProductsMultiMap(profile.targetInventoryId, profile.identifierField);

      // 4. Auto-create products in BaseLinker if missing, stock > 0, and price > 0
      let createdCount = 0;
      for (const item of items) {
        const existingBlIds = blProductMultiMap.get(item.identifier);
        if ((!existingBlIds || existingBlIds.length === 0) && item.stock > 0 && item.price > 0) {
          try {
            const formattedWh = /^\d+$/.test(profile.targetWarehouseId)
              ? `bl_${profile.targetWarehouseId}`
              : profile.targetWarehouseId;

            const newBlId = await client.addInventoryProduct({
              inventory_id: profile.targetInventoryId,
              sku: item.sku || (profile.identifierField === 'sku' ? item.identifier : undefined),
              ean: item.ean || (profile.identifierField === 'ean' ? item.identifier : undefined),
              prices: { [profile.targetPriceGroupId]: item.price },
              stock: { [formattedWh]: item.stock },
              name: item.name || item.sku || item.identifier
            });

            if (newBlId) {
              blProductMultiMap.set(item.identifier, [newBlId]);
              this.db.saveSingleBaseProduct(
                profile.targetInventoryId,
                newBlId,
                item.sku || (profile.identifierField === 'sku' ? item.identifier : undefined),
                item.ean || (profile.identifierField === 'ean' ? item.identifier : undefined)
              );
              createdCount++;
            }
          } catch (createErr) {
            console.error(`Failed to create product ${item.identifier} in BaseLinker:`, createErr);
          }
        }
      }

      // 5. Calculate Deltas
      const deltas = this.diffEngine.calculateDeltas(profile.id, items);

      // 6. Build BaseLinker update payloads
      const pricesToUpdate: Record<number, number> = {};
      const stocksToUpdate: Record<number, number> = {};

      for (const delta of deltas) {
        const blIds = blProductMultiMap.get(delta.identifier);
        if (!blIds || blIds.length === 0) continue; // Item not found in target BaseLinker inventory

        for (const blId of blIds) {
          // Prevent syncing 0 or negative prices to BaseLinker
          if (delta.hasPriceChange && delta.newPrice !== undefined && delta.newPrice > 0) {
            pricesToUpdate[blId] = delta.newPrice;
          }
          if (delta.hasStockChange && delta.newStock !== undefined) {
            stocksToUpdate[blId] = delta.newStock;
          }
        }
      }

      // 7. Push updates to BaseLinker
      let pricesUpdatedCount = 0;
      let stocksUpdatedCount = 0;

      if (Object.keys(pricesToUpdate).length > 0) {
        pricesUpdatedCount = await client.updateInventoryProductsPrices(
          profile.targetInventoryId,
          pricesToUpdate,
          profile.targetPriceGroupId
        );
      }

      if (Object.keys(stocksToUpdate).length > 0) {
        stocksUpdatedCount = await client.updateInventoryProductsStock(
          profile.targetInventoryId,
          stocksToUpdate,
          profile.targetWarehouseId
        );
      }

      // 8. Commit deltas to local cache
      this.diffEngine.commitDeltas(profile.id, deltas);

      let successMsg = `Synced ${items.length} items. Updated ${pricesUpdatedCount} prices, ${stocksUpdatedCount} stock levels.`;
      if (createdCount > 0) {
        successMsg += ` Created ${createdCount} new items in BaseLinker.`;
      }
      this.logAndSaveStatus(profile, 'success', items.length, pricesUpdatedCount, stocksUpdatedCount, successMsg);

      return {
        profileId,
        success: true,
        itemsProcessed: items.length,
        pricesUpdated: pricesUpdatedCount,
        stocksUpdated: stocksUpdatedCount,
        message: successMsg
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logAndSaveStatus(profile, 'error', 0, 0, 0, errorMsg);
      return {
        profileId,
        success: false,
        itemsProcessed: 0,
        pricesUpdated: 0,
        stocksUpdated: 0,
        message: errorMsg
      };
    }
  }

  private logAndSaveStatus(
    profile: FeedProfile,
    status: 'success' | 'error',
    itemsProcessed: number,
    pricesUpdated: number,
    stocksUpdated: number,
    message: string
  ): void {
    const timestamp = new Date().toISOString();
    profile.lastSyncAt = timestamp;
    profile.lastSyncStatus = status;
    profile.lastSyncMessage = message;
    this.db.saveProfile(profile);

    this.db.addSyncLog({
      profileId: profile.id,
      timestamp,
      status,
      itemsProcessed,
      pricesUpdated,
      stocksUpdated,
      message
    });
  }
}
