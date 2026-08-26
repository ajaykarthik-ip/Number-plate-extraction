'use strict';

/*
 * AutoGate NX — Electron desktop shell.
 *
 * Flow:
 *   1. Serve the exported Next.js site (plain HTML/CSS/JS) from a tiny static
 *      server bound to 127.0.0.1 on an OS-assigned free port.
 *   2. Show a splash while that comes up.
 *   3. Open the window at that local URL and close the splash.
 *
 * There is no backend process to spawn — this build is frontend-only, so the
 * shell owns the whole lifecycle. When a real ANPR backend exists, point
 * AUTOGATE_APP_URL at it (or spawn it here the way PPE Monitor does).
 *
 * Where the site lives:
 *   packaged    <resources>\site      (electron-builder extraResources)
 *   development ..\frontend\out       (produced by `npm run build` in frontend)
 *
 * Env overrides:
 *   AUTOGATE_APP_URL   load this URL instead of the bundled site
 *                      (e.g. http://localhost:3000 to attach to `next dev`)
 *   AUTOGATE_SITE_DIR  serve this directory instead of the defaults above
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const { startServer } = require('./static-server');

let mainWindow = null;
let splashWindow = null;
let server = null;
let quitting = false;

// Ensure only one instance runs (a second launch just focuses the first).
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** Absolute path to the exported site. */
function resolveSiteDir() {
  if (process.env.AUTOGATE_SITE_DIR) return process.env.AUTOGATE_SITE_DIR;
  if (app.isPackaged) return path.join(process.resourcesPath, 'site');
  return path.join(__dirname, '..', 'frontend', 'out');
}

function stopServer() {
  if (!server) return;
  try {
    server.close();
  } catch (_) {
    /* ignore */
  }
  server = null;
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    backgroundColor: '#131d40',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'assets', 'loading.html'));
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createMainWindow(appUrl) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Keep in-app navigation inside the window; send anything else to the
  // system browser rather than opening a second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(appUrl)) return { action: 'allow' };
    shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) splashWindow.close();
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(appUrl);
}

async function boot() {
  createSplash();

  try {
    let appUrl = process.env.AUTOGATE_APP_URL;
    if (!appUrl) {
      const started = await startServer(resolveSiteDir());
      server = started.server;
      appUrl = started.baseUrl;
    }
    if (quitting) return;
    createMainWindow(appUrl);
  } catch (err) {
    if (splashWindow) splashWindow.close();
    dialog.showErrorBox('AutoGate NX', `The app could not start.\n\n${err.message}`);
    app.exit(1);
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(boot);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && !quitting) boot();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', stopServer);
process.on('exit', stopServer);
