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

      // 3. Match against BaseLinker product IDs
      // Fetch products in inventory to map SKU/EAN to BaseLinker product_id
      const blProductMap = new Map<string, number>();
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const listRes = await client.getInventoryProductsList(profile.targetInventoryId, page);
        const products = Object.values(listRes.products || {});
        if (products.length === 0) {
          hasMore = false;
          break;
        }

        for (const p of products) {
          const key = profile.identifierField === 'sku' ? p.sku : p.ean;
          if (key) {
            blProductMap.set(key.trim(), p.id);
          }
        }

        if (products.length < 1000) {
          hasMore = false;
        } else {
          page++;
        }
      }

      // 4. Calculate Deltas
      const deltas = this.diffEngine.calculateDeltas(profile.id, items);

      // 5. Build BaseLinker update payloads
      const pricesToUpdate: Record<number, number> = {};
      const stocksToUpdate: Record<number, number> = {};

      for (const delta of deltas) {
        const blId = blProductMap.get(delta.identifier);
        if (!blId) continue; // Item not found in target BaseLinker inventory

        if (delta.hasPriceChange && delta.newPrice !== undefined) {
          pricesToUpdate[blId] = delta.newPrice;
        }
        if (delta.hasStockChange && delta.newStock !== undefined) {
          stocksToUpdate[blId] = delta.newStock;
        }
      }

      // 6. Push updates to BaseLinker
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

      // 7. Commit deltas to local cache
      this.diffEngine.commitDeltas(profile.id, deltas);

      const successMsg = `Synced ${items.length} items. Updated ${pricesUpdatedCount} prices, ${stocksUpdatedCount} stock levels.`;
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
