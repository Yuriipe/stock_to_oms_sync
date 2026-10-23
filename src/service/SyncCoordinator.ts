import fs from 'fs';
import axios from 'axios';
import { DatabaseManager } from '../storage/DatabaseManager';
import { BaseLinkerClient } from '../baselinker/BaseLinkerClient';
import { resolveLocalFilePath } from '../utils/fileResolver';
import { fetchXmlSource } from '../utils/xmlFetcher';
import { XmlParserService } from '../parser/XmlParserService';
import { DiffEngine } from '../diff/DiffEngine';
import { FeedProfile } from '../types';
import { NbpRateService } from './NbpRateService';

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
    return fetchXmlSource({
      sourceType: profile.sourceType,
      sourcePath: profile.sourcePath,
      authHeader: profile.authHeader,
      timeoutMs: 60000
    });
  }

  /**
   * Helper to yield to Node/Electron event loop, allowing UI and system events to breathe
   */
  private async yieldEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  public async syncProfile(profileId: string, options?: { forceCatalogRefresh?: boolean }): Promise<SyncExecutionResult> {
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

      // Yield event loop before heavy parsing
      await this.yieldEventLoop();

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

      await this.yieldEventLoop();

      // Apply fixed stock override if configured for this profile
      if (profile.fixedStock !== undefined && profile.fixedStock !== null) {
        const fixedVal = Number(profile.fixedStock);
        for (let i = 0; i < items.length; i++) {
          items[i].stock = fixedVal;
          if (i % 2500 === 0) await this.yieldEventLoop();
        }
      }

      // Apply price modifications (Multiplier, NBP exchange rate)
      const multiplier = (profile.priceMultiplier !== undefined && profile.priceMultiplier !== null && profile.priceMultiplier > 0)
        ? Number(profile.priceMultiplier)
        : 1.0;
      const currency = (profile.priceCurrency || 'PLN').toUpperCase().trim();
      let exchangeRate = 1.0;
      if (currency !== 'PLN') {
        try {
          exchangeRate = await NbpRateService.getRate(currency);
        } catch (nbpErr) {
          console.warn(`[SyncCoordinator] Could not get NBP rate for currency ${currency}, defaulting to 1.0:`, nbpErr);
        }
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof item.price === 'number' && !isNaN(item.price) && item.price > 0) {
          // Calculation: sourcePrice * exchangeRate * multiplier
          const modified = item.price * exchangeRate * multiplier;
          item.price = Math.round(modified * 100) / 100;
        }
        if (i % 2500 === 0) await this.yieldEventLoop();
      }

      // 3. Match against BaseLinker product IDs using local DB cache
      // Refresh full catalog from BaseLinker if:
      // a) Explicitly requested (e.g. manual refresh in UI or forceCatalogRefresh)
      // b) No products exist in local DB cache yet
      // c) Last catalog reconciliation was more than 12 hours ago
      const cachedProductsCount = this.db.getBaseProductsCount(profile.targetInventoryId);
      const lastCatalogSyncAt = this.db.getLastCatalogSyncAt(profile.targetInventoryId);
      const isCatalogStale = !lastCatalogSyncAt || (Date.now() - new Date(lastCatalogSyncAt).getTime() > 12 * 60 * 60 * 1000);
      const shouldRefreshCatalog = options?.forceCatalogRefresh || cachedProductsCount === 0 || isCatalogStale;

      if (shouldRefreshCatalog) {
        try {
          const fetchedProducts = await client.fetchAllInventoryProducts(profile.targetInventoryId);
          this.db.syncBaseProducts(profile.targetInventoryId, fetchedProducts);
        } catch (fetchErr) {
          console.warn(
            `Could not refresh BaseLinker products for inventory ${profile.targetInventoryId}, falling back to local cache:`,
            fetchErr
          );
          if (this.db.getBaseProductsCount(profile.targetInventoryId) === 0) {
            throw fetchErr;
          }
        }
      }

      // Clean up any remaining rows that contain nothing except ID (missing both SKU and EAN)
      this.db.deleteEmptyBaseProducts(profile.targetInventoryId);

      let blProductMultiMap = this.db.getBaseProductsMultiMap(profile.targetInventoryId, profile.identifierField);
      let blProductInfoMultiMap = this.db.getBaseProductsInfoMultiMap(profile.targetInventoryId, profile.identifierField);

      // 4. Auto-create products in BaseLinker or update images if product already exists without images
      let createdCount = 0;
      let imagesUpdatedCount = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (i % 1000 === 0) await this.yieldEventLoop();
        const existingInfos = blProductInfoMultiMap.get(item.identifier);
        if (!existingInfos || existingInfos.length === 0) {
          try {
            const formattedWh = /^\d+$/.test(profile.targetWarehouseId)
              ? `bl_${profile.targetWarehouseId}`
              : profile.targetWarehouseId;

            const addParams: {
              inventory_id: number;
              sku?: string;
              ean?: string;
              prices?: Record<number | string, number>;
              stock?: Record<string, number>;
              name?: string;
              images?: string[];
            } = {
              inventory_id: profile.targetInventoryId,
              sku: item.sku || (profile.identifierField === 'sku' ? item.identifier : undefined),
              ean: item.ean || (profile.identifierField === 'ean' ? item.identifier : undefined),
              name: item.name || item.sku || item.identifier || `Product ${item.identifier}`
            };

            if (item.imageUrl) {
              addParams.images = [item.imageUrl];
            }

            // Always assign price if target price group is configured (lack of price must never block creation)
            if (profile.targetPriceGroupId) {
              const productPrice = (item.price !== undefined && !isNaN(item.price)) ? item.price : 0;
              addParams.prices = { [profile.targetPriceGroupId]: productPrice };
            }

            // Always assign stock for the target warehouse (even if 0)
            const productStock = (item.stock !== undefined && !isNaN(item.stock)) ? Math.max(0, item.stock) : 0;
            addParams.stock = { [formattedWh]: productStock };

            const newBlId = await client.addInventoryProduct(addParams);

            if (newBlId) {
              blProductMultiMap.set(item.identifier, [newBlId]);
              blProductInfoMultiMap.set(item.identifier, [{ productId: newBlId, hasImages: Boolean(item.imageUrl) }]);
              this.db.saveSingleBaseProduct(
                profile.targetInventoryId,
                newBlId,
                addParams.sku,
                addParams.ean,
                Boolean(item.imageUrl)
              );
              this.db.updateCacheEntry(profile.id, item.identifier, item.price, item.stock);
              createdCount++;
            }
          } catch (createErr) {
            console.error(`Failed to create product ${item.identifier} in BaseLinker:`, createErr);
          }
        } else if (item.imageUrl) {
          // Product already exists in BaseLinker catalog - check if any instance lacks images
          for (const info of existingInfos) {
            if (!info.hasImages) {
              try {
                const ok = await client.updateInventoryProductImages(
                  profile.targetInventoryId,
                  info.productId,
                  [item.imageUrl]
                );
                if (ok) {
                  info.hasImages = true;
                  this.db.markProductHasImages(profile.targetInventoryId, info.productId, true);
                  imagesUpdatedCount++;
                }
              } catch (imgErr) {
                console.error(`Failed to update image for product ${info.productId}:`, imgErr);
              }
            }
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
          profile.targetPriceGroupId,
          (missingBlId) => {
            console.warn(`Product ${missingBlId} not found in BaseLinker; deleting from local table.`);
            this.db.deleteBaseProduct(profile.targetInventoryId, missingBlId);
          }
        );
      }

      if (Object.keys(stocksToUpdate).length > 0) {
        stocksUpdatedCount = await client.updateInventoryProductsStock(
          profile.targetInventoryId,
          stocksToUpdate,
          profile.targetWarehouseId,
          (missingBlId) => {
            console.warn(`Product ${missingBlId} not found in BaseLinker; deleting from local table.`);
            this.db.deleteBaseProduct(profile.targetInventoryId, missingBlId);
          }
        );
      }

      // 8. Commit deltas to local cache
      this.diffEngine.commitDeltas(profile.id, deltas);

      let successMsg = `Synced ${items.length} items. Updated ${pricesUpdatedCount} prices, ${stocksUpdatedCount} stock levels.`;
      if (createdCount > 0) {
        successMsg += ` Created ${createdCount} new items in BaseLinker.`;
      }
      if (imagesUpdatedCount > 0) {
        successMsg += ` Added images to ${imagesUpdatedCount} existing items.`;
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
    if (status === 'success') {
      profile.lastSyncAt = timestamp;
    }
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
