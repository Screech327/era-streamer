# ERA Streamer

ERA Rocket League broadcast overlay — desktop app.

Bundles the match overlay, the local stats bridge, and a control window into a
single Electron app. No website, no Supabase, no terminal — install, launch,
copy the OBS URL, you're streaming.

## v0.1 status

- ✅ Electron app skeleton (`src/main.js`)
- ✅ Single embedded HTTP + WebSocket server on `127.0.0.1:49124` (`src/server.js`)
- ✅ Bundled overlay (`overlay/match.html` — adapted to talk to local server)
- ✅ Bundled team logos (`overlay/images/`)
- ✅ Embedded TCP→WS bridge to RL's native StatsAPI (`src/bridge.js`)
- ✅ RL `DefaultStatsAPI.ini` auto-config at 100Hz (`src/rl-config.js`)
- ✅ Bundled team data + live roster fetch w/ offline fallback (`src/teams.js`)
- ✅ Control window — match picker, series tracker, bridge toggle (`ui/control.html`)
- ⏳ Post-game stats card (deferred)
- ⏳ Series recording / archive upload (deferred)
- ⏳ System tray icon (deferred)
- ⏳ Auto-updater + signed installer (deferred)

## Run locally

```
npm install
npm start
```

In OBS, add a Browser Source pointing to:

```
http://127.0.0.1:49124/match.html
```

## Architecture

```
RL native stats TCP → 49123 → bridge.js → server.js
                                            │
                                            ├─ HTTP /match.html  ← OBS browser
                                            ├─ HTTP /control     ← in-app window
                                            ├─ HTTP /rest/v1/... ← Supabase shape
                                            └─ WS  /              ← live game state
```

The overlay HTML reuses the production overlay's logic — the local server
exposes a Supabase-shaped `/rest/v1/settings` endpoint so we don't have to
fork the renderer.

## State persistence

Match config, series, overlay flags persist to:

```
%APPDATA%\era-streamer\state.json
```

so launching the app reopens the last pushed match.
