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
const { autoUpdater } = require('electron-updater');

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
      appVersion: app.getVersion(),
      onLog: (m) => console.log('[server]', m),
      // Renderer-driven update controls — control.html POSTs to these
      // endpoints to drive the autoUpdater without a native dialog.
      onUpdateCheck:   () => autoUpdater.checkForUpdates().catch((e) => console.log('[updater]', e && e.message || e)),
      onUpdateInstall: () => autoUpdater.quitAndInstall(true, true), // (isSilent=true, isForceRunAfter=true)
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
