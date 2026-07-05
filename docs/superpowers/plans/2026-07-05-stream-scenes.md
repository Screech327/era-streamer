# Stream Scenes (Broadcast Screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five ERA-branded full-screen broadcast scenes (Starting Soon, Intermission, Be Right Back, Thank You, Casters' Desk) to the existing `matchup-graphic.html` source, selectable from the ERA control panel.

**Architecture:** Generalize the already-served `matchup-graphic.html` full-screen source. It reads a new `screen` field on the existing `stream_matchup_graphic` settings row; `screen === 'matchup'` keeps today's behavior, any other value renders a scene built by a new `overlay/scenes-core.js` module using data the overlay already fetches (tonight's slate, the pushed matchup, the local archive). The control panel's Matchup tab gains a screen picker + per-scene fields. No new OBS URL.

**Tech Stack:** Vanilla ES5-style browser JS (matches `matchup-graphic-core.js`), Node's built-in `http` server (`src/server.js`), `node:test` for unit tests, no bundler.

## Global Constraints

- No new browser-source URL: the scenes render inside `overlay/matchup-graphic.html` (served at `/matchup-graphic.html`). Backward-compatible: default `screen: 'matchup'` preserves current matchup-card behavior.
- Browser modules are UMD-style: attach to `window.*` AND `module.exports` (so `node:test` can require them), exactly like `overlay/boost-smoothing.js`.
- Match existing code style in the file you touch (ES5 `var`/`function` in the overlay JS; the control panel uses the same).
- Design system (verbatim): palette near-black `#090909`/`#0e0e11`, gold `#dcc174`, red accent `#e63946`, white ink; fonts Bebas Neue / Rajdhani / Orbitron; real socials `eliterocketassociation.com`, Discord `discord.gg/A66WJ45mqY`, Twitch `twitch.tv/eliterocketassociation`. The approved markup/CSS lives on branch `scene-mockups` at `mockups/scenes/` — that is the visual source of truth.
- Scenes shipped: `starting-soon`, `intermission`, `brb`, `thank-you`, `casters-desk`.
- Countdown holds at `0:00` at zero (no auto-swap). Optional per time-based scene (starting-soon, brb, intermission).
- Commit after every task. Do not push tags (a `v*` tag triggers a release build).

## File Structure

- Create `overlay/scenes.css` — scene styles (port of `mockups/scenes/scenes.css`), served like `matchup-graphic.css`.
- Create `overlay/scenes-core.js` — `SceneRenderer`: pure helpers (`formatCountdown`, `tonightSchedule`, `resolveTonightResults`) + DOM builders (`buildScene`). UMD.
- Create `test/scenes-core.test.js` — unit tests for the pure helpers.
- Modify `overlay/matchup-graphic.html` — link the new assets; branch `renderNow` on `cfg.screen`; tick the countdown.
- Modify `src/server.js` — extend the `stream_matchup_graphic` default; add static routes for `scenes.css` + `scenes-core.js`.
- Modify `ui/control.html` — screen picker + per-scene fields on the Matchup tab; extend `cfg` + listeners.
- Modify `.github/workflows/release.yml` — run the new test file.

---

### Task 1: `scenes-core.js` pure helpers (countdown, schedule, results)

**Files:**
- Create: `overlay/scenes-core.js`
- Test: `test/scenes-core.test.js`
- Modify: `.github/workflows/release.yml:35`

**Interfaces:**
- Produces:
  - `formatCountdown(endsAtISO, nowMs) -> string` — `"M:SS"` remaining, clamped at `"0:00"`; returns `"0:00"` for missing/invalid input.
  - `tonightSchedule(matchups) -> Array<{home,away,time}>` — passthrough shaping of `MatchupCore.resolveTonight(...)` output (each item has `.home`, `.away`, `.time`), sorted by `time` ascending; first item flagged `upNext:true`.
  - `resolveTonightResults(localArchive, nowMs) -> Array<{left:{name,logo},right:{name,logo},leftWins,rightWins,format}>` — series in `localArchive.series` whose `savedAt` is the same calendar day (America/New_York) as `nowMs`; `leftWins`/`rightWins` = count of `games[].winnerTeamNum` (0=left,1=right), falling back to `teamScores[0]>teamScores[1]` when `winnerTeamNum` is null.

- [ ] **Step 1: Write the failing test**

