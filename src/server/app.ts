import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import { DatabaseManager } from '../storage/DatabaseManager';
import { BaseLinkerClient } from '../baselinker/BaseLinkerClient';
import { XmlParserService } from '../parser/XmlParserService';
import { SyncCoordinator } from '../service/SyncCoordinator';
import { DiffEngine } from '../diff/DiffEngine';
import { FeedProfile } from '../types';

export function createApiServer(db: DatabaseManager) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const xmlParser = new XmlParserService();
  const diffEngine = new DiffEngine(db);
  const syncCoordinator = new SyncCoordinator(db, xmlParser, diffEngine);

  // Serve static UI assets if built
  app.use(express.static('public'));

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

      if (!xmlContent && sourceType === 'url' && sourcePath) {
        const headers: Record<string, string> = {};
        if (authHeader) headers['Authorization'] = authHeader;
        const response = await axios.get(sourcePath, { headers, timeout: 20000, responseType: 'text' });
        xmlContent = response.data;
      } else if (!xmlContent && sourceType === 'file' && sourcePath) {
        if (!fs.existsSync(sourcePath)) {
          return res.status(400).json({ error: `File not found: ${sourcePath}` });
        }
        xmlContent = fs.readFileSync(sourcePath, 'utf-8');
      }

      if (!xmlContent) {
        return res.status(400).json({ error: 'No XML content or valid source provided' });
      }

      // Sample first 1MB if huge
      const snippet = xmlContent.slice(0, 1024 * 1024);
      const candidates = xmlParser.inspectStructure(snippet);

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

      if (!xmlContent && sourceType === 'url' && sourcePath) {
        const headers: Record<string, string> = {};
        if (authHeader) headers['Authorization'] = authHeader;
        const response = await axios.get(sourcePath, { headers, timeout: 20000, responseType: 'text' });
        xmlContent = response.data;
      } else if (!xmlContent && sourceType === 'file' && sourcePath) {
        xmlContent = fs.readFileSync(sourcePath, 'utf-8');
      }

      if (!xmlContent || !mapping) {
        return res.status(400).json({ error: 'XML content and mapping required' });
      }

      const items = xmlParser.parseXml(xmlContent.slice(0, 1024 * 1024), mapping);
      res.json({ success: true, sampleCount: items.length, sampleItems: items.slice(0, 10) });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Get Profiles
  app.get('/api/profiles', (req, res) => {
    try {
      res.json(db.getProfiles());
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
