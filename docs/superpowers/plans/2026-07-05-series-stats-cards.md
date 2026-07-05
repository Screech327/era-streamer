# Series Stats Cards (Feature B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an In-Series cumulative-stats card (a new Broadcast Screen) and a Totals/Averages toggle on the pre-match matchup card.

**Architecture:** Both render inside the existing Broadcast Screen source (`matchup-graphic.html`) and are picked from the control panel. Two shared, testable primitives in `matchup-graphic-core.js` — `sumSeriesGames` (games → per-player totals) and `statCells`/`statRowEl` (render a player's stats as totals or averages) — back both cards. The in-series card reads the live local recording (`stream_recording`); the pre-match card keeps using the season archive.

**Tech Stack:** Vanilla ES5-style browser JS (matches `matchup-graphic-core.js`), Node `http` (`src/server.js`), `node:test`, no bundler.

## Global Constraints

- All display code is ES5 (`var`/`function`), matching `overlay/matchup-graphic-core.js`. No template literals/arrow funcs/`const`/`let` in that file.
- `matchup-graphic-core.js` is UMD (`module.exports` + `window.MatchupCore`); new exported helpers go on the `MatchupCore` object AND stay unit-testable via `require`.
- Stat display rules (verbatim): default mode is **totals**; **score is always per-game** (rounded integer); goals is **always shown both ways** (primary flips with mode, the other in small text); counting stats (goals/assists/saves/shots/demos) are integers in totals mode and 1-decimal per-game in averages mode.
- Recording game shape: `game.players` keyed by id, each `{name, teamNum(0|1), score, goals, assists, saves, shots, demos}`; `game.teamScores[0|1]`; `game.winnerTeamNum`.
- Backward compatibility: a stored `statMode` of `'highlight'` or `'full'` maps to `'averages'`; anything else → `'totals'`.
- New screen value is `'series-stats'`; `teamNum 0` = left team, `teamNum 1` = right team.
- Commit after each task. Do NOT push, do NOT create `v*` tags (a tag triggers a release).

## File Structure

- Modify `overlay/matchup-graphic-core.js` — add `sumSeriesGames`, `statCells`, `statRowEl`, `normalizeStatMode`; rewrite `renderPlayer`'s stat block to use them; export the new helpers.
- Modify `overlay/matchup-graphic.html` — `renderSeriesStats`; branch `renderNow` on `'series-stats'`; fetch `stream_recording` in `refresh()` + refresh on its WS change.
- Modify `overlay/matchup-graphic.css` — a small `.mg-chip-sub` style + series-header styles.
- Modify `src/server.js` — broadcast a settings change when a game is recorded.
- Modify `ui/control.html` — "In-Series Stats" in the screen picker; rename the stat-display dropdown to Totals/Averages; extend visibility.
- Modify `test/matchup-core.test.js` (or add `test/series-stats.test.js`) — tests for `sumSeriesGames` + `statCells`.

---

### Task 1: `sumSeriesGames` aggregator + tests

**Files:**
- Modify: `overlay/matchup-graphic-core.js` (add function + export)
- Test: `test/matchup-core.test.js`

**Interfaces:**
- Produces: `MatchupCore.sumSeriesGames(games) -> { players: Map<pid, totals>, wins: {0:number,1:number}, seriesGames: number }` where `totals = {name, teamNum, gamesPlayed, score, goals, assists, saves, shots, demos}`. `seriesGames` = `games.length`; per-player `gamesPlayed` = number of games that player appears in.

- [ ] **Step 1: Write the failing test**

Append to `test/matchup-core.test.js`:

```javascript
test('sumSeriesGames totals per player, team grouping, wins, seriesGames', () => {
  const { sumSeriesGames } = require('../overlay/matchup-graphic-core.js');
  const games = [
    { winnerTeamNum: 0, teamScores: [3, 1], players: {
      p1: { name: 'A', teamNum: 0, score: 300, goals: 2, assists: 1, saves: 0, shots: 4, demos: 1 },
      p2: { name: 'B', teamNum: 1, score: 200, goals: 1, assists: 0, saves: 2, shots: 3, demos: 0 } } },
    { winnerTeamNum: 1, teamScores: [0, 2], players: {
      p1: { name: 'A', teamNum: 0, score: 100, goals: 0, assists: 2, saves: 1, shots: 1, demos: 0 } } },
  ];
  const r = sumSeriesGames(games);
  assert.equal(r.seriesGames, 2);
  assert.deepEqual(r.wins, { 0: 1, 1: 1 });
  const a = r.players.get('p1');
  assert.equal(a.gamesPlayed, 2);
  assert.equal(a.score, 400);
  assert.equal(a.goals, 2);
  assert.equal(a.assists, 3);
  assert.equal(a.teamNum, 0);
  const b = r.players.get('p2');
  assert.equal(b.gamesPlayed, 1);
  assert.equal(b.saves, 2);
});

test('sumSeriesGames infers wins from teamScores when winnerTeamNum is null', () => {
  const { sumSeriesGames } = require('../overlay/matchup-graphic-core.js');
  const r = sumSeriesGames([
    { winnerTeamNum: null, teamScores: [4, 2], players: {} },
    { winnerTeamNum: null, teamScores: [1, 3], players: {} },
  ]);
  assert.deepEqual(r.wins, { 0: 1, 1: 1 });
});

test('sumSeriesGames handles empty input', () => {
  const { sumSeriesGames } = require('../overlay/matchup-graphic-core.js');
  const r = sumSeriesGames([]);
  assert.equal(r.seriesGames, 0);
  assert.equal(r.players.size, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/matchup-core.test.js`
Expected: FAIL — `sumSeriesGames is not a function`.

- [ ] **Step 3: Implement**

In `overlay/matchup-graphic-core.js`, add this function just above the `var MatchupCore = {` export block:

```javascript
  // Sum a series' captured games into per-player totals (keyed by the game's
  // player id), plus games won per team and the series game count. Ported from
  // match.html renderPostSeries; adds per-player gamesPlayed for averages.
  function sumSeriesGames(games) {
    var players = new Map();
    var wins = { 0: 0, 1: 0 };
    (games || []).forEach(function (g) {
      var w = g && g.winnerTeamNum;
      if (w === 0 || w === 1) { wins[w] += 1; }
      else {
        var s0 = (g && g.teamScores && g.teamScores[0]) || 0;
        var s1 = (g && g.teamScores && g.teamScores[1]) || 0;
        if (s0 > s1) wins[0] += 1; else if (s1 > s0) wins[1] += 1;
      }
      var pls = (g && g.players) || {};
      Object.keys(pls).forEach(function (pid) {
        var p = pls[pid];
        var e = players.get(pid);
        if (!e) { e = { name: p.name, teamNum: p.teamNum, gamesPlayed: 0, score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0 }; players.set(pid, e); }
        e.gamesPlayed += 1;
        e.score += p.score || 0;
        e.goals += p.goals || 0;
        e.assists += p.assists || 0;
        e.saves += p.saves || 0;
        e.shots += p.shots || 0;
        e.demos += p.demos || 0;
        if (p.name) e.name = p.name;
        if (p.teamNum != null) e.teamNum = p.teamNum;
      });
    });
    return { players: players, wins: wins, seriesGames: (games || []).length };
  }
```

Then add `sumSeriesGames: sumSeriesGames,` to the `MatchupCore` export object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/matchup-core.test.js`
Expected: PASS (all sumSeriesGames tests green).

- [ ] **Step 5: Commit**

```bash
git add overlay/matchup-graphic-core.js test/matchup-core.test.js
git commit -m "feat(stats): sumSeriesGames aggregator for series stats cards"
```

---

### Task 2: Stat display — `statCells` (tested) + `statRowEl` + pre-match card uses it

**Files:**
- Modify: `overlay/matchup-graphic-core.js` (`statCells`, `statRowEl`, `normalizeStatMode`; rewrite `renderPlayer` stat block; exports)
- Modify: `overlay/matchup-graphic.css` (`.mg-chip-sub`)
- Test: `test/matchup-core.test.js`

**Interfaces:**
- Consumes: `perGame` (existing), `fmt` (existing), `chip` (existing).
- Produces:
  - `MatchupCore.normalizeStatMode(m) -> 'totals'|'averages'` (`'highlight'`/`'full'` → `'averages'`, else `'totals'`).
  - `MatchupCore.statCells(t, mode) -> Array<{label, value, sub}>` — 6 cells `SC/G, G, A, SV, SH, DM`; `sub` is `''` except for goals.
  - `MatchupCore.statRowEl(t, mode) -> HTMLElement` (`.mg-pstats.mg-pstats-full`).

- [ ] **Step 1: Write the failing test**

Append to `test/matchup-core.test.js`:

```javascript
test('normalizeStatMode maps legacy + defaults to totals', () => {
  const { normalizeStatMode } = require('../overlay/matchup-graphic-core.js');
  assert.equal(normalizeStatMode('highlight'), 'averages');
  assert.equal(normalizeStatMode('full'), 'averages');
  assert.equal(normalizeStatMode('averages'), 'averages');
  assert.equal(normalizeStatMode('totals'), 'totals');
  assert.equal(normalizeStatMode(undefined), 'totals');
});

test('statCells totals mode: counting stats are totals, score per-game, goals both ways', () => {
  const { statCells } = require('../overlay/matchup-graphic-core.js');
  const t = { gamesPlayed: 24, score: 11853, goals: 31, assists: 22, saves: 38, shots: 98, demos: 23 };
  const cells = statCells(t, 'totals');
  const by = {}; cells.forEach(c => by[c.label] = c);
  assert.equal(by['SC/G'].value, '494');          // round(11853/24)
  assert.equal(by['G'].value, '31');               // total
  assert.equal(by['G'].sub, '1.3/g');              // goals per-game secondary
  assert.equal(by['A'].value, '22');
  assert.equal(by['DM'].value, '23');
});

test('statCells averages mode: per-game values, goals shows total as sub', () => {
  const { statCells } = require('../overlay/matchup-graphic-core.js');
  const t = { gamesPlayed: 24, score: 11853, goals: 31, assists: 22, saves: 38, shots: 98, demos: 23 };
  const cells = statCells(t, 'averages');
  const by = {}; cells.forEach(c => by[c.label] = c);
  assert.equal(by['SC/G'].value, '494');
  assert.equal(by['G'].value, '1.3');
  assert.equal(by['G'].sub, '31');                 // total goals secondary
  assert.equal(by['A'].value, '0.9');
});

test('statCells guards zero games (no NaN)', () => {
  const { statCells } = require('../overlay/matchup-graphic-core.js');
  const cells = statCells({ gamesPlayed: 0, score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0 }, 'averages');
  cells.forEach(c => assert.ok(!/NaN/.test(c.value + c.sub)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/matchup-core.test.js`
Expected: FAIL — `normalizeStatMode is not a function`.

- [ ] **Step 3: Implement the helpers**

In `overlay/matchup-graphic-core.js`, add above the export block:

```javascript
  function normalizeStatMode(m) {
    if (m === 'averages' || m === 'highlight' || m === 'full') return 'averages';
    return 'totals';
  }

  // 6 stat cells for one player. Score is always per-game (rounded). Counting
  // stats are totals in 'totals' mode and per-game (1 decimal) in 'averages'.
  // Goals always carries the other representation in `sub`.
  function statCells(t, mode) {
    t = t || {};
    var pg = perGame(t);
    var avg = (normalizeStatMode(mode) === 'averages');
    var scg = String(Math.round(pg.scorePG));
    function tot(k) { return String(t[k] || 0); }
    return [
      { label: 'SC/G', value: scg, sub: '' },
      { label: 'G',  value: avg ? fmt(pg.goalsPG)   : tot('goals'),
                     sub:   avg ? tot('goals')       : (fmt(pg.goalsPG) + '/g') },
      { label: 'A',  value: avg ? fmt(pg.assistsPG) : tot('assists'), sub: '' },
      { label: 'SV', value: avg ? fmt(pg.savesPG)   : tot('saves'),   sub: '' },
      { label: 'SH', value: avg ? fmt(pg.shotsPG)   : tot('shots'),   sub: '' },
      { label: 'DM', value: avg ? fmt(pg.demosPG)   : tot('demos'),   sub: '' },
    ];
  }

  function statRowEl(t, mode) {
    var row = el('div', 'mg-pstats mg-pstats-full');
    statCells(t, mode).forEach(function (c) {
      var chipEl = chip(c.label, c.value);
      if (c.sub) {
        var v = chipEl.querySelector('.mg-chip-v');
        var sub = el('span', 'mg-chip-sub', c.sub);
        if (v) v.appendChild(sub);
      }
      row.appendChild(chipEl);
    });
    return row;
  }
```

Add to the `MatchupCore` export object: `el: el, normalizeStatMode: normalizeStatMode, statCells: statCells, statRowEl: statRowEl,` (exporting the existing internal `el` element helper lets Task 3 reuse it).

- [ ] **Step 4: Rewrite `renderPlayer`'s stat block**

In `overlay/matchup-graphic-core.js`, replace the `if (opts.showStats !== false) { ... }` body inside `renderPlayer` (the `agg.get`/`perGame`/`statMode==='full'`/`else` block) with:

```javascript
    if (opts.showStats !== false) {
      var t = agg.get(String(pl.name).toLowerCase()) || blankTotals(pl.name);
      row.appendChild(statRowEl(t, opts.statMode));
    }
```

(`peers`, `minGames`, `pickBestOfRest` are now unused by `renderPlayer` — leave them in the signature; other callers/exports still reference `pickBestOfRest`. Do not delete them.)

- [ ] **Step 5: Add the sub-value CSS**

In `overlay/matchup-graphic.css`, add:

```css
.mg-chip-sub { font-family: 'Orbitron', monospace; font-weight: 700; font-size: 11px; color: var(--muted); margin-left: 4px; }
```

- [ ] **Step 6: Run tests + syntax**

Run: `node --test test/matchup-core.test.js && node --check overlay/matchup-graphic-core.js`
Expected: tests PASS; `--check` exit 0.

- [ ] **Step 7: Commit**

```bash
git add overlay/matchup-graphic-core.js overlay/matchup-graphic.css test/matchup-core.test.js
git commit -m "feat(stats): totals/averages stat rows; pre-match card uses them"
```

---

### Task 3: In-Series Stats screen (overlay render)

**Files:**
- Modify: `overlay/matchup-graphic.html` (add `renderSeriesStats`, branch `renderNow`, fetch `stream_recording`, WS trigger)
- Modify: `overlay/matchup-graphic.css` (series header styles)

**Interfaces:**
- Consumes: `C.sumSeriesGames`, `C.statRowEl`, `resolveActiveMatchup(cfg, match)` (exists), `C.colorForTeam`, `localGet`.

- [ ] **Step 1: Fetch the recording in `refresh()`**

In `overlay/matchup-graphic.html`, change `refresh()` to also read the recording and pass it through:

```javascript
    function refresh(){
      return Promise.all([
        localGet('stream_matchup_graphic'),
        localGet('stream_match'),
        localGet('stream_series'),
        localGet('stream_recording'),
      ]).then(function(r){ renderNow(r[0], r[1], r[2], r[3]); });
    }
```

- [ ] **Step 2: Branch `renderNow` for `series-stats`**

Change the `renderNow` signature to `function renderNow(cfg, match, series, recording){` and insert this branch immediately after the existing `cfg = cfg || {};` line, BEFORE the `if (cfg.screen && cfg.screen !== 'matchup')` scene branch:

```javascript
      if (cfg.screen === 'series-stats') { renderSeriesStats(cfg, match, recording); return; }
```

- [ ] **Step 3: Add `renderSeriesStats`**

Add this function inside the IIFE (near `renderScene`):

```javascript
    function renderSeriesStats(cfg, match, recording) {
      var el = C.el; // element helper exported from matchup-graphic-core.js (Task 2)
      var games = (recording && recording.games) || [];
      var mu = resolveActiveMatchup(cfg, match);
      if (!mu) { showMsg('Pick teams in the MATCH panel and PUSH TO OVERLAY'); return; }
      if (!games.length) { showMsg('No games recorded yet — the card fills in after game 1.'); return; }

      var agg = C.sumSeriesGames(games);
      var mode = C.normalizeStatMode(cfg.statMode);
      var leftColor  = C.colorForTeam(mu.home.name, mu.league);
      var rightColor = C.colorForTeam(mu.away.name, mu.league);

      function column(side, teamNum, team, color) {
        var col = document.createElement('div');
        col.className = 'mg-team mg-team-' + side;
        col.style.setProperty('--team', color);
        var head = document.createElement('div'); head.className = 'mg-team-head';
        var lw = document.createElement('div'); lw.className = 'mg-logo-wrap';
        if (team.logo) { var im = document.createElement('img'); im.className='mg-logo'; im.src=team.logo; im.onerror=function(){lw.classList.add('mg-logo-missing');im.remove();}; lw.appendChild(im); }
        else { lw.classList.add('mg-logo-missing'); }
        head.appendChild(lw);
        var nw = document.createElement('div'); nw.className='mg-team-name-wrap';
        var nm = document.createElement('div'); nm.className='mg-team-name'; nm.textContent = (team.name || '—').toUpperCase(); nw.appendChild(nm);
        var bar = document.createElement('div'); bar.className='mg-team-bar'; nw.appendChild(bar);
        head.appendChild(nw); col.appendChild(head);

        var list = [];
        agg.players.forEach(function (p) { if (p.teamNum === teamNum) list.push(p); });
        list.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });

        var players = document.createElement('div'); players.className='mg-players';
        list.forEach(function (p) {
          var prow = document.createElement('div'); prow.className='mg-player';
          var pn = document.createElement('div'); pn.className='mg-pname';
          var span = document.createElement('span'); span.className='mg-pn'; span.textContent = p.name || '—'; pn.appendChild(span);
          prow.appendChild(pn);
          prow.appendChild(C.statRowEl(p, mode));
          players.appendChild(prow);
        });
        col.appendChild(players);
        return col;
      }

      var card = document.createElement('div'); card.className = 'mg-card';
      card.style.setProperty('--accent', (C.LEAGUE_COLORS[mu.league] || '#888'));
      card.style.setProperty('--home', leftColor); card.style.setProperty('--away', rightColor);
      card.appendChild(el('div', 'mg-bg'));

      var eyebrow = el('div', 'mg-eyebrow');
      eyebrow.appendChild(el('span', 'mg-eyebrow-mark', 'ELITE ROCKET ASSOCIATION'));
      eyebrow.appendChild(el('span', 'mg-eyebrow-dot'));
      eyebrow.appendChild(el('span', 'mg-eyebrow-sub', 'SERIES STATS'));
      card.appendChild(eyebrow);

      var banner = el('div', 'mg-banner');
      banner.appendChild(el('div', 'mg-banner-league', 'THROUGH GAME ' + agg.seriesGames));
      var meta = el('div', 'mg-banner-meta');
      meta.appendChild(el('span', 'mg-banner-score', (agg.wins[0] || 0) + ' – ' + (agg.wins[1] || 0)));
      banner.appendChild(meta);
      card.appendChild(banner);

      var body = el('div', 'mg-body');
      body.appendChild(column('left', 0, mu.home, leftColor));
      var vs = el('div', 'mg-vs'); vs.appendChild(el('span', 'mg-vs-text', 'VS')); body.appendChild(vs);
      body.appendChild(column('right', 1, mu.away, rightColor));
      card.appendChild(body);

      stage.innerHTML = '';
      stage.appendChild(card);
    }
```

- [ ] **Step 4: Refresh on recording change (WS)**

In the WebSocket `onmessage` handler, add `stream_recording` to the keys that trigger `refresh()`:

```javascript
          if (msg && msg.Event === 'SettingsChanged' && msg.Data &&
              (msg.Data.key === 'stream_matchup_graphic' || msg.Data.key === 'stream_match' || msg.Data.key === 'stream_series' || msg.Data.key === 'stream_recording')){
            if (cloud) refresh();
          }
```

- [ ] **Step 5: Verify the inline script parses**

Run:
```bash
node -e 'const fs=require("fs"),cp=require("child_process");const h=fs.readFileSync("overlay/matchup-graphic.html","utf8");const m=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(h);fs.writeFileSync("/tmp/mg.js",m[1]);cp.execSync("node --check /tmp/mg.js");console.log("OK")'
```
Expected: `OK`. (Visual verification of the card happens in the app — note it as pending for the user.)

- [ ] **Step 6: Commit**

```bash
git add overlay/matchup-graphic.html overlay/matchup-graphic.css
git commit -m "feat(stats): in-series stats screen renders from the live recording"
```

---

### Task 4: Broadcast a change when a game is recorded

**Files:**
- Modify: `src/server.js` (`appendRecordingGame`)

**Interfaces:**
- Consumes: `broadcastJSON` (in scope in `start()`).

- [ ] **Step 1: Broadcast after append**

In `src/server.js`, in `appendRecordingGame`, after `saveState();` (and before/around the `onLog` line), add the broadcast so overlays re-fetch:

```javascript
    saveState();
    broadcastJSON({ Event: 'SettingsChanged', Data: { key: 'stream_recording' } });
    if (onLog) onLog(`recording: captured match ${rec.games.length} (${game.matchGuid.slice(0, 8)})`);
```

- [ ] **Step 2: Verify server parses**

Run: `node --check src/server.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat(stats): notify overlays when a game is recorded (in-series card refresh)"
```

---

### Task 5: Control panel — picker option, stat-mode rename, visibility

**Files:**
- Modify: `ui/control.html` (screen picker, stat-mode dropdown, `applyScreenVisibility`, load mapping)

**Interfaces:**
- Consumes: existing `cfg`, `writeCfg`, `applyScreenVisibility`, `applyModeVisibility`.

- [ ] **Step 1: Add the screen option**

In the `mg_screen` `<select>`, add after the `matchup` option:

```html
          <option value="series-stats">In-Series Stats</option>
```

- [ ] **Step 2: Rename the stat-display dropdown options**

Replace the two `mg_statMode` options with:

```html
            <option value="totals">Totals (+ score/game)</option>
            <option value="averages">Averages</option>
```

- [ ] **Step 3: Normalize legacy `statMode` on load**

In `loadExistingCfg`, replace the `cfg.statMode = v.statMode || 'highlight';` line with:

```javascript
          cfg.statMode = (v.statMode === 'averages' || v.statMode === 'highlight' || v.statMode === 'full') ? 'averages' : 'totals';
```

And in the `cfg` initializer, change `statMode:'highlight'` to `statMode:'totals'`.

- [ ] **Step 4: Show the stat controls for matchup + series-stats**

In `applyScreenVisibility` (the version added in the scenes work), the matchup-only rows are gated by `isMatchup`. Change the `mg_statsRow`/`mg_sourceRow` gating so the stat-mode dropdown + source also show for `series-stats`. Locate the block that sets `$('mg_statsRow').hidden` / `$('mg_sourceRow').hidden` and replace with:

```javascript
    var statsScreen = (s === 'matchup' || s === 'series-stats');
    // Source (which teams) is relevant for matchup, starting-soon, and series-stats.
    $('mg_sourceRow').hidden = !(statsScreen || s === 'starting-soon');
    // Stat-display mode + subs only for the stats cards.
    $('mg_statsRow').hidden = !statsScreen;
    $('mg_subsPanel').hidden = !statsScreen;
```

(If `mg_statsRow` currently also contains the STATS/SERIES toggles that are matchup-card-only, leave those elements as-is — they're harmless on the series-stats card, or split them only if a reviewer flags it. Do not add new behavior beyond visibility.)

- [ ] **Step 5: Verify control.html parses**

Run:
```bash
node -e 'const fs=require("fs"),cp=require("child_process");const h=fs.readFileSync("ui/control.html","utf8");const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;while((m=re.exec(h))){i++;fs.writeFileSync("/tmp/c"+i+".js",m[1]);cp.execSync("node --check /tmp/c"+i+".js");}console.log("OK "+i)'
```
Expected: `OK` with the block count.

- [ ] **Step 6: Commit**

```bash
git add ui/control.html
git commit -m "feat(stats): control panel — In-Series Stats screen + Totals/Averages toggle"
```

---

### Task 6: Full-suite check

**Files:** none (verification).

- [ ] **Step 1: Run the full test suite**

Run: `node --test test/matchup-core.test.js test/bridge.test.js test/boost-smoothing.test.js test/scenes-core.test.js`
Expected: all pass, 0 fail.

- [ ] **Step 2: Syntax-check touched files**

Run: `node --check src/server.js && node --check overlay/matchup-graphic-core.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Manual (for the user, needs the app)**

With a series recorded: pick **In-Series Stats** from the Broadcast Screen picker → confirm it shows both teams, series score, "Through Game N," and per-player running totals; play/record another game → confirm it updates without re-selecting. Toggle the matchup card between **Totals** and **Averages** → confirm the stat rows switch and goals shows both ways.

---

## Self-Review

**Spec coverage:**
- In-series card as a Broadcast Screen from the local recording → Task 3 (render) + Task 1 (aggregator) + Task 4 (live refresh) + Task 5 (picker). ✅
- Pre-match Totals/Averages toggle, default totals, score /g, goals both ways → Task 2 (statCells/statRowEl + renderPlayer) + Task 5 (dropdown). ✅
- Shared aggregator + stat-row renderer → Tasks 1, 2. ✅
- State: `screen: 'series-stats'`, `statMode: 'totals'|'averages'`, backward-compat → Task 5 (load mapping) + Task 2 (normalizeStatMode). ✅
- Header: series score + "Through Game N" → Task 3. ✅
- Live refresh wrinkle → Task 4 + Task 3 Step 4. ✅
- Tests for aggregator + formatting → Tasks 1, 2. ✅

**Placeholder scan:** resolved — `el` is exported in Task 2 and aliased at the top of `renderSeriesStats` in Task 3, so all element calls are concrete. No "handle errors"/"TBD" steps.

**Type consistency:** `sumSeriesGames` returns `{players:Map, wins, seriesGames}` (Task 1) and is consumed identically in Task 3. `statCells(t, mode)`/`statRowEl(t, mode)`/`normalizeStatMode(m)` (Task 2) are used with the same signatures in Task 3. `statMode` values `'totals'|'averages'` are consistent across Tasks 2, 3, 5. Recording game shape matches the Global Constraints across Tasks 1, 3, 4.