Create `test/scenes-core.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { formatCountdown, tonightSchedule, resolveTonightResults } = require('../overlay/scenes-core.js');

test('formatCountdown formats remaining time as M:SS', () => {
  const now = Date.parse('2026-07-05T20:00:00Z');
  assert.equal(formatCountdown('2026-07-05T20:04:32Z', now), '4:32');
  assert.equal(formatCountdown('2026-07-05T20:00:05Z', now), '0:05');
});

test('formatCountdown clamps at 0:00 and handles bad input', () => {
  const now = Date.parse('2026-07-05T20:00:00Z');
  assert.equal(formatCountdown('2026-07-05T19:59:00Z', now), '0:00'); // past
  assert.equal(formatCountdown(null, now), '0:00');
  assert.equal(formatCountdown('not-a-date', now), '0:00');
});

test('tonightSchedule sorts by time and flags the first as upNext', () => {
  const rows = tonightSchedule([
    { home: { name: 'B' }, away: { name: 'A' }, time: '2026-07-05T22:30:00Z' },
    { home: { name: 'D' }, away: { name: 'C' }, time: '2026-07-05T21:00:00Z' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].away.name, 'C');       // earlier time first
  assert.equal(rows[0].upNext, true);
  assert.equal(rows[1].upNext, false);
});

test('resolveTonightResults returns today\'s series with win counts', () => {
  const now = Date.parse('2026-07-05T23:00:00Z'); // evening ET
  const archive = { series: [
    { savedAt: '2026-07-05T22:00:00Z', format: 'BO7',
      matchup: { left: { name: 'Night Furies', logo: 'a.png' }, right: { name: 'Tides', logo: 'b.png' } },
      games: [ { winnerTeamNum: 0 }, { winnerTeamNum: 0 }, { winnerTeamNum: 1 }, { winnerTeamNum: 0 } ] },
    { savedAt: '2026-06-28T22:00:00Z', format: 'BO5', matchup: { left:{name:'Old'}, right:{name:'Old2'} }, games: [] },
  ] };
  const res = resolveTonightResults(archive, now);
  assert.equal(res.length, 1);
  assert.equal(res[0].left.name, 'Night Furies');
  assert.equal(res[0].leftWins, 3);
  assert.equal(res[0].rightWins, 1);
});

test('resolveTonightResults falls back to teamScores when winnerTeamNum is null', () => {
  const now = Date.parse('2026-07-05T23:00:00Z');
  const archive = { series: [
    { savedAt: '2026-07-05T22:00:00Z', format: 'BO5',
      matchup: { left: { name: 'L' }, right: { name: 'R' } },
      games: [ { winnerTeamNum: null, teamScores: [3, 1] }, { winnerTeamNum: null, teamScores: [0, 2] } ] },
  ] };
  const res = resolveTonightResults(archive, now);
  assert.equal(res[0].leftWins, 1);
  assert.equal(res[0].rightWins, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scenes-core.test.js`
