import path from 'path';
import { DatabaseManager } from './storage/DatabaseManager';
import { createApiServer } from './server/app';

const dbPath = path.join(process.cwd(), 'boltline-preview.sqlite');
const db = new DatabaseManager(dbPath);
db.initialize();

const { app: expressApp } = createApiServer(db);

const settings = db.getSettings();
const PORT = settings.serverPort || 3890;

expressApp.listen(PORT, '127.0.0.1', () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Boltline Web Dashboard is live!`);
  console.log(`👉 Open: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
