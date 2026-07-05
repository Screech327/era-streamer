# ERA Streamer — Series Stats Cards (Feature B) — Design Spec

**Date:** 2026-07-05
**Status:** Approved design, pending spec review
**Scope:** Two related additions to the **Broadcast Screen** source
(`matchup-graphic.html`) built in the stream-scenes feature. Nothing touches the
live game overlay (`match.html`).

---

## 1. Goal

1. **In-Series Stats card** — a new full-screen graphic the producer can show
   *after each game of a series* that displays every player's **cumulative
   totals** across the games played so far (after game 3 → totals of games 1–3;
   after game 7 → totals of the whole series). A companion to the pre-match
   matchup card.
2. **Pre-match card enhancement** — a **Totals ⇄ Averages** toggle on the
   existing matchup card (default **Totals**), so it can show season totals with
   score kept per-game.

## 2. Background / current state

- The **pre-match matchup card** (`matchup-graphic-core.js` `renderCard` →
  `renderTeam`) already shows each player's **per-game season averages**
  (`perGame(t)`), aggregated from the whole match archive via `aggregate(...)`.
  Modes today: `statMode: 'highlight'` (score/g + best) and `'full'` (all
  per-game).
- The **post-series aggregation already exists** as `renderPostSeries` in
  `match.html` (sums per-player stats across captured games + series wins) — but
  it lives in the live overlay, has **no producer control**, and is only
  reachable from test code. We reuse its aggregation logic, not its location.
- ERA Streamer captures each game's per-player stats from the **Rocket League
  API** into `stream_recording.value.games[]` as the series is played
  (`appendRecordingGame`). Each game: `players` keyed by id with
  `{name, teamNum, score, goals, assists, saves, shots, demos}`, plus
  `teamScores[0|1]` and `winnerTeamNum`.

## 3. Architecture

Both cards render inside the existing Broadcast Screen source and are selected
from the control panel's Matchup-tab picker (same mechanism as the scenes).
They share two building blocks:

1. **Stat aggregator** — `sumSeriesGames(games) → { players: Map<key,totals>,
   wins: {0,1}, seriesGames }` where `totals = {name, teamNum, gamesPlayed,
   score, goals, assists, saves, shots, demos}`. `seriesGames` is how many games
   the series has (drives "Through Game N"); each player's `gamesPlayed` is how
   many of those games they appeared in (a sub may miss some) — the stat-row
   renderer divides by the **player's** `gamesPlayed` for averages. A port of
   `renderPostSeries`'s loop into
   `matchup-graphic-core.js` so the browser source can call it. Used by the
   in-series card (over `stream_recording.games`). *(The pre-match card keeps
   using the season-wide `aggregate(archive,…)`, which already exists.)*
2. **Stat-row renderer** — renders one player's stat set given `(totals, mode)`:
   - `mode: 'totals'` → G/A/SV/SH/DM as **totals**, **SCORE per-game**, GOALS
     also shows its **/g** in small text.
   - `mode: 'averages'` → all as **per-game**, GOALS also shows its **total** in
     small text.
   - Score is **always per-game** in both modes; goals is **always shown both
     ways** (primary flips with the mode). Used by both cards.

## 4. Component 1 — Pre-match card: Totals ⇄ Averages

- Repurpose the existing `statMode` control from `'highlight'|'full'` to
  **`'totals'|'averages'`** (default **`'totals'`**). Both modes show the full
  6-stat set through the shared stat-row renderer (§3.2). The old
  "score + best stat" compact mode is dropped (YAGNI — not requested).
- `renderTeam` uses the stat-row renderer instead of its current inline
  `perGame`/highlight logic.
- Backward compatibility: a stored `statMode` of `'highlight'`/`'full'` (both
  were averages) maps to `'averages'`; anything unknown → `'totals'`.

**Example (per player):**
- Totals: `SCORE 494/g · GOALS 31 (1.3/g) · ASSISTS 22 · SAVES 38 · SHOTS 98 · DEMOS 23`
- Averages: `SCORE 494/g · GOALS 1.3/g (31) · ASSISTS 0.9/g · SAVES 1.6/g · SHOTS 4.1/g · DEMOS 1.0/g`

## 5. Component 2 — In-Series Stats card (new screen)

- Add **`'series-stats'`** to the Broadcast Screen `screen` enum + an
  **"In-Series Stats"** option in the picker.
- Data: `localGet('stream_recording')` → `sumSeriesGames(games)` for the
  **current, not-yet-saved series**.
- Layout (matchup-card aesthetic): header shows both teams + **series score**
  (`wins.0`–`wins.1`) + **"Through Game N"** (`seriesGames`); two team columns,
  each player rendered via the stat-row renderer (default **totals**), plus a
  team-total row. Respects the same `statMode` toggle as the pre-match card.
- Empty state: if no games recorded yet, show "No games recorded yet."

## 6. State model

Extend `stream_matchup_graphic` (backward-compatible):
```jsonc
{
  screen: '... | series-stats',          // new enum value
  statMode: 'totals' | 'averages',       // repurposed; default 'totals'
  // (all existing fields unchanged)
}
```

## 7. Live refresh (the one wrinkle)

Today `appendRecordingGame` (server) updates `stream_recording` and saves state
but does **not** notify the overlay. So the in-series card must be told when a
new game lands:
- `appendRecordingGame` broadcasts a `SettingsChanged` event for
  `stream_recording` after appending.
- The matchup-graphic WS handler adds `stream_recording` to its refresh triggers
  (it currently refreshes on `stream_matchup_graphic`/`stream_match`/
  `stream_series`).

Result: the in-series card updates automatically as each game is captured, no
re-select needed.

## 8. Control panel changes (`ui/control.html`, Matchup tab)

- Add **"In-Series Stats"** to the `mg_screen` picker.
- Rename the stat-display dropdown options to **Totals / Averages**
  (writes `statMode`).
- Screen-visibility: the stat-mode control is relevant for **Matchup Card** and
  **In-Series Stats**; hide it for the scene screens (extends the existing
  `applyScreenVisibility`).

## 9. Testing

Unit tests (`node:test`, like `matchup-core.test.js`):
- `sumSeriesGames`: multiple games → correct per-player totals, team grouping,
  `wins`, and `gamesPlayed`; players appearing in only some games; a player who
  switched teams keeps the latest team.
- Stat-row formatting: totals vs averages output, score always per-game, goals
  both-ways, division-by-zero guard at 0 games.

## 10. Decisions already made

- In-series card lives in the Broadcast Screen source, driven from the picker;
  not on the live overlay. ✅
- Data = local session recording (RL-API-fed), current series. ✅
- Totals is the default; Averages is a toggle; score always per-game; goals
  always shown both ways. ✅

## 11. Out of scope / follow-ups

- A goals-only "scorers" view (superseded — the card shows all players' totals).
- Pulling in-series data from the cloud/website (mid-series data only exists
  locally).
- Averages toggle on the in-series card is supported by the shared renderer but
  defaults to totals; no separate control beyond the shared `statMode`.
