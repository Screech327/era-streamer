// ERA Streamer — Electron main process. Owns the lifecycle of:
//   1. RL StatsAPI ini auto-config (so first launch enables the TCP feed)
//   2. The local HTTP/WS server (port 49124 — both overlay and API)
//   3. The TCP→WS bridge that consumes RL's stats stream
//   4. The control panel BrowserWindow

const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const { autoConfigure } = require('./rl-config');
const { startBridge } = require('./bridge');
const { start: startServer } = require('./server');

const OVERLAY_DIR = path.join(__dirname, '..', 'overlay');
const UI_DIR      = path.join(__dirname, '..', 'ui');

let mainWindow = null;
let serverHandle = null;
let bridgeHandle = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    const statePath = path.join(app.getPath('userData'), 'state.json');

    serverHandle = await startServer({
      overlayDir: OVERLAY_DIR,
      uiDir: UI_DIR,
      statePath,
      onLog: (m) => console.log('[server]', m),
    });

    const iniResult = autoConfigure();
    serverHandle.setStatus({ iniResult });
    console.log('[ini]', iniResult);

    bridgeHandle = startBridge({
      onConnect:    () => serverHandle.setStatus({ rlConnected: true,  bridgeStarted: true }),
      onDisconnect: () => serverHandle.setStatus({ rlConnected: false, bridgeStarted: true }),
      onUpdate:     (msg) => serverHandle.relayBridgeMessage(msg),
    });
    serverHandle.setStatus({ bridgeStarted: true });

    mainWindow = new BrowserWindow({
      width: 1100,
      height: 820,
      minWidth: 920,
      minHeight: 700,
      backgroundColor: '#0a0a0a',
      title: 'ERA Streamer',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    mainWindow.setMenu(null);
    mainWindow.loadURL(`http://127.0.0.1:${serverHandle.port}/control`);
    // External links open in the user's browser, not inside the app.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
        mainWindow = new BrowserWindow({
          width: 1100, height: 820, autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        });
        mainWindow.loadURL(`http://127.0.0.1:${serverHandle.port}/control`);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (bridgeHandle) bridgeHandle.stop();
    if (serverHandle) serverHandle.stop();
    if (process.platform !== 'darwin') app.quit();
  });
}
