// TCP→WebSocket bridge for Rocket League's native StatsAPI export.
// Lifted from era-rl-admin/bridge with the standalone-script bits removed
// (no console banners, no auto-config — main.js does that on app boot).
//
// Listens for the RL stats TCP server on 127.0.0.1:49123. Each JSON message
// is unwrapped (RL escapes Data as a string) and re-broadcast to every
// connected WebSocket client.

const net = require('net');

const RL_HOST = '127.0.0.1';
const RL_PORT = 49123;

class JsonStreamParser {
  constructor() {
    this.buf = '';
    this.depth = 0;
    this.inStr = false;
    this.esc = false;
  }
  feed(chunk, onMessage) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
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
          }
        }
      }
    }
  }
}

function startBridge({ onUpdate, onConnect, onDisconnect }) {
  let lastUpdate = null;
  let sock = null;

  function connect() {
    sock = new net.Socket();
    const parser = new JsonStreamParser();
    let connected = false;

    sock.connect(RL_PORT, RL_HOST, () => {
      connected = true;
      if (onConnect) onConnect();
    });

    sock.on('data', (chunk) => {
      parser.feed(chunk.toString('utf8'), (msg) => {
        if (msg.Event === 'UpdateState') lastUpdate = msg;
        if (onUpdate) onUpdate(msg);
      });
    });

    sock.on('error', () => { /* swallow — onclose retries */ });

    sock.on('close', () => {
      const wasConnected = connected;
      connected = false;
      lastUpdate = null;
      if (wasConnected && onDisconnect) onDisconnect();
      // Auto-reconnect — when RL closes/restarts the next attempt picks it up.
      setTimeout(connect, 1500);
    });
  }

  connect();

  return {
    getLastUpdate: () => lastUpdate,
    stop: () => { try { if (sock) sock.destroy(); } catch (_) {} },
  };
}

module.exports = { startBridge };