Expected: FAIL — `Cannot find module '../overlay/scenes-core.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `overlay/scenes-core.js`:

```javascript
// Scene data helpers + DOM builders for the ERA Streamer broadcast screens.
// UMD so node:test can require the pure helpers; the overlay loads it as a
// plain <script> and uses window.SceneRenderer.
(function (root) {
  'use strict';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function formatCountdown(endsAtISO, nowMs) {
    var end = Date.parse(endsAtISO);
    if (!isFinite(end)) return '0:00';
    var remaining = Math.max(0, Math.floor((end - nowMs) / 1000));
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    return m + ':' + pad2(s);
  }

  function tonightSchedule(matchups) {
    var rows = (matchups || []).slice().filter(function (m) { return m; });
    rows.sort(function (a, b) { return Date.parse(a.time || 0) - Date.parse(b.time || 0); });
    return rows.map(function (m, i) {
      return { home: m.home, away: m.away, time: m.time, upNext: i === 0 };
    });
  }

  // Same calendar day in America/New_York (the league's timezone).
  function sameEtDay(aMs, bMs) {
    var opts = { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Intl.DateTimeFormat('en-US', opts).format(aMs) ===
           new Intl.DateTimeFormat('en-US', opts).format(bMs);
  }

  function seriesWins(games) {
    var left = 0, right = 0;
    (games || []).forEach(function (g) {
      var w = g && g.winnerTeamNum;
      if (w === 0 || w === 1) { if (w === 0) left++; else right++; return; }
      var ts = (g && g.teamScores) || [];
      if ((ts[0] || 0) > (ts[1] || 0)) left++;
      else if ((ts[1] || 0) > (ts[0] || 0)) right++;
    });
    return { leftWins: left, rightWins: right };
  }

  function resolveTonightResults(localArchive, nowMs) {
    var series = (localArchive && localArchive.series) || [];
    return series
      .filter(function (s) { return s && s.savedAt && sameEtDay(Date.parse(s.savedAt), nowMs); })
      .map(function (s) {
        var w = seriesWins(s.games);
        var mu = s.matchup || {};
        return {
          left: mu.left || { name: 'BLUE' },
          right: mu.right || { name: 'ORANGE' },
          leftWins: w.leftWins,
          rightWins: w.rightWins,
          format: s.format || 'BO5',
        };
      });
  }

  var api = {
    formatCountdown: formatCountdown,
    tonightSchedule: tonightSchedule,
    resolveTonightResults: resolveTonightResults,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SceneRenderer = api;
})(typeof window !== 'undefined' ? window : null);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scenes-core.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add the test to the release workflow**

In `.github/workflows/release.yml`, change the "Run unit tests" line (currently runs `matchup-core.test.js bridge.test.js boost-smoothing.test.js`) to also run the new file:

```yaml
        run: node --test test/matchup-core.test.js test/bridge.test.js test/boost-smoothing.test.js test/scenes-core.test.js
```

- [ ] **Step 6: Commit**

```bash
git add overlay/scenes-core.js test/scenes-core.test.js .github/workflows/release.yml
git commit -m "feat(scenes): scene data helpers (countdown, schedule, results) + tests"
```

---

### Task 2: Scene styles + DOM builders in `scenes-core.js`

**Files:**
- Create: `overlay/scenes.css`
- Modify: `overlay/scenes-core.js`

**Interfaces:**
- Consumes: `formatCountdown` (Task 1); `MatchupCore.colorForTeam`, `MatchupCore.TEAM_DATA` for logos/colors (already loaded on the page).
- Produces: `SceneRenderer.buildScene(screen, data) -> HTMLElement` where `screen` is one of `'starting-soon'|'intermission'|'brb'|'thank-you'|'casters-desk'` and `data` is:
  ```
  { league: string, week: string,
    countdown: { on: boolean, endsAt: string } | null,
    mainEvent: { home:{name,logo,color}, away:{name,logo,color}, format:string } | null, // starting-soon
    schedule: Array<{home:{name,logo}, away:{name,logo}, time:string, upNext:boolean}>,  // intermission
    results: Array<{left:{name,logo}, right:{name,logo}, leftWins, rightWins}>,          // thank-you
    tagline: string,                                                                     // brb / starting-soon
    casters: Array<{name,role}>, deskTopic: string,                                      // casters-desk
    nowMs: number }
  ```
  The returned element is a full `1920×1080` `.scene-stage` node ready to mount.

- [ ] **Step 1: Create `overlay/scenes.css`**

Copy the approved stylesheet verbatim from the repo: the file `mockups/scenes/scenes.css` on branch `scene-mockups`. Retrieve it with:

```bash
git show scene-mockups:mockups/scenes/scenes.css > overlay/scenes.css
```

Then make two edits so it is scoped and asset paths resolve on the overlay host:
1. The background/watermark rules are applied to `body` in the mockup. Re-scope them to a `.scene-stage` wrapper class instead of `body` (find each `body`, `body::before`, `body::after` selector and replace with `.scene-stage`, `.scene-stage::before`, `.scene-stage::after`) so the scene styles don't fight the matchup-card page styles.
2. Change the watermark URL `url('era-logo.png')` to `url('/images/era-logo.png')` (asset served from the overlay images dir — see Task 3, Step 1).

- [ ] **Step 2: Add the ERA logo to the served images dir**

```bash
cp ../ERA-Web/public/icon-512.png overlay/images/era-logo.png
```
(Absolute-safe: the logo is the ELITE ERA shield used in the mockups. `overlay/images/` is already served at `/images/`.)

- [ ] **Step 3: Add the DOM builders to `overlay/scenes-core.js`**

Insert these functions above the `var api = {...}` export block, and add `buildScene: buildScene` to the exported `api` object. The markup mirrors the committed mockups (`git show scene-mockups:mockups/scenes/<scene>.html`); reproduce each scene's inner markup, substituting the dynamic values noted per scene. Shared helpers first:

```javascript
  function elh(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function chrome(data, wkText) {
    // Shared top bar + footer + watermark, returned as an HTML string.
    return '' +
      '<div class="top">' +
        '<div class="brand"><img class="brand-logo" src="/images/era-logo.png" alt="ERA"></div>' +
        '<div class="meta"><div class="lg">' + esc(data.league || 'ERA') + '</div>' +
          '<div class="wk">' + esc(wkText || data.week || '') + '</div></div>' +
      '</div>';
  }
  function footer() {
    return '' +
      '<div class="rule"></div>' +
      '<div class="bottom">' +
        '<div class="social"><span class="ic">WEB</span> <b>eliterocketassociation.com</b></div>' +
        '<div class="social"><span class="ic">DISCORD</span> <b>discord.gg/A66WJ45mqY</b></div>' +
        '<div class="social"><span class="ic">TWITCH</span> <b>twitch.tv/eliterocketassociation</b></div>' +
      '</div>';
  }
  function countdownBlock(data, label) {
    if (!data.countdown || !data.countdown.on) return '';
    var clock = formatCountdown(data.countdown.endsAt, data.nowMs);
    return '<div class="count"><div class="lbl">' + esc(label) + '</div>' +
           '<div class="clock" data-countdown="1">' + clock + '</div></div>';
  }
```

Then the Starting Soon builder (full example — the others follow the same pattern with their own mockup markup):

```javascript
  function buildStartingSoon(data) {
    var me = data.mainEvent;
    var event = '';
    if (me) {
      event =
        '<div class="upnext"><div class="un-lbl" style="text-align:center">TONIGHT\'S MAIN EVENT</div>' +
        '<div class="un-row">' +
          '<div class="un-team"><img src="' + esc(me.away.logo) + '"><div><div class="nm">' + esc(me.away.name) + '</div>' +
            '<div class="bar" style="background:' + esc(me.away.color) + '"></div></div></div>' +
          '<div class="un-vs">VS<span class="un-fmt">' + esc(me.format || 'BEST OF 5') + '</span></div>' +
          '<div class="un-team right"><img src="' + esc(me.home.logo) + '">' +
            '<div style="text-align:right"><div class="nm">' + esc(me.home.name) + '</div>' +
            '<div class="bar" style="margin-left:auto;background:' + esc(me.home.color) + '"></div></div></div>' +
        '</div></div>';
    }
    return chrome(data) +
      '<div class="center"><div class="eyebrow">LIVE SHORTLY</div>' +
        '<div class="title">STARTING <span class="accent">SOON</span></div>' +
        countdownBlock(data, 'STREAM BEGINS IN') + event +
      '</div>' + footer();
  }
```

Reproduce the remaining four builders from their committed mockup markup, injecting these dynamic values (everything else is static markup copied from the mockup):

- **`buildIntermission(data)`** — title `INTER<span class="accent">MISSION</span>`; optional `countdownBlock(data,'RESUMING IN')`; then the schedule list: for each `data.schedule` row emit an `.s-row` (add class `live` and a `<div class="s-badge">UP NEXT</div>` when `row.upNext`), with `row.away`/`row.home` names+logos and `row.time` formatted to `h:MM AM/PM ET` (use `new Date(row.time).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'})`).
- **`buildBRB(data)`** — title `BE RIGHT <span class="accent">BACK</span>`; `<div class="tagline">` = `esc(data.tagline || 'Grabbing a quick break — the action resumes shortly.')`; optional `countdownBlock(data,'BACK IN')`.
- **`buildThankYou(data)`** — title `THANK YOU <span class="accent">FOR WATCHING</span>`; then a `.sched` block labeled `TONIGHT'S RESULTS`, one `.res-row` per `data.results` entry with the scoped result styles from the mockup (`.res-row`, `.r-teams`, `.win .w-tag`, `.r-score`, `.r-final`); winner side (the one with more wins) gets class `win` + a gold `W` tag; score shown as `leftWins + ' – ' + rightWins`. Include the mockup's scoped `<style>` for `.res-*` by moving those rules into `scenes.css`.
- **`buildCastersDesk(data)`** — the two `.cam` slots with name plates from `data.casters[0]`/`[1]` (`name`, `role`), and the `.lower3` topic = `esc(data.deskTopic || '')`. Include the mockup's scoped desk `<style>` rules in `scenes.css`.

Finally the dispatcher:

```javascript
  function buildScene(screen, data) {
    data = data || {};
    var stage = document.createElement('div');
    stage.className = 'scene-stage';
    var inner = document.createElement('div');
    inner.className = 'stage';
    var html;
    switch (screen) {
      case 'starting-soon': html = buildStartingSoon(data); break;
      case 'intermission':  html = buildIntermission(data); break;
      case 'brb':           html = buildBRB(data); break;
      case 'thank-you':     html = buildThankYou(data); break;
      case 'casters-desk':  html = buildCastersDesk(data); break;
      default:              html = buildBRB(data); break;
    }
    inner.innerHTML = html;
    stage.appendChild(inner);
    return stage;
  }
```

Move the `.res-*` and `.cam/.desk/.lower3` scoped styles from the Thank You and Casters' Desk mockups into `overlay/scenes.css` (retrieve via `git show scene-mockups:mockups/scenes/thank-you.html` and `casters-desk.html`, copy the `<style>` bodies).

- [ ] **Step 4: Verify the module still loads (no syntax break)**

Run: `node --check overlay/scenes-core.js`
Expected: no output (exit 0). (DOM builders aren't unit-tested — they're verified visually in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add overlay/scenes.css overlay/scenes-core.js overlay/images/era-logo.png
git commit -m "feat(scenes): scene stylesheet + DOM builders (ported from approved mockups)"
```

---

### Task 3: Server — state default + static routes

**Files:**
- Modify: `src/server.js:60` (the `stream_matchup_graphic` default)
- Modify: `src/server.js:312` (near the `boost-smoothing.js` route)

**Interfaces:**
- Consumes: nothing new.
- Produces: `/scenes.css` and `/scenes-core.js` served from `overlayDir`; `stream_matchup_graphic` default gains scene fields.

- [ ] **Step 1: Extend the `stream_matchup_graphic` default**

In `src/server.js`, replace the default value object on the `stream_matchup_graphic` line with (adds scene fields; existing fields unchanged):

```javascript
    stream_matchup_graphic: { value: { screen: 'matchup', mode: 'current', showStats: true, showSeries: true, statMode: 'highlight', slateIndex: 0, subs: { home: {}, away: {} }, countdown: { on: false, endsAt: null }, tagline: '', casters: [ { name: '', role: 'PLAY-BY-PLAY' }, { name: '', role: 'COLOR / ANALYST' } ], deskTopic: '' }, updated_at: new Date().toISOString() },
```

- [ ] **Step 2: Add the static routes**

In `src/server.js`, directly after the existing `boost-smoothing.js` route block (the `if (req.method === 'GET' && pathname === '/boost-smoothing.js') { ... }`), add:

```javascript
    if (req.method === 'GET' && (pathname === '/scenes.css' || pathname === '/scenes-core.js')) {
      return serveStatic(res, overlayDir, pathname.slice(1));
    }
```

- [ ] **Step 3: Verify server still parses**

Run: `node --check src/server.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat(scenes): serve scene assets + add scene fields to overlay state"
```

---

### Task 4: Overlay — branch `renderNow` on `screen`, tick the countdown

**Files:**
- Modify: `overlay/matchup-graphic.html` (the `<head>` asset links, and the `renderNow` / `init` script block)

**Interfaces:**
- Consumes: `SceneRenderer.buildScene`, `SceneRenderer.tonightSchedule`, `SceneRenderer.resolveTonightResults`, `SceneRenderer.formatCountdown`; existing `cloud`, `agg`, `MatchupCore`.
- Produces: the overlay renders a scene when `cfg.screen !== 'matchup'`.

- [ ] **Step 1: Link the new assets**

In `overlay/matchup-graphic.html` `<head>`, add after the existing stylesheet link:

```html
  <link rel="stylesheet" href="scenes.css">
```
And after `<script src="matchup-graphic-core.js"></script>`, add:

```html
  <script src="scenes-core.js"></script>
```

- [ ] **Step 2: Fetch the local archive for results**

In the `init()` cloud fetch chain, after `cloud = d;`, add a local-archive read so Thank You has data:

```javascript
        localGet('local_archive').then(function (la) { window.__localArchive = la || { series: [] }; });
```

- [ ] **Step 3: Branch `renderNow` on the screen**

At the very top of `renderNow(cfg, match, series)` (before the existing matchup logic), insert:

```javascript
      cfg = cfg || {};
      if (cfg.screen && cfg.screen !== 'matchup') {
        renderScene(cfg, match, series);
        return;
      }
```

- [ ] **Step 4: Add `renderScene` + countdown ticking**

Add these functions inside the same IIFE (near `renderNow`):

```javascript
    var countdownTimer = null;

    function currentMainEvent(match) {
      var mu = buildFromCurrent(match);
      if (mu) return { home: sideMeta(mu.home, mu.league), away: sideMeta(mu.away, mu.league),
                       format: (window.__series && window.__series.format) || '' };
      return null;
    }
    function sideMeta(side, league) {
      return { name: (side.name || '').toUpperCase(), logo: side.logo,
               color: C.colorForTeam(side.org, league) };
    }
    function scheduleData() {
      var slate = C.resolveTonight(cloud.scheduled, cloud.players, new Date());
      return window.SceneRenderer.tonightSchedule(slate.map(function (m) {
        return { home: { name: (m.home.name||'').toUpperCase(), logo: m.home.logo },
                 away: { name: (m.away.name||'').toUpperCase(), logo: m.away.logo }, time: m.time };
      }));
    }
    function renderScene(cfg, match, series) {
      window.__series = series || {};
      var data = {
        league: (C.LEAGUE_LABELS[/* current league label if known */ ''] || 'ELITE ROCKET ASSOCIATION'),
        week: 'WEEK ' + C.getCurrentEraWeek(new Date()),
        countdown: cfg.countdown || null,
        mainEvent: cfg.screen === 'starting-soon' ? currentMainEvent(match) : null,
        schedule: cfg.screen === 'intermission' ? scheduleData() : [],
        results: cfg.screen === 'thank-you'
          ? window.SceneRenderer.resolveTonightResults(window.__localArchive || { series: [] }, Date.now()) : [],
        tagline: cfg.tagline || '',
        casters: cfg.casters || [{ name: '', role: '' }, { name: '', role: '' }],
        deskTopic: cfg.deskTopic || '',
        nowMs: Date.now(),
      };
      stage.innerHTML = '';
      stage.appendChild(window.SceneRenderer.buildScene(cfg.screen, data));
      startCountdownTick(cfg);
    }
    function startCountdownTick(cfg) {
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      if (!(cfg.countdown && cfg.countdown.on)) return;
      countdownTimer = setInterval(function () {
        var el = stage.querySelector('[data-countdown]');
        if (el) el.textContent = window.SceneRenderer.formatCountdown(cfg.countdown.endsAt, Date.now());
      }, 1000);
    }
```

Note: `LEAGUE_LABELS` lookup for the league line is best-effort; if the current league isn't resolvable, the default `'ELITE ROCKET ASSOCIATION'` string is fine (the mockups show the league name here — wire it from `match.left.league` via `C.ADMIN_TO_PUBLIC` + `C.LEAGUE_LABELS` if available, else the default).

- [ ] **Step 5: Manual smoke test (no live data needed)**

Run the app and open the matchup preview. Temporarily write a scene selection:
```bash
curl -s -X POST http://127.0.0.1:49124/rest/v1/settings -H 'Content-Type: application/json' \
  -d '{"key":"stream_matchup_graphic","value":{"screen":"brb","tagline":"Testing","countdown":{"on":true,"endsAt":"2026-07-05T23:59:00Z"}}}'
```
Open `http://127.0.0.1:49124/matchup-graphic.html` in Chrome.
Expected: the BRB scene renders with the tagline and a ticking countdown.

- [ ] **Step 6: Commit**

```bash
git add overlay/matchup-graphic.html
git commit -m "feat(scenes): render scenes from overlay state with live countdown"
```

---

### Task 5: Control panel — screen picker + per-scene fields

**Files:**
- Modify: `ui/control.html` (Matchup-tab markup ~`1740-1790`, and the `cfg` block/listeners ~`2842-2969`)

**Interfaces:**
- Consumes: existing `upsert('stream_matchup_graphic', cfg)`, `$()`, `setToggle`.
- Produces: control-panel writes `screen`, `countdown`, `tagline`, `casters`, `deskTopic` into `stream_matchup_graphic`.

- [ ] **Step 1: Add the screen picker + scene fields markup**

In the Matchup tab (`data-pane="matchup"`), above the existing `mg_mode` field, add a screen picker; and after the existing matchup controls, add a scene-fields container (shown per screen):

```html
  <div class="field">
    <label>SCREEN</label>
    <select class="select select-lg" id="mg_screen">
      <option value="matchup">Matchup Card</option>
      <option value="starting-soon">Starting Soon</option>
      <option value="intermission">Intermission</option>
      <option value="brb">Be Right Back</option>
      <option value="thank-you">Thank You</option>
      <option value="casters-desk">Casters' Desk</option>
    </select>
  </div>

  <div id="mg_sceneFields">
    <div class="field" id="mg_countdownField" hidden>
      <label>COUNTDOWN</label>
      <button class="btn btn-toggle" id="mg_countdownOn" data-on="false">TIMER: OFF</button>
      <input class="input" id="mg_countdownMins" type="text" placeholder="5:00" style="width:90px">
    </div>
    <div class="field" id="mg_taglineField" hidden>
      <label>TAGLINE</label>
      <input class="input" id="mg_tagline" type="text" placeholder="Grabbing a quick break…">
    </div>
    <div class="field" id="mg_deskField" hidden>
      <label>CASTERS' DESK</label>
      <input class="input" id="mg_caster1" type="text" placeholder="Caster 1 name">
      <input class="input" id="mg_caster2" type="text" placeholder="Caster 2 name">
      <input class="input" id="mg_deskTopic" type="text" placeholder="Topic / talking point">
    </div>
  </div>
```

- [ ] **Step 2: Extend the `cfg` default**

Change the `cfg` initializer (~line 2842) to include the scene fields:

```javascript
  var cfg = { screen:'matchup', mode:'current', showStats:true, showSeries:true, statMode:'highlight', slateIndex:0, subs:{ home:{}, away:{} },
              countdown:{ on:false, endsAt:null }, tagline:'', casters:[{name:'',role:'PLAY-BY-PLAY'},{name:'',role:'COLOR / ANALYST'}], deskTopic:'' };
```

- [ ] **Step 3: Load the new fields from state**

In the settings loader (the `fetch(... key=eq.stream_matchup_graphic ...)` `.then`, ~line 2943), after the existing `cfg.*` assignments add:

```javascript
          cfg.screen = v.screen || 'matchup';
          cfg.countdown = v.countdown || { on:false, endsAt:null };
          cfg.tagline = v.tagline || '';
          cfg.casters = v.casters || [{name:'',role:'PLAY-BY-PLAY'},{name:'',role:'COLOR / ANALYST'}];
          cfg.deskTopic = v.deskTopic || '';
```
And after the existing control-value sync (~line 2961) add:
```javascript
    $('mg_screen').value = cfg.screen;
    $('mg_tagline').value = cfg.tagline;
    $('mg_caster1').value = (cfg.casters[0]||{}).name || '';
    $('mg_caster2').value = (cfg.casters[1]||{}).name || '';
    $('mg_deskTopic').value = cfg.deskTopic;
    setToggle($('mg_countdownOn'), cfg.countdown.on, 'TIMER: ON', 'TIMER: OFF');
    applyScreenVisibility();
```

- [ ] **Step 4: Add visibility + listeners**

Add an `applyScreenVisibility` helper and wire listeners (near the existing `applyModeVisibility`/listeners ~line 2939-2969):

```javascript
  function applyScreenVisibility() {
    var s = cfg.screen;
    var timed = (s === 'starting-soon' || s === 'brb' || s === 'intermission');
    $('mg_countdownField').hidden = !timed;
    $('mg_taglineField').hidden = !(s === 'brb' || s === 'starting-soon');
    $('mg_deskField').hidden = (s !== 'casters-desk');
    // Existing matchup-only controls stay usable when screen==='matchup'.
  }
  function parseMinsToEndsAt(txt) {
    var parts = String(txt || '').split(':');
    var secs = parts.length === 2 ? (parseInt(parts[0],10)||0)*60 + (parseInt(parts[1],10)||0)
                                  : (parseInt(parts[0],10)||0)*60;
    return new Date(Date.now() + secs*1000).toISOString();
  }
  $('mg_screen').addEventListener('change', function(){ cfg.screen = $('mg_screen').value; applyScreenVisibility(); writeCfg(); });
  $('mg_countdownOn').addEventListener('click', function(){
    cfg.countdown.on = !cfg.countdown.on;
    if (cfg.countdown.on) cfg.countdown.endsAt = parseMinsToEndsAt($('mg_countdownMins').value || '5:00');
    setToggle($('mg_countdownOn'), cfg.countdown.on, 'TIMER: ON', 'TIMER: OFF');
    writeCfg();
  });
  $('mg_countdownMins').addEventListener('change', function(){
    if (cfg.countdown.on) { cfg.countdown.endsAt = parseMinsToEndsAt($('mg_countdownMins').value); writeCfg(); }
  });
  $('mg_tagline').addEventListener('change', function(){ cfg.tagline = $('mg_tagline').value; writeCfg(); });
  $('mg_caster1').addEventListener('change', function(){ cfg.casters[0] = { name:$('mg_caster1').value, role:'PLAY-BY-PLAY' }; writeCfg(); });
  $('mg_caster2').addEventListener('change', function(){ cfg.casters[1] = { name:$('mg_caster2').value, role:'COLOR / ANALYST' }; writeCfg(); });
  $('mg_deskTopic').addEventListener('change', function(){ cfg.deskTopic = $('mg_deskTopic').value; writeCfg(); });
```

- [ ] **Step 5: Manual test**

Launch the app. On the Matchup tab, pick each screen from the SCREEN dropdown; confirm the preview iframe switches, the countdown toggle + tagline + caster fields show/hide correctly, and editing them updates the preview live (via the existing `SettingsChanged` WebSocket).

- [ ] **Step 6: Commit**

```bash
git add ui/control.html
git commit -m "feat(scenes): control-panel screen picker + per-scene fields"
```

---

### Task 6: Full-suite check + cleanup

**Files:** none (verification).

- [ ] **Step 1: Run the whole test suite**

Run: `node --test test/matchup-core.test.js test/bridge.test.js test/boost-smoothing.test.js test/scenes-core.test.js`
Expected: all pass, 0 fail.

- [ ] **Step 2: Syntax-check touched files**

Run: `node --check src/server.js && node --check overlay/scenes-core.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Manual end-to-end**

With the app running, cycle all five scenes from the control panel and confirm each renders on `/matchup-graphic.html` with correct dynamic data (main event on Starting Soon, schedule on Intermission, results on Thank You, caster names/topic on Casters' Desk) and that `screen: 'matchup'` still shows the original matchup card unchanged.

- [ ] **Step 4: Remove the temporary public preview (separate repo)**

Once shipped, delete `public/mockups/stream-scenes.html` + `public/mockups/scenes/` from `ERA-Web` and delete the `era-streamer` `scene-mockups` branch. (Tracked in the spec's "out of scope" note.)

---

## Self-Review

**Spec coverage:**
- One shared source / generalize matchup-graphic → Task 4. ✅
- 5 scenes incl. Casters' Desk → Task 2 (builders) + Task 4 (render). ✅
- Dynamic data (main event, schedule, results) from existing plumbing → Task 1 (helpers) + Task 4 (wiring). ✅
- Optional countdown holding at 0:00 → Task 1 (`formatCountdown`) + Task 4 (tick) + Task 5 (toggle). ✅
- State on `stream_matchup_graphic` → Task 3. ✅
- Control-panel picker + fields → Task 5. ✅
- Tests wired into release workflow → Task 1 Step 5. ✅
- Subtle watermark / real socials / Thank You = results → Task 2 (from approved mockups). ✅

**Placeholder scan:** DOM-builder markup references committed mockup files (real, retrievable via `git show scene-mockups:...`), not placeholders; the league-label line has an explicit best-effort fallback rather than a TODO. No "TBD"/"handle edge cases" steps.

**Type consistency:** `buildScene(screen, data)`, `formatCountdown(endsAtISO, nowMs)`, `tonightSchedule(matchups)`, `resolveTonightResults(localArchive, nowMs)` used identically in Tasks 1/2/4. `cfg` field names (`screen`, `countdown.on`, `countdown.endsAt`, `tagline`, `casters[].name/role`, `deskTopic`) match across server default (Task 3), overlay read (Task 4), and control write (Task 5).
