// HTTP + WebSocket server that the OBS browser source and the in-app control
// window both connect to. Single port — keeps the OBS URL stable and avoids
// CORS issues with separate origins.
//
// HTTP routes:
//   GET  /                         → redirect to /match.html
//   GET  /match.html               → overlay file
//   GET  /images/...               → team logo assets
//   GET  /control                  → control panel HTML (used by Electron)
//   GET  /rest/v1/settings?key=eq.X→ Supabase-shaped read so we can reuse the
//                                    existing overlay without rewriting its
//                                    fetchMatch/fetchSeries/etc.
//   POST /rest/v1/settings         → upsert (control panel writes match state)
//   GET  /api/players?league&code  → drafted-roster lookup (live or bundled)
//   GET  /api/teams                → bundled TEAM_DATA for the picker UI
//   GET  /api/status               → bridge / config status pill
// WS:
//   any path                       → live RL stats broadcast

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const teams = require('./teams');

// PORT defaults to the canonical era-streamer port. Tests/dev override
// it via ERA_STREAMER_PORT so a running app doesn't block the test
// server from binding.
const PORT = parseInt(process.env.ERA_STREAMER_PORT || '49124', 10);

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.ico':'image/x-icon',
};

// ERA's hosted Supabase — same anon key the website's admin pages use, so
// "SAVE SERIES STATS" pushes a recorded series straight into the public
// archive. Anon key is a public credential; safe to embed.
const ERA_SUPABASE_URL = 'https://qamonwkxafbzvyrlisjv.supabase.co';
const ERA_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbW9ud2t4YWZienZ5cmxpc2p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MzQ3NjcsImV4cCI6MjA5MTUxMDc2N30.AOKN9Ioz5m8Om2CutdlTownmoEbZ3DFVcAHovhhj7wM';

