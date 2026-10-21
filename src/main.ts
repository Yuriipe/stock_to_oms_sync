import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import path from 'path';
import { DatabaseManager } from './storage/DatabaseManager';
import { createApiServer } from './server/app';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const db = new DatabaseManager(path.join(app.getPath('userData'), 'boltline.sqlite'));
db.initialize();

const { app: expressApp, syncCoordinator } = createApiServer(db, {
  onRestart: () => {
    isQuitting = true;
    app.relaunch();
    app.exit(0);
  },
  repoDir: app.getAppPath ? app.getAppPath() : process.cwd()
});

const settings = db.getSettings();
const PORT = settings.serverPort || 3890;

const server = expressApp.listen(PORT, '127.0.0.1', () => {
  console.log(`Boltline Local Server listening on http://127.0.0.1:${PORT}`);
});

// Configure Windows Auto-Start
function setAutoStart(enable: boolean) {
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: process.execPath,
    args: ['--hidden']
  });
}

// Background scheduler interval (checks enabled profiles every minute)
const scheduleTimer = setInterval(async () => {
  try {
    const profiles = db.getProfiles();
    const now = Date.now();

    for (const profile of profiles) {
      if (!profile.enabled) continue;

      const intervalMs = (profile.syncIntervalMinutes || 30) * 60 * 1000;
      const lastRun = profile.lastSyncAt ? new Date(profile.lastSyncAt).getTime() : 0;

      if (now - lastRun >= intervalMs) {
        console.log(`[Scheduler] Auto-sync triggered for profile: ${profile.name}`);
        await syncCoordinator.syncProfile(profile.id).catch(console.error);
      }
    }
  } catch (err) {
    console.error('[Scheduler Error]:', err);
  }
}, 60 * 1000);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Boltline Base XML Sync',
    backgroundColor: '#0c0f17',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.on('close', (event) => {
    const currentSettings = db.getSettings();
    if (!isQuitting && currentSettings.minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  // 16x16 transparent dot icon fallback
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAEFJREFUOE9jZKAQMFKon2HUA4ZRDwY0wG37///vYhhGQZGBgQFf2A1i08XAwDAKRh4GhlE/GEY9GNAAY70eBgcAE50v1Wp6v2IAAAAASUVORK5CYII=',
      'base64'
    )
  );

  tray = new Tray(icon);
  tray.setToolTip('Boltline Base XML Sync');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: 'Sync All Active Feeds',
      click: async () => {
        const profiles = db.getProfiles();
        for (const p of profiles) {
          if (p.enabled) {
            await syncCoordinator.syncProfile(p.id).catch(console.error);
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const currentSettings = db.getSettings();
    setAutoStart(currentSettings.autoStartOnBoot);

    createWindow();
    createTray();

    if (process.argv.includes('--hidden')) {
      mainWindow?.hide();
    }
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  clearInterval(scheduleTimer);
  server.close();
});

app.on('window-all-closed', () => {
  const currentSettings = db.getSettings();
  if (process.platform !== 'darwin' && !currentSettings.minimizeToTray) {
    app.quit();
  }
});
