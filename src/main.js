// ERA Streamer — Electron main process. Owns the lifecycle of:
//   1. RL StatsAPI ini auto-config (so first launch enables the TCP feed)
//   2. The local HTTP/WS server (port 49124 — both overlay and API)
//   3. The TCP→WS bridge that consumes RL's stats stream
//   4. The control panel BrowserWindow

const { app, BrowserWindow, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoConfigure } = require('./rl-config');
const { startBridge } = require('./bridge');
const { start: startServer } = require('./server');
const { autoUpdater } = require('electron-updater');

const OVERLAY_DIR = path.join(__dirname, '..', 'overlay');
const UI_DIR      = path.join(__dirname, '..', 'ui');

// File logger — writes to %APPDATA%\ERA Streamer\logs\main.log so crashes
// leave evidence after the window's gone. Bounded at ~1MB by truncating
// when we cross the cap so the file can't grow without bound.
const LOG_DIR  = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'main.log');
const LOG_MAX_BYTES = 1024 * 1024;
function fileLog(level, ...args) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      const st = fs.statSync(LOG_FILE);
      if (st.size > LOG_MAX_BYTES) fs.writeFileSync(LOG_FILE, '');
    } catch (_) {}
    const parts = args.map((a) => {
      if (a == null) return String(a);
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${level}] ${parts.join(' ')}\n`);
  } catch (_) {}
}

// Catch anything that escapes async callbacks so a single bad event
// doesn't take the whole app down — Node 20+/Electron 33 terminates on
// unhandled rejections by default.
process.on('uncaughtException',  (err)    => { fileLog('uncaught',  err); console.error('[uncaught]',  err); });
process.on('unhandledRejection', (reason) => { fileLog('unhandled', reason); console.error('[unhandled]', reason); });

let mainWindow = null;
let serverHandle = null;
let bridgeHandle = null;
let tray = null;
let isQuitting = false;

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
      appVersion: app.getVersion(),
      onLog: (m) => console.log('[server]', m),
      // Renderer-driven update controls — control.html POSTs to these
      // endpoints to drive the autoUpdater without a native dialog.
      onUpdateCheck:   () => autoUpdater.checkForUpdates().catch((e) => console.log('[updater]', e && e.message || e)),
      onUpdateInstall: () => autoUpdater.quitAndInstall(true, true), // (isSilent=true, isForceRunAfter=true)
      // Window controls — the custom titlebar's min/max/close buttons
      // fetch these to drive the BrowserWindow.
      onWindowMinimize: () => mainWindow && mainWindow.minimize(),
      onWindowMaximize: () => {
        if (!mainWindow) return;
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
      },
      onWindowClose:    () => mainWindow && mainWindow.close(),
      // Auto-launch on Windows boot. Default OFF — producer flips it from
      // the Settings tab.
      onAutoLaunchGet: () => app.getLoginItemSettings().openAtLogin,
      onAutoLaunchSet: (on) => app.setLoginItemSettings({
        openAtLogin: !!on,
        // Start hidden so the tray runs without popping the window.
        args: ['--hidden-launch'],
      }),
      // Bridge "Retry connection" button — drops the current socket so the
      // auto-reconnect loop in bridge.js immediately attempts a fresh
      // connection without waiting out the 1.5s backoff.
      onBridgeReconnect: () => bridgeHandle && bridgeHandle.reconnect(),
    });

    const iniResult = autoConfigure();
    serverHandle.setStatus({ iniResult });
    console.log('[ini]', iniResult);

    // Track in-progress match state so we can snapshot on MatchEnded.
    // Mirrors what the website overlay's recording flow does, but lives
    // in the main process so it captures even when OBS isn't open.
    const liveMatch = { matchGuid: null, players: {}, teams: [], arena: '' };
    const flushedGuids = new Set();
    function ingestBridge(msg) {
      if (!msg) return;
      if (msg.Event === 'UpdateState') {
        const data = msg.Data;
        if (!data) return;
        if (data.MatchGuid && data.MatchGuid !== liveMatch.matchGuid) {
          liveMatch.matchGuid = data.MatchGuid;
          liveMatch.players = {};
        }
        if (data.Game) {
          if (data.Game.Teams && data.Game.Teams.length) liveMatch.teams = data.Game.Teams;
          if (data.Game.Arena) liveMatch.arena = data.Game.Arena;
        }
        for (const p of (data.Players || [])) {
          if (!p.PrimaryId) continue;
          liveMatch.players[p.PrimaryId] = {
            name: p.Name,
            teamNum: p.TeamNum,
            score: p.Score || 0,
            goals: p.Goals || 0,
            assists: p.Assists || 0,
            saves: p.Saves || 0,
            shots: p.Shots || 0,
            demos: p.Demos || 0,
            touches: p.Touches || 0,
          };
        }
      } else if (msg.Event === 'MatchEnded' || msg.Event === 'PodiumStart') {
        const guid = liveMatch.matchGuid;
        if (!guid || flushedGuids.has(guid)) return;
        if (!Object.keys(liveMatch.players).length) return;
        flushedGuids.add(guid);
        const teamScores = {};
        Object.values(liveMatch.players).forEach((p) => {
          teamScores[p.teamNum] = (teamScores[p.teamNum] || 0) + (p.goals || 0);
        });
        const teamMeta = {};
        for (const t of (liveMatch.teams || [])) {
          if (t.TeamNum != null) {
            teamMeta[t.TeamNum] = {
              name: t.Name || ('Team ' + t.TeamNum),
              color: t.ColorPrimary || (t.TeamNum === 0 ? '1873FF' : 'C26418'),
              finalScore: t.Score != null ? t.Score : (teamScores[t.TeamNum] || 0),
            };
          }
        }
        const winner = msg.Data && msg.Data.WinnerTeamNum;
        const game = {
          matchGuid: guid,
          endedAt: new Date().toISOString(),
          winnerTeamNum: (winner === 0 || winner === 1) ? winner : null,
          arena: liveMatch.arena,
          teamScores,
          teams: teamMeta,
          players: { ...liveMatch.players },
        };
        if (serverHandle && serverHandle.appendRecordingGame) serverHandle.appendRecordingGame(game);
        // Auto-progress the series counter for the winning side. Same
        // dedupe set above ensures one advance per matchGuid even if
        // both MatchEnded and PodiumStart fire.
        if (game.winnerTeamNum === 0 || game.winnerTeamNum === 1) {
          if (serverHandle && serverHandle.advanceSeriesWin) serverHandle.advanceSeriesWin(game.winnerTeamNum);
        }
      }
    }

    bridgeHandle = startBridge({
      onConnect:    () => serverHandle.setStatus({ rlConnected: true,  bridgeStarted: true }),
      onDisconnect: () => serverHandle.setStatus({ rlConnected: false, bridgeStarted: true }),
      onUpdate:     (msg) => { ingestBridge(msg); serverHandle.relayBridgeMessage(msg); },
    });
    serverHandle.setStatus({ bridgeStarted: true });

    // Auto-launch passes `--hidden-launch` so the window starts in the
    // tray without popping. User-initiated launches show normally.
    const hiddenLaunch = process.argv.includes('--hidden-launch');
    // Restore the window's last size and position. Falls back to the
    // default size for first-run and ignores stored bounds that are
    // off-screen (e.g. monitor disconnected since last launch).
    const savedBounds = serverHandle.getWindowBounds();
    const sane = savedBounds && (() => {
      const { screen } = require('electron');
      const inArea = (b, a) =>
        b.x + b.width  > a.x && b.x < a.x + a.width &&
        b.y + b.height > a.y && b.y < a.y + a.height;
      return screen.getAllDisplays().some((d) => inArea(savedBounds, d.workArea));
    })();
    const winOpts = sane
      ? { x: savedBounds.x, y: savedBounds.y, width: savedBounds.width, height: savedBounds.height }
      : { width: 1360, height: 940 };
    mainWindow = new BrowserWindow({
      ...winOpts,
      minWidth: 1080,
      minHeight: 760,
      backgroundColor: '#0a0a0a',
      title: 'ERA Streamer',
      show: !hiddenLaunch,
      // Frameless — replaced with the custom titlebar in control.html. Drops
      // the generic Windows chrome so the app reads as a polished tool
      // rather than a browser window.
      frame: false,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    mainWindow.setMenu(null);
    // App menu is disabled, so the default DevTools accelerators don't fire.
    // Listen on the window instead — Ctrl+Shift+I or F12 toggles devtools
    // (window-scoped, doesn't steal the shortcut from other apps).
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const isToggle =
        (input.key === 'F12') ||
        (input.control && input.shift && (input.key === 'I' || input.key === 'i'));
      if (!isToggle) return;
      event.preventDefault();
      const wc = mainWindow.webContents;
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: 'detach' });
    });
    mainWindow.loadURL(`http://127.0.0.1:${serverHandle.port}/control`);
    // External links open in the user's browser, not inside the app.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    // Persist window size/position so it sticks across launches. Debounced
    // (200ms) so we're not rewriting state.json on every drag pixel.
    let saveBoundsTimer = null;
    const persistBounds = () => {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        // Skip while minimized/maximized — the snapshot would be wrong.
        if (mainWindow.isMinimized() || mainWindow.isMaximized()) return;
        try { serverHandle.saveWindowBounds(mainWindow.getBounds()); } catch (_) {}
      }, 200);
    };
    mainWindow.on('resize', persistBounds);
    mainWindow.on('move',   persistBounds);

    // Closing the window hides to the tray instead of quitting — the
    // bridge keeps capturing matches in the background. Real quit only
    // happens via the tray's Quit option (which sets isQuitting first).
    mainWindow.on('close', (event) => {
      // Snapshot bounds before the window goes away so the next launch
      // restores exactly where the producer left it.
      try {
        if (!mainWindow.isMinimized() && !mainWindow.isMaximized()) {
          serverHandle.saveWindowBounds(mainWindow.getBounds());
        }
      } catch (_) {}
      if (!isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });

    // ── System tray ──────────────────────────────────────────────────
    const trayIconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'tray.ico')
      : path.join(__dirname, '..', 'build', 'icon.ico');
    let trayImage;
    try { trayImage = nativeImage.createFromPath(trayIconPath); } catch (_) { trayImage = nativeImage.createEmpty(); }
    tray = new Tray(trayImage);
    tray.setToolTip('ERA Streamer — bridge running');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show ERA Streamer', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
      else { mainWindow.show(); mainWindow.focus(); }
    });

    // ── Auto-update ──────────────────────────────────────────────────
    // Renderer (control window) polls /api/update/state and shows its
    // own UI — no native Windows dialogs. Install is silent (`/S` flag
    // passed to NSIS), so "restart now" closes + reinstalls + reopens
    // without any installer wizard or UAC prompt (per-user install).
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    const setUpd = (patch) => serverHandle && serverHandle.setUpdateState(patch);
    autoUpdater.on('checking-for-update', ()      => setUpd({ status: 'checking' }));
    autoUpdater.on('update-available',    (info)  => setUpd({ status: 'downloading', version: info && info.version, percent: 0 }));
    autoUpdater.on('update-not-available',()      => setUpd({ status: 'idle' }));
    autoUpdater.on('error',               (err)   => setUpd({ status: 'error', error: (err && err.message) || String(err) }));
    autoUpdater.on('download-progress',   (p)     => setUpd({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded',   (info)  => setUpd({ status: 'ready', version: info && info.version }));

    // Skip the network check when unpackaged (npm start) — electron-
    // updater fails on dev runs and the buttons in the UI still let
    // the producer trigger checks if they really want to.
    if (app.isPackaged) {
      const runCheck = () => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.log('[updater] check failed:', err && err.message || err);
        });
      };
      // Initial check, ~1s after boot — short delay just so the server
      // is fully listening before the autoUpdater pings the network.
      setTimeout(runCheck, 1000);
      // Re-check every 30 minutes while the app stays open, so a release
      // that drops mid-session is still picked up without restarting.
      setInterval(runCheck, 30 * 60 * 1000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
        mainWindow = new BrowserWindow({
          width: 1360, height: 940, autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        });
        mainWindow.loadURL(`http://127.0.0.1:${serverHandle.port}/control`);
      }
    });
  });

  // Renderer (control window) crashes don't take the main process down,
  // but they used to vanish silently. Log them so we can correlate "the
  // app crashed" reports with what actually happened.
  app.on('render-process-gone', (_event, _wc, details) => {
    fileLog('render-gone', details);
  });
  app.on('child-process-gone', (_event, details) => {
    if (details && details.reason && details.reason !== 'clean-exit') fileLog('child-gone', details);
  });

  app.on('before-quit', () => { isQuitting = true; });

  app.on('window-all-closed', () => {
    // No-op on Windows — the tray keeps the app alive in the background
    // so series recording / auto-update keep working when the producer
    // closes the control window. Quit happens through the tray menu.
    if (process.platform === 'darwin') return;
    // If there's no tray for some reason (icon missing), fall back to
    // the previous quit-on-last-window behavior so the app isn't stuck.
    if (!tray) {
      if (bridgeHandle) bridgeHandle.stop();
      if (serverHandle) serverHandle.stop();
      app.quit();
    }
  });
  app.on('quit', () => {
    if (bridgeHandle) bridgeHandle.stop();
    if (serverHandle) serverHandle.stop();
  });
}
