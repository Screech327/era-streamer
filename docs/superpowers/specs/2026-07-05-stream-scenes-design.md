# ERA Streamer — Stream Scenes (Broadcast Screens) — Design Spec

**Date:** 2026-07-05
**Status:** Approved design, pending spec review
**Scope:** Feature A only (stream scenes). Feature B (in-series / end-of-series stats
matchup card) is a **separate spec** — see "Out of scope / follow-ups".

---

## 1. Goal

Give the producer a set of full-screen, ERA-branded "broadcast screens" to run the
non-gameplay parts of a stream — **Starting Soon, Intermission, Be Right Back, Thank
You for Watching, and a Casters' Desk / Analysis** frame — all driven from the ERA
Streamer control panel, no extra OBS setup and no new browser-source URLs to hand out.

## 2. Key architectural decision

**One full-screen "broadcast screen" source, ERA-driven.** We generalize the existing
`matchup-graphic.html` source (already a full-screen, ERA-controlled interstitial) from
"the matchup card" into "the between-action screen," which can render any one of:

- the **matchup card** (existing behavior, unchanged), or
- one of the **five scenes** below.

The producer picks the active screen from the control panel. The **URL stays
`/matchup-graphic.html`** so existing OBS setups keep working — no third source, no new
URL. This matches how the matchup card is used today (OBS controls when the source is
visible; ERA controls what it shows).

**OBS workflow is unchanged:** the producer keeps the one full-screen source in their
break/intro scenes and switches which screen it shows from ERA.

## 3. The screens

All scenes share the design system in §5. Sample renders live (temporarily) at
`eliterocketassociation.com/mockups/stream-scenes.html`; source in `mockups/scenes/` on
the `scene-mockups` branch. Those mockups are the visual source of truth.

