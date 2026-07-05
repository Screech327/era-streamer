// TCP→WebSocket bridge for Rocket League's native StatsAPI export.
// Lifted from era-rl-admin/bridge with the standalone-script bits removed
// (no console banners, no auto-config — main.js does that on app boot).
//
// Listens for the RL stats TCP server on 127.0.0.1:49123. Each JSON message
// is unwrapped (RL escapes Data as a string) and re-broadcast to every
// connected WebSocket client.

const net = require('net');
const { StringDecoder } = require('string_decoder');

const RL_HOST = '127.0.0.1';
const RL_PORT = 49123;

// Hard cap on a single in-progress object. RL UpdateState payloads are tens
// of KB; if we ever blow past this the parser has desynced on garbage — drop
// the buffer and resync rather than grow it for the rest of the stream (this
// was a latent OOM: a desync meant `buf` grew unbounded until the app died).
const MAX_BUFFER = 4 * 1024 * 1024;

class JsonStreamParser {
  constructor() {
    this.decoder = new StringDecoder('utf8'); // joins multi-byte chars split across TCP chunks
    this.reset();
  }
  reset() { this.buf = ''; this.depth = 0; this.inStr = false; this.esc = false; }
  feed(chunkBuf, onMessage) {
    // Decode through StringDecoder so a UTF-8 char split across two TCP
    // packets (e.g. a unicode player name) isn't corrupted — corruption
    // used to desync the brace/quote counting and wedge the parser.
    const chunk = this.decoder.write(chunkBuf);
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      // Between top-level objects, skip anything that isn't the start of a
      // new object (whitespace, stray bytes) so junk can't accumulate and a
      // post-desync stream resyncs cleanly at the next '{'.
      if (this.depth === 0 && !this.inStr && c !== '{') continue;
      this.buf += c;
      if (this.inStr) {
        if (this.esc) { this.esc = false; continue; }
        if (c === '\\') { this.esc = true; continue; }
        if (c === '"') this.inStr = false;
      } else {
        if (c === '"') this.inStr = true;
        else if (c === '{') this.depth++;
        else if (c === '}') {
          this.depth--;
          if (this.depth === 0) {
            const raw = this.buf;
            this.buf = '';
            try {
              const obj = JSON.parse(raw);
              if (typeof obj.Data === 'string') {
                try { obj.Data = JSON.parse(obj.Data); } catch (_) {}
              }
              onMessage(obj);
            } catch (_) {}
          } else if (this.depth < 0) {
            this.reset(); // stray '}' — desync; resync at the next object
          }
        }
      }
    }
    if (this.buf.length > MAX_BUFFER) this.reset();
  }
}

function startBridge({ onUpdate, onConnect, onDisconnect }) {
  let sock = null;
  let reconnectTimer = null;
  let stopped = false;

  function connect() {
    reconnectTimer = null;
    if (stopped) return;
    sock = new net.Socket();
    const parser = new JsonStreamParser();
    let connected = false;

    sock.connect(RL_PORT, RL_HOST, () => {
      connected = true;
      if (onConnect) onConnect();
    });

    sock.on('data', (chunk) => {
      parser.feed(chunk, (msg) => {
        if (onUpdate) {
          // A bad payload throwing inside the consumer used to take down
          // the whole TCP read pipeline (and bubble up further).
          try { onUpdate(msg); } catch (_) {}
        }
      });
    });

    sock.on('error', () => { /* swallow — onclose retries */ });

    sock.on('close', () => {
      const wasConnected = connected;
      connected = false;
      if (wasConnected && onDisconnect) onDisconnect();
      if (stopped) return;
      // Auto-reconnect — when RL closes/restarts the next attempt picks it up.
      reconnectTimer = setTimeout(connect, 1500);
    });
  }

  connect();

  return {
    stop: () => {
      stopped = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      try { if (sock) sock.destroy(); } catch (_) {}
    },
    // Force-close the current socket so the on-close handler kicks the
    // auto-reconnect immediately. Used by the "Retry connection" button
    // in the control panel.
    reconnect: () => { try { if (sock) sock.destroy(); } catch (_) {} },
  };
}

module.exports = { startBridge, JsonStreamParser };
