import path from 'path';
import { DatabaseManager } from './storage/DatabaseManager';
import { createApiServer } from './server/app';

const dbPath = path.join(process.cwd(), 'boltline-preview.sqlite');
const db = new DatabaseManager(dbPath);
db.initialize();

import { SyncSchedulerService } from './service/SyncSchedulerService';

const { app: expressApp, syncCoordinator } = createApiServer(db);

const syncScheduler = new SyncSchedulerService(db, syncCoordinator);
syncScheduler.start();

const settings = db.getSettings();
const PORT = settings.serverPort || 3890;

expressApp.listen(PORT, '127.0.0.1', () => {
  console.log(`\n==================================================`);
  console.log(`🚀 XMLsync Web Dashboard is live!`);
  console.log(`👉 Open: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});

