import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } from 'electron';
import path from 'path';
import { DatabaseManager } from './storage/DatabaseManager';
import { createApiServer } from './server/app';
import { registerBrowserFetcher } from './utils/xmlFetcher';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Register Electron background browser engine to bypass Cloudflare / Akamai TLS fingerprint checks
registerBrowserFetcher(async (targetUrl: string, customHeaders?: Record<string, string>) => {
  return new Promise<string>((resolve, reject) => {
    let finished = false;
    const hiddenWin = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try { hiddenWin.destroy(); } catch {}
        reject(new Error(`Przekroczono limit czasu (60s) podczas ładowania ${targetUrl} przez przeglądarkę`));
      }
    }, 60000);

    const cleanup = () => {
      clearTimeout(timer);
      try {
        if (!hiddenWin.isDestroyed()) hiddenWin.destroy();
      } catch {}
    };

    hiddenWin.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      if (customHeaders) {
        Object.assign(details.requestHeaders, customHeaders);
      }
      callback({ requestHeaders: details.requestHeaders });
    });

    hiddenWin.webContents.on('did-finish-load', async () => {
      if (finished) return;
      try {
        const rawContent = await hiddenWin.webContents.executeJavaScript(
          `(() => {
            const pre = document.querySelector('pre');
            if (pre && pre.textContent && (pre.textContent.trim().startsWith('<?xml') || pre.textContent.trim().startsWith('<'))) {
              return pre.textContent;
            }
            if (document.body && document.body.innerText && (document.body.innerText.trim().startsWith('<?xml') || document.body.innerText.trim().startsWith('<'))) {
              return document.body.innerText;
            }
            return document.documentElement ? document.documentElement.outerHTML : '';
          })()`
        );
        finished = true;
        cleanup();
        resolve(rawContent);
      } catch (err) {
        finished = true;
        cleanup();
        reject(err);
      }
    });

    hiddenWin.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error(`Błąd ładowania strony (${errorCode}): ${errorDescription}`));
    });

    hiddenWin.loadURL(targetUrl).catch((err) => {
      if (!finished) {
        finished = true;
        cleanup();
        reject(err);
      }
    });
  });
});

const db = new DatabaseManager(path.join(app.getPath('userData'), 'boltline.sqlite'));
db.initialize();

const { app: expressApp, syncCoordinator } = createApiServer(db, {
  onRestart: () => {
    isQuitting = true;
    app.relaunch();
    app.exit(0);
  },
  repoDir: app.getAppPath ? app.getAppPath() : process.cwd(),
  onSelectFile: async () => {
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: 'Wybierz plik XML z danymi',
          properties: ['openFile'],
          filters: [
            { name: 'Pliki XML', extensions: ['xml'] },
            { name: 'Wszystkie pliki', extensions: ['*'] }
          ]
        })
      : await dialog.showOpenDialog({
          title: 'Wybierz plik XML z danymi',
          properties: ['openFile'],
          filters: [
            { name: 'Pliki XML', extensions: ['xml'] },
            { name: 'Wszystkie pliki', extensions: ['*'] }
          ]
        });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  }
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

import { SyncSchedulerService } from './service/SyncSchedulerService';

// Background scheduler with internet connection detection & auto-retry
const syncScheduler = new SyncSchedulerService(db, syncCoordinator);
syncScheduler.start();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'XMLsync',
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
  tray.setToolTip('XMLsync');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Otwórz panel',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: 'Synchronizuj wszystkie aktywne pliki',
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
      label: 'Zakończ',
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
  syncScheduler.stop();
  server.close();
});

app.on('window-all-closed', () => {
  const currentSettings = db.getSettings();
  if (process.platform !== 'darwin' && !currentSettings.minimizeToTray) {
    app.quit();
  }
});
