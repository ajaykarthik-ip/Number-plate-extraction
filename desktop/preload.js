'use strict';

/*
 * Minimal preload. The renderer is our own exported UI served from localhost,
 * so nothing extra is exposed — the secure defaults (contextIsolation on,
 * nodeIntegration off) are enforced from main.js.
 *
 * If the UI ever needs a native capability (open a folder, app version, quit),
 * expose it here through contextBridge instead of enabling nodeIntegration.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('autogateDesktop', {
  isDesktop: true,
  version: process.env.npm_package_version || '1.0.0',
});