| # | Screen | Content |
|---|--------|---------|
| 0 | **Matchup card** | Existing `matchup-graphic.html` behavior. Unchanged. |
| 1 | **Starting Soon** | Title + optional countdown + "Tonight's Main Event" (the pushed matchup: real logos/colors/names + format). |
| 2 | **Intermission** | Title + "Tonight's Schedule" list (tonight's matchups with times, an **UP NEXT** flag on the next one) + optional countdown. |
| 3 | **Be Right Back** | Title + editable tagline + optional countdown. |
| 4 | **Thank You For Watching** | Title + **"Tonight's Results"**: tonight's matchups with final series scores, winner flagged (gold "W"). *(No next-week teaser.)* |
| 5 | **Casters' Desk / Analysis** | Two labeled caster-cam slots (name + role plate) + a lower-third topic line. Slots are empty regions OBS places the cam feeds into. |

## 4. Shared design system (§5 detail)

- **Palette:** near-black `#090909`/`#0e0e11` gradient, gold `#dcc174`, red accent
  `#e63946`, white ink. (Lifted from `matchup-graphic.css`.)
- **Fonts:** Bebas Neue (titles), Rajdhani (body), Orbitron (tech labels/clock).
- **Chrome (every scene):** ELITE ERA shield logo (`icon-512.png`, `screen`-blended)
  top-left; league + week top-right; faint shield watermark (subtle); footer with the
  real socials — `eliterocketassociation.com` · Discord `discord.gg/A66WJ45mqY` ·
  Twitch `twitch.tv/eliterocketassociation`.
- **1920×1080**, auto-scaled to the OBS source (same `rescaleCanvas` approach as the
  overlay).
- Reuse the approved mockup HTML/CSS (`mockups/scenes/scenes.css` + per-scene markup)
  as the basis, ported into the era-streamer overlay.

## 5. Dynamic data — auto vs producer-typed

The scenes reuse the **existing data plumbing** the matchup graphic already uses
(Supabase-shaped `/rest/v1/...` via the local app server): `scheduled_matches` (tonight's
slate), `archive` (results/scores), `players`, team metadata + logos in
`overlay/images/`, and the pushed `stream_match`/`stream_series`.

| Element | Source |
|---|---|
| League + Week header | pushed matchup / current ERA week (auto) |
| Starting Soon → main event | pushed `stream_match` (auto) |
| Intermission → tonight's schedule | `resolveTonight(scheduled_matches)` (auto) — same source as matchup "slate" mode |
| Thank You → tonight's results | tonight's matchups + their `archive` series scores/winners (auto) |
| Casters' Desk → up-next / league | pushed matchup (auto) |
| Countdown duration + on/off | producer (control panel) |
| Taglines / subtitles | producer, with sensible defaults |
| Caster names + roles, desk topic | producer (control panel), optionally saved/remembered |
| Socials | fixed config (from the ERA site) |

## 6. Countdown behavior

- Available on the time-based scenes: **Starting Soon, Be Right Back, Intermission.**
- Producer toggles it **on/off** and sets a duration (e.g., `5:00`).
- On → control panel stamps an absolute `endsAt` (now + duration) into state; the overlay
  ticks each second to `endsAt`. At zero it **holds at `0:00`** (no auto-swap).
- Off → the countdown pill isn't rendered and the scene **re-centers** without it.
- Editing the duration re-stamps `endsAt` (restart). (No pause in v1 — YAGNI.)

## 7. State model

Extend the existing `stream_matchup_graphic` settings row (backward-compatible; default
`screen: 'matchup'` preserves current behavior):

```jsonc
stream_matchup_graphic: {
  screen: 'matchup' | 'starting-soon' | 'intermission' | 'brb' | 'thank-you' | 'casters-desk',
  // ── existing matchup-card fields (unchanged) ──
  mode, showStats, showSeries, statMode, slateIndex, subs,
  // ── new scene fields ──
  countdown: { on: boolean, endsAt: string /* ISO */ },
  taglines:  { brb: string, startingSoon: string, /* per-scene, optional overrides */ },
  casters:   [ { name: string, role: string }, { name: string, role: string } ],
  deskTopic: string
}
```

Written by the control panel via `POST /rest/v1/settings` (existing path); read by the
overlay via the existing settings poll + broadcast.

## 8. Overlay rendering

Generalize `overlay/matchup-graphic.html`:
1. Read `screen` from state.
2. `screen === 'matchup'` → existing matchup-card render (untouched code path).
3. Otherwise → render the matching scene layout (ported from the approved mockups),
   filling dynamic data from §5 and the countdown from §6.
- Port `scenes.css` into the overlay; add the scene markup/render functions (ideally a
  small `scenes` module alongside `matchup-graphic-core.js`).
- Serve any new static assets via the existing static-route pattern in `server.js`.

## 9. Control panel UX (`ui/control.html`)

Extend the **Matchup tab** (it already drives this source) into a **"Broadcast Screen"**
control:
- A **screen picker** (Matchup Card / Starting Soon / Intermission / Be Right Back /
  Thank You / Casters' Desk).
- Contextual controls for the selected screen:
  - time-based scenes → countdown on/off + duration;
  - BRB / Starting Soon → editable tagline;
  - Casters' Desk → two name+role fields + topic line.
- A live preview iframe (same pattern the tab already uses) reflecting the selection.
- Selection + fields write to `stream_matchup_graphic`.

## 10. Testing

- **Unit (node:test):** pure helpers — countdown formatting/clamping, `resolveTonight`
  results shaping, winner/score derivation from `archive`. Follow the existing
  `test/matchup-core.test.js` pattern; wire into the release workflow's test step.
- **Visual:** the Customize/preview iframe + the approved mockups; manual OBS check.

## 11. Decisions already made (during brainstorming)

- One shared full-screen source (generalize matchup-graphic), ERA-driven. ✅
- Five scenes (incl. Casters' Desk). ✅
- Countdown optional per time-based scene; **holds at 0:00** at zero. ✅
- Watermark: subtle. ✅
- Thank You shows **tonight's results** (not a next-week teaser). ✅
- Tier 3 dynamic content (up-next, schedule, results) sourced from existing plumbing. ✅

## 12. Out of scope / follow-ups

- **Feature B** — in-series (e.g., game 5 of BO7) and end-of-series stats matchup card.
  Note from brainstorming: the **pre-match matchup card should show each player's combined
  regular-season stats**, and a **post-/in-series card should aggregate stats across the
  games played**. Much of the aggregation already exists in `renderPostSeries`
  (`match.html`). Separate spec.
- Countdown pause; per-scene "we're live" swap at zero; social platforms beyond
  web/discord/twitch (Twitter/YouTube are unset on the site).
- Removing the temporary `eliterocketassociation.com/mockups/stream-scenes.html` preview
  once this ships.
