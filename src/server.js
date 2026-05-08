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

const PORT = 49124;

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

function start({ overlayDir, uiDir, statePath, onLog }) {
  // ── Persisted state (match config, series, overlay flags) ────────────
  const defaultState = {
    stream_match:           { value: {}, updated_at: new Date().toISOString() },
    stream_series:          { value: { format: 'BO5', leftWins: 0, rightWins: 0 }, updated_at: new Date().toISOString() },
    stream_overlay_config:  { value: { noBridge: false }, updated_at: new Date().toISOString() },
    player_aliases:         { value: {}, updated_at: new Date().toISOString() },
  };
  let state = { ...defaultState };
  try {
    if (statePath && fs.existsSync(statePath)) {
      const loaded = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state = { ...defaultState, ...loaded };
    }
  } catch (_) {}

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

    return send(res, 404, 'not found');
  });

  // ── WebSocket — live RL stats relay ──────────────────────────────────
  const wss = new WebSocketServer({ server });
  const wsClients = new Set();
  wss.on('connection', (ws) => {
    wsClients.add(ws);
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
      if (onLog) onLog(`server listening on http://127.0.0.1:${PORT}`);
      resolve({
        port: PORT,
        relayBridgeMessage,
        setStatus,
        getState: () => state,
        stop: () => { try { server.close(); } catch (_) {} },
      });
    });
  });
}

module.exports = { start };