function start({ overlayDir, uiDir, statePath, appVersion, onLog, onUpdateCheck, onUpdateInstall, onWindowMinimize, onWindowMaximize, onWindowClose, onAutoLaunchGet, onAutoLaunchSet, onBridgeReconnect }) {
  // ── Persisted state (match config, series, overlay flags) ────────────
  const defaultState = {
    stream_match:           { value: {}, updated_at: new Date().toISOString() },
    stream_series:          { value: { format: 'BO5', leftWins: 0, rightWins: 0 }, updated_at: new Date().toISOString() },
    stream_overlay_config:  { value: { noBridge: false }, updated_at: new Date().toISOString() },
    // Matchup-graphic overlay state (read by /matchup-graphic.html, written by
    // the control panel's Matchup tab). mode: 'current' (the pushed stream_match)
    // or 'slate' (tonight's scheduled matchups, indexed by slateIndex). subs maps
    // a side+slot to a substitute player name.
    stream_matchup_graphic: { value: { screen: 'matchup', mode: 'current', showStats: true, showSeries: true, statMode: 'highlight', slateIndex: 0, subs: { home: {}, away: {} }, countdown: { on: false, endsAt: null }, tagline: '', casters: [ { name: '', role: 'PLAY-BY-PLAY' }, { name: '', role: 'COLOR / ANALYST' } ], deskTopic: '' }, updated_at: new Date().toISOString() },
    player_aliases:         { value: {}, updated_at: new Date().toISOString() },
    // Series recording is always-on for era-streamer — every match end gets
    // captured automatically. The producer hits SAVE SERIES STATS at the
    // end of the series to move it into the local archive.
    stream_recording:       { value: { active: true, games: [] }, updated_at: new Date().toISOString() },
    // Local-only archive of saved sessions. Capped at `capacity` most
    // recent; older ones drop off automatically. `recordingEnabled` lets
    // the producer turn off auto-capture entirely from the Settings tab.
    local_archive:          { value: { capacity: 25, recordingEnabled: true, series: [] }, updated_at: new Date().toISOString() },
    // First-run wizard completion flag and recent-matchups list (most-
    // recent first, capped at 5). Together they make the daily flow
    // smoother for repeat users.
    app_prefs:              { value: { firstRunComplete: false, recentMatchups: [] }, updated_at: new Date().toISOString() },
    // Last window bounds — persisted on resize/move so the producer's
    // preferred layout sticks across launches. null until first save.
    window_bounds:          { value: null, updated_at: new Date().toISOString() },
  };
  let state = { ...defaultState };
  let stateLoaded = false;
  try {
    if (statePath && fs.existsSync(statePath)) {
      const loaded = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state = { ...defaultState, ...loaded };
      stateLoaded = true;
    }
  } catch (_) {}

  // Upgrading-user fix: if state.json was already on disk but had no
  // app_prefs (because it predates v0.11.0), they've used the app before
  // — don't show the first-run wizard at them.
  if (stateLoaded) {
    const prefs = state.app_prefs && state.app_prefs.value;
    if (!prefs || prefs.firstRunComplete !== true) {
      state.app_prefs = state.app_prefs || { value: {}, updated_at: new Date().toISOString() };
      state.app_prefs.value = Object.assign({}, prefs || {}, { firstRunComplete: true });
      state.app_prefs.updated_at = new Date().toISOString();
    }
  }

  function saveState() {
    if (!statePath) return;
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (e) { if (onLog) onLog('state-save-failed: ' + (e.code || e.message)); }
  }

  // The overlay now reads player names + boosts straight from the live RL
  // bridge (`Players[].Name`/`.Boost`/`.TeamNum`). No roster lookups.

  // ── Status (used by the control window's connection pill) ────────────
  const status = {
    rlConnected: false,
    bridgeStarted: false,
    iniResult: null,
  };
  function setStatus(patch) {
    Object.assign(status, patch);
    broadcastJSON({ Event: 'StreamerStatus', Data: status });
  }

  // ── Update state (driven by main.js's autoUpdater event hooks) ───────
  // status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  const updateState = { status: 'idle', version: null, percent: 0, error: null, appVersion: appVersion || '0.0.0' };
  function setUpdateState(patch) {
    Object.assign(updateState, patch);
  }

  // ── Session recording — main.js calls this on each match end ─────────
  function appendRecordingGame(game) {
    if (!game || !game.matchGuid) return;
    // Recording can be disabled from the Settings tab — when off, the
    // bridge still flows through, we just don't accumulate.
    const arc = state.local_archive.value || {};
    if (arc.recordingEnabled === false) return;
    const rec = state.stream_recording.value || { active: true, games: [] };
    rec.games = rec.games || [];
    if (rec.games.some((g) => g.matchGuid === game.matchGuid)) return; // dedupe
    rec.games.push(game);
    state.stream_recording.value = rec;
    state.stream_recording.updated_at = new Date().toISOString();
    saveState();
    if (onLog) onLog(`recording: captured match ${rec.games.length} (${game.matchGuid.slice(0, 8)})`);
  }

  // Save the current recording to the local archive (state.json). Capped
  // at the configured capacity — oldest series falls off when full.
  // Resolves matchup metadata from the active stream_match selection.
  function saveSeries() {
    const rec = state.stream_recording.value || {};
    const games = rec.games || [];
    if (!games.length) throw new Error('No games captured yet — record a series first.');
    const match = state.stream_match.value || {};
    if (!match.left || !match.right) throw new Error('No matchup pushed — pick teams in the MATCH panel and PUSH TO OVERLAY first.');

    const teamsMod = require('./teams');
    const leftTm  = teamsMod.lookupTeam(match.left.slot,  match.left.league);
    const rightTm = teamsMod.lookupTeam(match.right.slot, match.right.league);
    if (!leftTm || !rightTm) throw new Error('Unknown team slot in the active matchup.');

    const seriesVal = state.stream_series.value || {};
    const fmt = seriesVal.format || (games.length <= 5 ? 'BO5' : 'BO7');

    const series = {
      id: (require('crypto').randomUUID && require('crypto').randomUUID()) || ('es_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      name: `${leftTm.fullName} vs ${rightTm.fullName}`,
      savedAt: new Date().toISOString(),
      format: fmt,
      games,
      matchup: {
        left:  { code: leftTm.code,  league: leftTm.league,  name: leftTm.name,  org: leftTm.org,  gm: leftTm.gm,  logo: leftTm.logo },
        right: { code: rightTm.code, league: rightTm.league, name: rightTm.name, org: rightTm.org, gm: rightTm.gm, logo: rightTm.logo },
      },
      source: 'era-streamer',
    };

    // Append to local archive and trim to capacity (newest first).
    const arc = state.local_archive.value || { capacity: 25, series: [] };
    arc.series = [series, ...(arc.series || [])];
    const cap = Math.max(1, arc.capacity || 25);
    if (arc.series.length > cap) arc.series = arc.series.slice(0, cap);
    state.local_archive.value = arc;
    state.local_archive.updated_at = new Date().toISOString();

    // Clear the recording — next series captures fresh.
    state.stream_recording.value = { active: true, games: [] };
    state.stream_recording.updated_at = new Date().toISOString();
    saveState();
    return series;
  }

  function deleteLocalSeries(id) {
    const arc = state.local_archive.value || { capacity: 25, series: [] };
    const before = (arc.series || []).length;
    arc.series = (arc.series || []).filter((s) => s.id !== id);
    state.local_archive.value = arc;
    state.local_archive.updated_at = new Date().toISOString();
    saveState();
    return before !== arc.series.length;
  }

  function setArchiveCapacity(n) {
    const cap = Math.max(1, Math.min(500, parseInt(n, 10) || 25));
    const arc = state.local_archive.value || { capacity: 25, series: [] };
    arc.capacity = cap;
    if ((arc.series || []).length > cap) arc.series = arc.series.slice(0, cap);
    state.local_archive.value = arc;
    state.local_archive.updated_at = new Date().toISOString();
    saveState();
    return cap;
  }

  function setRecordingEnabled(on) {
    const arc = state.local_archive.value || { capacity: 25, series: [] };
    arc.recordingEnabled = !!on;
    state.local_archive.value = arc;
    state.local_archive.updated_at = new Date().toISOString();
    // When turning OFF, also clear any games already accumulated so we
    // don't accidentally save them later.
    if (!on) {
      state.stream_recording.value = { active: true, games: [] };
      state.stream_recording.updated_at = new Date().toISOString();
    }
    saveState();
    return arc.recordingEnabled;
  }

  function resetRecording() {
    state.stream_recording.value = { active: true, games: [] };
    state.stream_recording.updated_at = new Date().toISOString();
    saveState();
  }

  // Auto-advance the series counter when a match ends. Caps at the format's
  // win threshold (3 for BO5, 4 for BO7) so over-firing PodiumStart events
  // can't push it past the legal max.
  function advanceSeriesWin(winnerTeamNum) {
    if (winnerTeamNum !== 0 && winnerTeamNum !== 1) return;
    const cur = state.stream_series.value || { format: 'BO5', leftWins: 0, rightWins: 0 };
    const cap = cur.format === 'BO7' ? 4 : 3;
    if (winnerTeamNum === 0) cur.leftWins  = Math.min(cap, (cur.leftWins  || 0) + 1);
    else                     cur.rightWins = Math.min(cap, (cur.rightWins || 0) + 1);
    state.stream_series.value = cur;
    state.stream_series.updated_at = new Date().toISOString();
    saveState();
  }

  // ── HTTP server ──────────────────────────────────────────────────────
  function send(res, code, body, headers) {
    res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store' }, headers || {}));
    res.end(body);
  }
  function sendJson(res, code, obj) {
    send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
  }
  function safeJoin(root, rel) {
    const p = path.normalize(path.join(root, rel.replace(/^\/+/, '')));
    if (!p.startsWith(root)) return null;
    return p;
  }

  function serveStatic(res, root, relPath) {
    let decoded;
    try { decoded = decodeURIComponent(relPath); }
    catch { return send(res, 400, 'bad path'); }
    const full = safeJoin(root, decoded);
    if (!full) return send(res, 403, 'forbidden');
    fs.readFile(full, (err, data) => {
      if (err) return send(res, 404, 'not found');
      const mime = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      send(res, 200, data, { 'Content-Type': mime });
    });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // CORS — overlay or external tools can read the API
    if (req.method === 'OPTIONS') {
      return send(res, 204, '', {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Static
    if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
      res.writeHead(302, { Location: '/match.html' });
      return res.end();
    }
    if (req.method === 'GET' && pathname === '/match.html') {
      return serveStatic(res, overlayDir, 'match.html');
    }
    if (req.method === 'GET' && (pathname === '/matchup-graphic.html' || pathname === '/matchup-graphic-core.js' || pathname === '/matchup-graphic.css')) {
      return serveStatic(res, overlayDir, pathname.slice(1));
    }
    if (req.method === 'GET' && pathname === '/boost-smoothing.js') {
      return serveStatic(res, overlayDir, pathname.slice(1));
    }
    if (req.method === 'GET' && (pathname === '/scenes.css' || pathname === '/scenes-core.js')) {
      return serveStatic(res, overlayDir, pathname.slice(1));
    }
    if (req.method === 'GET' && pathname.startsWith('/images/')) {
      return serveStatic(res, overlayDir, pathname);
    }
    if (req.method === 'GET' && pathname === '/control') {
      return serveStatic(res, uiDir, 'control.html');
    }
    if (req.method === 'GET' && pathname.startsWith('/ui/')) {
      return serveStatic(res, uiDir, pathname.slice('/ui/'.length));
    }

    // Supabase-shaped settings reads (used by overlay's existing fetch calls)
    if (req.method === 'GET' && pathname === '/rest/v1/settings') {
      const keyParam = url.searchParams.get('key') || '';
      const m = keyParam.match(/^eq\.(.+)$/);
      if (!m) return sendJson(res, 200, []);
      const key = m[1];
      const row = state[key];
      if (!row) return sendJson(res, 200, []);
      return sendJson(res, 200, [{ value: row.value, updated_at: row.updated_at }]);
    }

    // Supabase-shaped upsert (used by the control panel)
    if (req.method === 'POST' && pathname === '/rest/v1/settings') {
      let body;
      try { body = await readBody(req); }
      catch { return sendJson(res, 400, { error: 'invalid json' }); }
      if (!body.key) return sendJson(res, 400, { error: 'missing key' });
      state[body.key] = {
        value: body.value,
        updated_at: body.updated_at || new Date().toISOString(),
      };
      saveState();
      // Notify every connected overlay (OBS browser source + control panel
      // preview iframe) so config changes apply instantly instead of
      // waiting on the next 2s poll cycle.
      broadcastJSON({
        Event: 'SettingsChanged',
        Data: { key: body.key, value: state[body.key].value, updated_at: state[body.key].updated_at },
      });
      return sendJson(res, 200, [state[body.key]]);
    }

    if (req.method === 'GET' && pathname === '/api/teams') {
      return sendJson(res, 200, {
        teams: teams.TEAM_DATA,
        leagueKeys: teams.LEAGUE_KEYS,
        leagueLabels: teams.LEAGUE_LABELS,
      });
    }
    if (req.method === 'GET' && pathname === '/api/status') {
      return sendJson(res, 200, status);
    }
    if (req.method === 'GET' && pathname === '/api/update/state') {
      return sendJson(res, 200, updateState);
    }
    if (req.method === 'POST' && pathname === '/api/update/check') {
      if (typeof onUpdateCheck === 'function') onUpdateCheck();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/update/install') {
      if (typeof onUpdateInstall === 'function') {
        // Defer slightly so the response can flush before the app quits.
        setTimeout(() => onUpdateInstall(), 200);
      }
      return sendJson(res, 200, { ok: true });
    }

    // App preferences — first-run wizard flag, recent matchups list.
    if (req.method === 'GET' && pathname === '/api/prefs') {
      const prefs = state.app_prefs.value || {};
      return sendJson(res, 200, {
        firstRunComplete: !!prefs.firstRunComplete,
        recentMatchups:   Array.isArray(prefs.recentMatchups) ? prefs.recentMatchups : [],
      });
    }
    if (req.method === 'POST' && pathname === '/api/prefs/first-run-complete') {
      const prefs = state.app_prefs.value || {};
      prefs.firstRunComplete = true;
      state.app_prefs.value = prefs;
      state.app_prefs.updated_at = new Date().toISOString();
      saveState();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/prefs/recent-matchups/add') {
      let body;
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
      if (!body || !body.league || body.leftSlot == null || body.rightSlot == null) {
        return sendJson(res, 400, { error: 'missing league/leftSlot/rightSlot' });
      }
      const prefs = state.app_prefs.value || {};
      const list = Array.isArray(prefs.recentMatchups) ? prefs.recentMatchups : [];
      const sig = body.league + '|' + body.leftSlot + '|' + body.rightSlot;
      const filtered = list.filter((m) => (m.league + '|' + m.leftSlot + '|' + m.rightSlot) !== sig);
      filtered.unshift({
        league: body.league,
        leftSlot: body.leftSlot,
        rightSlot: body.rightSlot,
        title: body.title || '',
        savedAt: new Date().toISOString(),
      });
      prefs.recentMatchups = filtered.slice(0, 5);
      state.app_prefs.value = prefs;
      state.app_prefs.updated_at = new Date().toISOString();
      saveState();
      return sendJson(res, 200, { ok: true, recentMatchups: prefs.recentMatchups });
    }

    // Auto-launch toggle (Windows login item).
    if (req.method === 'GET' && pathname === '/api/auto-launch') {
      const enabled = typeof onAutoLaunchGet === 'function' ? !!onAutoLaunchGet() : false;
      return sendJson(res, 200, { enabled });
    }
    if (req.method === 'POST' && pathname === '/api/auto-launch') {
      let body;
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
      const enabled = !!body.enabled;
      if (typeof onAutoLaunchSet === 'function') onAutoLaunchSet(enabled);
      return sendJson(res, 200, { ok: true, enabled });
    }

    // Custom titlebar wiring — frameless window in main.js, controls
    // driven from control.html via these endpoints.
    if (req.method === 'POST' && pathname === '/api/window/minimize') {
      if (typeof onWindowMinimize === 'function') onWindowMinimize();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/window/maximize') {
      if (typeof onWindowMaximize === 'function') onWindowMaximize();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/window/close') {
      if (typeof onWindowClose === 'function') onWindowClose();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/recording') {
      const rec = state.stream_recording.value || { games: [] };
      return sendJson(res, 200, {
        gameCount: (rec.games || []).length,
        games: rec.games || [],
      });
    }
    if (req.method === 'POST' && pathname === '/api/series/save') {
      try {
        const series = saveSeries();
        return sendJson(res, 200, { ok: true, series: { id: series.id, name: series.name, gameCount: series.games.length } });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: (e && e.message) || String(e) });
      }
    }
    if (req.method === 'POST' && pathname === '/api/series/reset') {
      resetRecording();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/local-archive') {
      const arc = state.local_archive.value || { capacity: 25, series: [] };
      return sendJson(res, 200, {
        capacity: arc.capacity || 25,
        recordingEnabled: arc.recordingEnabled !== false,
        series: arc.series || [],
      });
    }
    if (req.method === 'POST' && pathname === '/api/local-archive/recording-enabled') {
      let body;
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
      const on = setRecordingEnabled(body.enabled);
      return sendJson(res, 200, { ok: true, recordingEnabled: on });
    }
    if (req.method === 'POST' && pathname === '/api/local-archive/delete') {
      let body;
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
      if (!body.id) return sendJson(res, 400, { error: 'missing id' });
      const removed = deleteLocalSeries(body.id);
      return sendJson(res, 200, { ok: true, removed });
    }
    if (req.method === 'POST' && pathname === '/api/local-archive/capacity') {
      let body;
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
      const cap = setArchiveCapacity(body.capacity);
      return sendJson(res, 200, { ok: true, capacity: cap });
    }
    // Notes — applied to a session as a whole, or to a specific game
    // within that session (matched by matchGuid). Body shape:
    //   { id: <sessionId>, note: "..." }                    → session note
    //   { id: <sessionId>, matchGuid: "...", note: "..." }  → per-game note
    if (req.method === 'POST' && pathname === '/api/local-archive/note') {
      let body;
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
      if (!body.id) return sendJson(res, 400, { error: 'missing id' });
      const note = String(body.note == null ? '' : body.note).slice(0, 2000);
      const arc = state.local_archive.value || {};
      const list = arc.series || [];
      const session = list.find((s) => s.id === body.id);
      if (!session) return sendJson(res, 404, { error: 'session not found' });
      if (body.matchGuid) {
        const game = (session.games || []).find((g) => g.matchGuid === body.matchGuid);
        if (!game) return sendJson(res, 404, { error: 'game not found' });
        game.note = note;
      } else {
        session.note = note;
      }
      state.local_archive.value = arc;
      state.local_archive.updated_at = new Date().toISOString();
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    // Bridge reconnect — drops the current TCP socket; bridge.js auto-
    // retries every 1.5s, so the producer doesn't have to wait it out.
    if (req.method === 'POST' && pathname === '/api/bridge/reconnect') {
      if (typeof onBridgeReconnect === 'function') onBridgeReconnect();
      return sendJson(res, 200, { ok: true });
    }

    return send(res, 404, 'not found');
  });

  // ── WebSocket — live RL stats relay ──────────────────────────────────
  const wss = new WebSocketServer({ server });
  const wsClients = new Set();
  // Server-level WS errors aren't tied to a single socket, so the
  // per-socket `ws.on('error')` below isn't enough — without this, a
  // transport error during the WS upgrade would bubble out and crash
  // the main process.
  wss.on('error', (err) => { if (onLog) onLog('ws-server-error: ' + ((err && err.message) || err)); });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    // Send a hello with the current app version. The overlay uses this
    // to detect that the server restarted on a newer build and reloads
    // itself — no more "right-click → Refresh cache" in OBS after every
    // era-streamer update.
    try { ws.send(JSON.stringify({ Event: 'ServerHello', Data: { version: appVersion || '0.0.0' } })); } catch (_) {}
    // Replay the last known UpdateState to the new client so it doesn't have
    // to wait for the next RL tick to populate.
    if (lastUpdate) { try { ws.send(JSON.stringify(lastUpdate)); } catch (_) {} }
    // Also send current status so the control window shows the right pill
    try { ws.send(JSON.stringify({ Event: 'StreamerStatus', Data: status })); } catch (_) {}
    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => {});
  });

  let lastUpdate = null;
  function broadcastJSON(obj) {
    const str = JSON.stringify(obj);
    for (const ws of wsClients) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(str); } catch (_) {}
      }
    }
  }
  function relayBridgeMessage(msg) {
    if (msg && msg.Event === 'UpdateState') lastUpdate = msg;
    broadcastJSON(msg);
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => {
      // Swap the one-shot startup reject for a persistent logger so a
      // post-startup HTTP error (client RST, socket hangup, etc.)
      // doesn't propagate as an uncaught exception.
      server.removeListener('error', reject);
      server.on('error', (err) => { if (onLog) onLog('http-server-error: ' + ((err && err.message) || err)); });
      if (onLog) onLog(`server listening on http://127.0.0.1:${PORT}`);
      resolve({
        port: PORT,
        relayBridgeMessage,
        setStatus,
        setUpdateState,
        appendRecordingGame,
        advanceSeriesWin,
        getState: () => state,
        // Window-bounds persistence — main.js calls these to restore
        // size/position on launch and save on resize/move.
        getWindowBounds: () => (state.window_bounds && state.window_bounds.value) || null,
        saveWindowBounds: (b) => {
          if (!b) return;
          state.window_bounds = { value: { x: b.x, y: b.y, width: b.width, height: b.height }, updated_at: new Date().toISOString() };
          saveState();
        },
        stop: () => { try { server.close(); } catch (_) {} },
      });
    });
  });
}

module.exports = { start };
