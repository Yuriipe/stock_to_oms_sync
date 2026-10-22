import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { DatabaseManager } from '../storage/DatabaseManager';
import { BaseLinkerClient } from '../baselinker/BaseLinkerClient';
import { XmlParserService } from '../parser/XmlParserService';
import { SyncCoordinator } from '../service/SyncCoordinator';
import { DiffEngine } from '../diff/DiffEngine';
import { FeedProfile } from '../types';
import { AppUpdateService } from '../service/AppUpdateService';
import { resolveLocalFilePath } from '../utils/fileResolver';
import { fetchXmlSource } from '../utils/xmlFetcher';

export function createApiServer(
  db: DatabaseManager,
  options?: {
    onRestart?: () => void;
    repoDir?: string;
    onSelectFile?: () => Promise<string | null>;
  }
) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'Malformed JSON payload' });
    }
    next(err);
  });

  const xmlParser = new XmlParserService();
  const diffEngine = new DiffEngine(db);
  const syncCoordinator = new SyncCoordinator(db, xmlParser, diffEngine);
  const updateService = new AppUpdateService(options?.repoDir || process.cwd());

  // Serve static UI assets (support both dev and packaged electron ASAR/resources)
  const publicDir = fs.existsSync(path.join(__dirname, '../../public'))
    ? path.join(__dirname, '../../public')
    : path.join(__dirname, '../public');
  const finalPublicDir = fs.existsSync(publicDir) ? publicDir : path.join(process.cwd(), 'public');
  app.use(express.static(finalPublicDir));

  // Open native OS file dialog if supported (Electron)
  app.post('/api/system/select-file', async (req, res) => {
    try {
      if (options?.onSelectFile) {
        const selected = await options.onSelectFile();
        return res.json({ supported: true, filePath: selected });
      }
      return res.json({ supported: false, filePath: null });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Get App Update Status
  app.get('/api/updates/status', async (req, res) => {
    try {
      const settings = db.getSettings();
      const status = await updateService.checkForUpdates({
        token: settings.githubToken,
        repoUrl: settings.updateRepo
      });
      res.json(status);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Trigger Apply Update (git pull + build)
  app.post('/api/updates/apply', async (req, res) => {
    try {
      const settings = db.getSettings();
      const result = await updateService.applyUpdate({
        token: settings.githubToken,
        repoUrl: settings.updateRepo
      });
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Trigger Application Restart
  app.post('/api/updates/restart', (req, res) => {
    res.json({ success: true, message: 'Restarting application...' });
    setTimeout(() => {
      if (options?.onRestart) {
        options.onRestart();
      } else {
        updateService.restartApp();
      }
    }, 1000);
  });

  // Get App Settings
  app.get('/api/settings', (req, res) => {
    try {
      const settings = db.getSettings();
      res.json(settings);
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Save App Settings
  app.post('/api/settings', (req, res) => {
    try {
      db.updateSettings(req.body);
      res.json({ success: true, settings: db.getSettings() });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });

  // BaseLinker Discovery: Inventories, Warehouses, Price Groups
  app.get('/api/baselinker/hierarchy', async (req, res) => {
    try {
      const settings = db.getSettings();
      if (!settings.baseLinkerToken) {
        return res.status(400).json({ error: 'BaseLinker token not configured' });
      }
      const client = new BaseLinkerClient(settings.baseLinkerToken);
      const [inventories, warehouses, priceGroups] = await Promise.all([
        client.getInventories(),
        client.getInventoryWarehouses(),
        client.getInventoryPriceGroups()
      ]);
      res.json({ inventories, warehouses, priceGroups });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // XML Inspection Endpoint: inspect sample XML or URL for UI Mapping
  app.post('/api/xml/inspect', async (req, res) => {
    try {
      const { sourceType, sourcePath, authHeader, sampleXml } = req.body;
      let xmlContent = sampleXml;

      if (!xmlContent && sourcePath) {
        xmlContent = await fetchXmlSource({
          sourceType: sourceType || 'file',
          sourcePath,
          authHeader,
          timeoutMs: 25000
        });
      }

      if (!xmlContent) {
        return res.status(400).json({ error: 'No XML content or valid source provided' });
      }

      // Safely slice XML snippet for fast inspection
      let snippet = xmlContent;
      if (snippet.length > 1024 * 1024) {
        snippet = snippet.slice(0, 1024 * 1024);
        const lastLt = snippet.lastIndexOf('<');
        const lastGt = snippet.lastIndexOf('>');
        if (lastLt > lastGt) {
          snippet = snippet.slice(0, lastLt);
        }
      }

      let candidates;
      try {
        candidates = xmlParser.inspectStructure(snippet);
      } catch (parseErr) {
        // If truncated snippet caused a syntax issue (e.g., closing tag cut off), retry with full xmlContent
        candidates = xmlParser.inspectStructure(xmlContent);
      }

      res.json({ success: true, ...candidates });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // XML Mapping Preview Endpoint
  app.post('/api/xml/preview', async (req, res) => {
    try {
      const { sourceType, sourcePath, authHeader, sampleXml, mapping } = req.body;
      let xmlContent = sampleXml;

      if (!xmlContent && sourcePath) {
        xmlContent = await fetchXmlSource({
          sourceType: sourceType || 'file',
          sourcePath,
          authHeader,
          timeoutMs: 25000
        });
      }

      if (!xmlContent || !mapping) {
        return res.status(400).json({ error: 'XML content and mapping required' });
      }

      let snippet = xmlContent;
      if (snippet.length > 1024 * 1024) {
        snippet = snippet.slice(0, 1024 * 1024);
        const lastLt = snippet.lastIndexOf('<');
        const lastGt = snippet.lastIndexOf('>');
        if (lastLt > lastGt) {
          snippet = snippet.slice(0, lastLt);
        }
      }

      let items;
      try {
        items = xmlParser.parseXml(snippet, mapping);
      } catch (parseErr) {
        // Fallback to full xmlContent if truncated slice caused closing tag mismatch
        items = xmlParser.parseXml(xmlContent, mapping);
      }

      res.json({ success: true, sampleCount: items.length, sampleItems: items.slice(0, 10) });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Get Profiles
  app.get('/api/profiles', (req, res) => {
    try {
      const profiles = db.getProfiles();
      // Attach cached BaseLinker product count for convenience
      const enriched = profiles.map(p => ({
        ...p,
        baseProductsCount: db.getBaseProductsCount(p.targetInventoryId)
      }));
      res.json(enriched);
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Get Cached BaseLinker Products for an Inventory
  app.get('/api/baselinker/products', (req, res) => {
    try {
      const inventoryId = parseInt(req.query.inventoryId as string, 10);
      if (!inventoryId) {
        return res.status(400).json({ error: 'inventoryId query param required' });
      }
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const data = db.getBaseProductsList(inventoryId, limit, offset);
      res.json(data);
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Force Refresh BaseLinker Products into Local SQLite Cache
  app.post('/api/baselinker/products/refresh', async (req, res) => {
    try {
      const inventoryId = parseInt(req.body.inventoryId, 10);
      if (!inventoryId) {
        return res.status(400).json({ error: 'inventoryId required in body' });
      }

      const settings = db.getSettings();
      if (!settings.baseLinkerToken) {
        return res.status(400).json({ error: 'BaseLinker token not configured' });
      }

      const client = new BaseLinkerClient(settings.baseLinkerToken);
      const products = await client.fetchAllInventoryProducts(inventoryId);
      const { updated, deleted } = db.syncBaseProducts(inventoryId, products);

      res.json({ success: true, count: updated, deleted });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Delete Single BaseLinker Product from Local Table Cache
  app.delete('/api/baselinker/products/:inventoryId/:productId', (req, res) => {
    try {
      const inventoryId = parseInt(req.params.inventoryId, 10);
      const productId = parseInt(req.params.productId, 10);
      if (!inventoryId || !productId) {
        return res.status(400).json({ error: 'Valid inventoryId and productId required' });
      }
      const deleted = db.deleteBaseProduct(inventoryId, productId);
      res.json({ success: true, deleted });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Delete All Products Containing Nothing Except ID (no SKU & no EAN)
  app.post('/api/baselinker/products/cleanup-empty', (req, res) => {
    try {
      const inventoryId = parseInt(req.body.inventoryId, 10);
      if (!inventoryId) {
        return res.status(400).json({ error: 'inventoryId required in body' });
      }
      const count = db.deleteEmptyBaseProducts(inventoryId);
      res.json({ success: true, count });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Save/Update Profile
  app.post('/api/profiles', (req, res) => {
    try {
      const profile = req.body as FeedProfile;
      if (!profile.id) {
        profile.id = 'prof_' + Date.now();
      }
      if (profile.sourceType === 'file' && profile.sourcePath) {
        const resolved = resolveLocalFilePath(profile.sourcePath);
        if (resolved) {
          profile.sourcePath = resolved;
        }
      }
      db.saveProfile(profile);
      res.json({ success: true, profile: db.getProfileById(profile.id) });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Delete Profile
  app.delete('/api/profiles/:id', (req, res) => {
    try {
      db.deleteProfile(req.params.id);
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Trigger Sync for Profile
  app.post('/api/profiles/:id/sync', async (req, res) => {
    try {
      const result = await syncCoordinator.syncProfile(req.params.id);
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Get Sync Logs
  app.get('/api/logs', (req, res) => {
    try {
      const profileId = req.query.profileId as string | undefined;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      res.json(db.getSyncLogs(profileId, limit));
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });

  return { app, syncCoordinator };
}
