/*
 * ERA Matchup Graphic — shared core.
 *
 * CANONICAL COPY lives here (era-streamer/overlay/matchup-graphic-core.js).
 * An identical copy is kept at era-rl-admin/matchup-graphic-core.js — if you
 * edit one, copy it to the other (`cp` step in the impl plan).
 *
 * Framework-free. Works in the browser (attaches window.MatchupCore) and in
 * Node (module.exports) so the pure functions can be unit-tested.
 *
 * Data + stat logic is ported from the ERA-Web site:
 *   - name matching + aggregation: src/data/leaderboards.ts
 *   - week math: src/data/eraWeek.ts
 *   - org/league maps: src/data/liveLeagues.ts
 *   - public team names + logos: src/data/eraLeagueData.ts + era-streamer/src/teams.js
 * Read-only against the cloud Supabase anon endpoint.
 */
(function () {
  'use strict';

  // ───────── Constants ─────────

  var SUPABASE_URL = 'https://qamonwkxafbzvyrlisjv.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbW9ud2t4YWZienZ5cmxpc2p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MzQ3NjcsImV4cCI6MjA5MTUxMDc2N30.AOKN9Ioz5m8Om2CutdlTownmoEbZ3DFVcAHovhhj7wM';

  var LEAGUE_COLORS = { champion: '#e63946', major: '#6495ED', minor: '#50cd50', academy: '#C9A84C' };
  var LEAGUE_LABELS = { champion: 'Champion', major: 'Major', minor: 'Minor', academy: 'Academy' };
  var LEAGUE_KEYS = ['champion', 'major', 'minor', 'academy'];

  // Admin org code → public-side GM string.
  var ORG_TO_GM = { berk: 'Tarry', qc: 'MiniMedic', bamboo: 'JugPanda', suit: 'Solurr', leeds: 'Precons', mont: 'KingMoroz', vb: 'Souls', osaka: 'Chrome Moisty' };
  var ADMIN_TO_PUBLIC = { league1: 'champion', league2: 'major', league3: 'minor', league4: 'academy' };
  var PUBLIC_TO_ADMIN = { champion: 'league1', major: 'league2', minor: 'league3', academy: 'league4' };

  // Org code → per-public-league team identity. `name` is the canonical public
  // team name (used to match the schedule match_id slug). `logo` is the path
  // RELATIVE to the host page's images/ dir (same on era-streamer + era-rl-admin).
  var TEAM_DATA = {
    berk: {
      champion: { name: 'The Berk Night Furies', logo: 'images/Champion/night_furies.png' },
      major:    { name: 'Vanaheim Light Furies', logo: 'images/Major/light_furies.png' },
      minor:    { name: "Dragon's Edge Rumblehorns", logo: "images/Minor/Dragon's Edge Rumblehorns.png" },
      academy:  { name: 'Forbidden Isle Zipplebacks', logo: 'images/Academy/Forbidden Isle Zipplebacks.png' },
    },
    qc: {
      champion: { name: 'Queen City Monarchs', logo: 'images/Champion/QC Monarch.png' },
      major:    { name: 'Queen City Knights', logo: 'images/Major/QC Knights.png' },
      minor:    { name: 'Queen City Squires', logo: 'images/Minor/QC Squires.png' },
      academy:  { name: 'Queen City Commoners', logo: 'images/Academy/QC Commoners.png' },
    },
    bamboo: {
      champion: { name: 'Bamboo Blackout', logo: 'images/Champion/Bamboo Blackout.png' },
      major:    { name: 'Bamboo Blitz', logo: 'images/Major/Bamboo Blitz.png' },
      minor:    { name: 'Bamboo Bloom', logo: 'images/Minor/Bamboo Bloom.png' },
      academy:  { name: 'Bamboo Bud', logo: 'images/Academy/Bamboo Bud.png' },
    },
    suit: {
      champion: { name: 'Suitland Supernova', logo: 'images/Champion/Suitland Supernova.png' },
      major:    { name: 'Silver Spring Stars', logo: 'images/Major/Silver Spring Stars.png' },
      minor:    { name: 'Columbia Cosmos', logo: 'images/Minor/Columbia Cosmos.png' },
      academy:  { name: 'New Market Nebula', logo: 'images/Academy/New Market Nebula.png' },
    },
    leeds: {
      champion: { name: 'Leeds Lightning', logo: 'images/Champion/Leeds Lightning.png' },
      major:    { name: 'Bristol Blizzards', logo: 'images/Major/Bristol Blizzards.png' },
      minor:    { name: 'Glasgow Glacier', logo: 'images/Minor/Glascow Glacier.png' },
      academy:  { name: 'Oxford Ospreys', logo: 'images/Academy/Oxford Ospreys.png' },
    },
    mont: {
      champion: { name: 'Montgomery Rebels', logo: 'images/Champion/Montgomery Rebels.png' },
      major:    { name: 'Childersburg Conquistadors', logo: 'images/Major/Childersburg Conquistadors.jpeg' },
      minor:    { name: 'Mobile Militia', logo: 'images/Minor/Mobile Militia.png' },
      academy:  { name: 'Tallapoosa Red Sticks', logo: 'images/Academy/Tallapoosa Red Sticks.jpeg' },
    },
    vb: {
      champion: { name: 'Virginia Beach Tides', logo: 'images/Champion/Virgnia Beach Tides.png' },
      major:    { name: 'Arlington Admirals', logo: 'images/Major/Arlginton Admirals.png' },
      minor:    { name: 'Chesapeake Bay Captains', logo: 'images/Minor/Chesapeake Bay Captains.png' },
      academy:  { name: 'Norfolk Fleet', logo: 'images/Academy/Norfolk Fleet.png' },
    },
    osaka: {
      champion: { name: 'Osaka Revenants', logo: 'images/Champion/Osaka Revenants.png' },
      major:    { name: 'Tokyo Wraiths', logo: 'images/Major/Tokyo Wraiths.png' },
      minor:    { name: 'Yokohama Yokais', logo: 'images/Minor/Yokohama Yokais.png' },
      academy:  { name: 'Kyoto Hollows', logo: 'images/Academy/Kyoto Hollows.png' },
    },
  };

  // Dominant logo color per team (from ERA-Web src/data/teamColors.ts) — used to
  // theme each side of the card the way the website blends team colors.
  var TEAM_COLORS = {
    'The Berk Night Furies': '#3c8970', 'Queen City Monarchs': '#453c6a', 'Bamboo Blackout': '#385211',
    'Suitland Supernova': '#156453', 'Leeds Lightning': '#2e88d9', 'Montgomery Rebels': '#4d171d',
    'Virginia Beach Tides': '#142b3a', 'Osaka Revenants': '#e93d74', 'Vanaheim Light Furies': '#d1e9f9',
    'Queen City Knights': '#463a69', 'Bamboo Blitz': '#647b2c', 'Silver Spring Stars': '#2a7d65',
    'Bristol Blizzards': '#142c4c', 'Childersburg Conquistadors': '#a9444b', 'Arlington Admirals': '#d1b58c',
    'Tokyo Wraiths': '#ea4f7d', 'Queen City Squires': '#655598', 'Bamboo Bloom': '#49710f',
    'Columbia Cosmos': '#367271', 'Glasgow Glacier': '#2b68a5', 'Mobile Militia': '#911d31',
    'Chesapeake Bay Captains': '#cdb38c', 'Yokohama Yokais': '#320410', 'Forbidden Isle Zipplebacks': '#78b17d',
    'Queen City Commoners': '#473864', 'Bamboo Bud': '#516e14', 'New Market Nebula': '#2f6f66',
    'Oxford Ospreys': '#83b9da', 'Norfolk Fleet': '#6f88a1', 'Tallapoosa Red Sticks': '#b7474e',
    'Kyoto Hollows': '#d46c8b',
  };

  // Team accent color → its dominant logo color, falling back to league color.
  function colorForTeam(name, league) {
    return TEAM_COLORS[name] || LEAGUE_COLORS[league] || '#888';
  }

  // Playoff round label from the season week stamped into the match_id.
  function roundLabel(week) {
    if (week === 9) return 'Quarterfinal';
    if (week === 10) return 'Semifinal';
    if (week === 11) return 'Final';
    if (week) return 'Week ' + week;
    return '';
  }

  // slug(publicName) → org code, per public league. Built once from TEAM_DATA so
  // a schedule match_id ("champion-w9-queen-city-monarchs-vs-...") resolves to teams.
  var SLUG_TO_ORG = {};
  LEAGUE_KEYS.forEach(function (lg) { SLUG_TO_ORG[lg] = {}; });
  Object.keys(TEAM_DATA).forEach(function (org) {
    LEAGUE_KEYS.forEach(function (lg) {
      var t = TEAM_DATA[org][lg];
      if (t) SLUG_TO_ORG[lg][slug(t.name)] = org;
    });
  });

  // ───────── String / name helpers ─────────

  function slug(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/'/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function normName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var dp = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) dp[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var prev = dp[0];
      dp[0] = i;
      for (var k = 1; k <= b.length; k++) {
        var tmp = dp[k];
        dp[k] = a[i - 1] === b[k - 1] ? prev : 1 + Math.min(prev, dp[k], dp[k - 1]);
        prev = tmp;
      }
    }
    return dp[b.length];
  }

  // Port of leaderboards.ts matchPlayer: alias → exact normalized → prefix/
  // containment → Levenshtein. Returns the best single known player or null.
  function matchPlayer(archivedName, aliases, knownPlayers) {
    if (!archivedName) return null;
    aliases = aliases || {};
    var aliasHit = aliases[archivedName] || aliases[String(archivedName).toLowerCase()] || aliases[String(archivedName).toUpperCase()];
    if (!aliasHit) {
      var entry = Object.keys(aliases).find(function (kk) { return kk.toLowerCase() === String(archivedName).toLowerCase(); });
      if (entry) aliasHit = aliases[entry];
    }
    if (aliasHit) {
      var direct = knownPlayers.find(function (p) { return p.name.toLowerCase() === String(aliasHit).toLowerCase(); });
      if (direct) return direct;
    }
    var an = normName(archivedName);
    if (!an) return null;
    var exact = knownPlayers.find(function (p) { return normName(p.name) === an; });
    if (exact) return exact;
    for (var i = 0; i < knownPlayers.length; i++) {
      var rn = normName(knownPlayers[i].name);
      if (!rn) continue;
      if (rn.length >= 3 && an.indexOf(rn) === 0) return knownPlayers[i];
      if (an.length >= 4 && rn.indexOf(an) !== -1) return knownPlayers[i];
      if (rn.length >= 5 && an.indexOf(rn) !== -1 && (an.length - rn.length) <= 2) return knownPlayers[i];
    }
    if (an.length < 4) return null;
    var best = null, bestDist = Infinity;
    for (var m = 0; m < knownPlayers.length; m++) {
      var rn2 = normName(knownPlayers[m].name);
      if (!rn2 || Math.abs(rn2.length - an.length) > 3) continue;
      var d = levenshtein(rn2, an);
      var tol = Math.max(1, Math.floor(Math.min(rn2.length, an.length) / 4));
      if (d <= tol && d < bestDist) { bestDist = d; best = knownPlayers[m]; }
    }
    return best;
  }

  // ───────── Week math (port of eraWeek.ts) ─────────

  var SEASON_START_MONDAY_ISO = '2026-04-27T00:00:00-04:00';
  var SEASON_WEEKS = 7;
  var BYE_WEEKS_ISO = ['2026-06-01T00:00:00-04:00'];

  function getCurrentEraWeek(now) {
    now = now || new Date();
    var start = Date.parse(SEASON_START_MONDAY_ISO);
    if (isNaN(start)) return 1;
    var diffMs = now.getTime() - start;
    if (diffMs < 0) return 0;
    var diffDays = Math.floor(diffMs / 86400000);
    var week = Math.floor(diffDays / 7) + 1;
    for (var i = 0; i < BYE_WEEKS_ISO.length; i++) {
      if (now.getTime() >= Date.parse(BYE_WEEKS_ISO[i])) week -= 1;
    }
    if (week < 1) return 1;
    if (week > SEASON_WEEKS) return SEASON_WEEKS;
    return week;
  }

  function minGamesFor(week) { return Math.max(3, Math.ceil(week * 1.5)); }

  // ───────── Stat aggregation (port of leaderboards.ts bucket loop) ─────────

  function blankTotals(name) {
    return { name: name, gamesPlayed: 0, score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0 };
  }

  // archive: ArchivedSeries[]; aliases: {archived→roster}; knownPlayers: [{name}].
  // Returns Map<lowercased matched name, totals>. Primary totals only — the
  // graphic doesn't split sub appearances (a player's overall season line is
  // what we show, including when they sub). Each player counted once per game.
  function aggregate(archive, aliases, knownPlayers) {
    var buckets = new Map();
    (archive || []).forEach(function (series) {
      (series.games || []).forEach(function (g) {
        var seen = {};
        var players = g.players || {};
        Object.keys(players).forEach(function (pk) {
          var ap = players[pk];
          var matched = matchPlayer(ap && ap.name, aliases, knownPlayers);
          if (!matched) return;
          var key = matched.name.toLowerCase();
          if (seen[key]) return;
          seen[key] = true;
          var e = buckets.get(key);
          if (!e) { e = blankTotals(matched.name); buckets.set(key, e); }
          e.gamesPlayed += 1;
          e.score += ap.score || 0;
          e.goals += ap.goals || 0;
          e.assists += ap.assists || 0;
          e.saves += ap.saves || 0;
          e.shots += ap.shots || 0;
          e.demos += ap.demos || 0;
        });
      });
    });
    return buckets;
  }

  function perGame(t) {
    var gp = t && t.gamesPlayed ? t.gamesPlayed : 0;
    function r(v) { return gp > 0 ? v / gp : 0; }
    return {
      gamesPlayed: gp,
      scorePG: r(t ? t.score : 0),
      goalsPG: r(t ? t.goals : 0),
      assistsPG: r(t ? t.assists : 0),
      savesPG: r(t ? t.saves : 0),
      shotsPG: r(t ? t.shots : 0),
      demosPG: r(t ? t.demos : 0),
    };
  }

  var REST_KEYS = ['goals', 'assists', 'saves', 'shots', 'demos'];
  var REST_LABELS = { goals: 'Goals', assists: 'Assists', saves: 'Saves', shots: 'Shots', demos: 'Demos' };
  // Tie-break preference — favors the less-obvious standout over raw shot volume.
  var REST_PREF = { saves: 0, assists: 1, demos: 2, goals: 3, shots: 4 };

  function rate(t, key) {
    var gp = t && t.gamesPlayed ? t.gamesPlayed : 0;
    return gp > 0 ? (t[key] || 0) / gp : 0;
  }

  // Returns {key,label,value}. Picks the {goals,assists,saves,shots,demos}/game
  // where the player ranks highest among QUALIFIED league peers (>= minGames).
  // Below minGames, falls back to the player's raw top per-game rate.
  function pickBestOfRest(player, leaguePeers, minGames) {
    var gp = player && player.gamesPlayed ? player.gamesPlayed : 0;
    var qualified = gp >= minGames;
    var best = null;
    REST_KEYS.forEach(function (key) {
      var myRate = rate(player, key);
      var rank = 0;
      if (qualified) {
        (leaguePeers || []).forEach(function (peer) {
          if (peer === player) return;
          if (!peer || (peer.gamesPlayed || 0) < minGames) return;
          if (rate(peer, key) > myRate) rank += 1;
        });
      }
      var cand = { key: key, label: REST_LABELS[key], value: myRate, rank: qualified ? rank : 0 };
      if (best === null) { best = cand; return; }
      if (qualified) {
        if (cand.rank < best.rank) best = cand;
        else if (cand.rank === best.rank && cand.value > best.value) best = cand;
        else if (cand.rank === best.rank && cand.value === best.value && REST_PREF[cand.key] < REST_PREF[best.key]) best = cand;
      } else {
        // Fallback: highest raw rate (tie-break by preference).
        if (cand.value > best.value) best = cand;
        else if (cand.value === best.value && REST_PREF[cand.key] < REST_PREF[best.key]) best = cand;
      }
    });
    return best || { key: 'goals', label: 'Goals', value: 0, rank: 0 };
  }

  // ───────── Roster building from the cloud players table ─────────

  // players: admin rows {name,mmr,league(admin),drafted,drafted_by(org)}.
  // Returns {name,mmr}[] for one org+public-league, sorted MMR desc.
  // Active roster = drafted by this org in this league — matching the admin
  // Rosters & Free Agency page (teamRosterFor). The `dropped` flag is a
  // player-pool concept and is intentionally IGNORED here.
  function rosterFor(players, org, publicLeague) {
    var adminLeague = PUBLIC_TO_ADMIN[publicLeague];
    var list = (players || []).filter(function (p) {
      return p.drafted && p.drafted_by === org && p.league === adminLeague;
    }).map(function (p) { return { name: p.name, mmr: p.mmr || 0 }; });
    list.sort(function (a, b) { return (b.mmr || 0) - (a.mmr || 0); });
    return list;
  }

  function teamObj(org, publicLeague, players) {
    var td = (TEAM_DATA[org] || {})[publicLeague] || { name: org, logo: '' };
    return { org: org, league: publicLeague, name: td.name, logo: td.logo, roster: rosterFor(players, org, publicLeague) };
  }

  var LEAGUE_NUM = { champion: 1, major: 2, minor: 3, academy: 4 };

  // Eligible substitutes for a team: ONLY players in the SAME org on a team
  // in a STRICTLY LOWER league (a player can sub UP from a team below, never
  // be pulled from a higher league). Returns {name,mmr,league} sorted MMR desc.
  function eligibleSubs(players, org, publicLeague) {
    var n = LEAGUE_NUM[publicLeague];
    if (!n) return [];
    var out = (players || []).filter(function (p) {
      if (!p.drafted || p.drafted_by !== org) return false; // dropped flag ignored (see rosterFor)
      var pl = ADMIN_TO_PUBLIC[p.league];
      var pn = LEAGUE_NUM[pl];
      return pn && pn > n; // lower tier only
    }).map(function (p) { return { name: p.name, mmr: p.mmr || 0, league: ADMIN_TO_PUBLIC[p.league] }; });
    out.sort(function (a, b) { return (b.mmr || 0) - (a.mmr || 0); });
    return out;
  }

  // Explicit matchup (manual override / era-streamer current-match mode).
  function buildMatchup(publicLeague, homeOrg, awayOrg, players) {
    return {
      league: publicLeague,
      home: teamObj(homeOrg, publicLeague, players),
      away: teamObj(awayOrg, publicLeague, players),
    };
  }

  // ───────── Tonight's slate from scheduled_matches ─────────

  function dayKeyET(d) {
    return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' });
  }

  function parseMatchId(id) {
    var m = /^(champion|major|minor|academy)-w(\d+)-(.+)-vs-(.+)$/.exec(String(id || ''));
    if (!m) return null;
    return { league: m[1], week: parseInt(m[2], 10), homeSlug: m[3], awaySlug: m[4] };
  }

  // scheduled: [{match_id, scheduled_time}]; players: admin rows; now: Date.
  // Returns Matchup[] for matches whose scheduled_time is today (ET). Dedups by
  // match_id. Unresolvable slugs leave that side's org null (manual fix in UI).
  function resolveTonight(scheduled, players, now) {
    now = now || new Date();
    var todayKey = dayKeyET(now);
    var seen = {};
    var out = [];
    (scheduled || []).forEach(function (row) {
      if (!row || !row.match_id || !row.scheduled_time) return;
      var t = Date.parse(row.scheduled_time);
      if (isNaN(t) || dayKeyET(new Date(t)) !== todayKey) return;
      if (seen[row.match_id]) return;
      seen[row.match_id] = true;
      var parsed = parseMatchId(row.match_id);
      if (!parsed) return;
      var homeOrg = SLUG_TO_ORG[parsed.league][parsed.homeSlug] || null;
      var awayOrg = SLUG_TO_ORG[parsed.league][parsed.awaySlug] || null;
      out.push({
        league: parsed.league,
        week: parsed.week,
        round: roundLabel(parsed.week),
        time: row.scheduled_time,
        home: homeOrg ? teamObj(homeOrg, parsed.league, players) : { org: null, league: parsed.league, name: parsed.homeSlug, logo: '', roster: [] },
        away: awayOrg ? teamObj(awayOrg, parsed.league, players) : { org: null, league: parsed.league, name: parsed.awaySlug, logo: '', roster: [] },
      });
    });
    out.sort(function (a, b) { return Date.parse(a.time) - Date.parse(b.time); });
    return out;
  }

  // ───────── Cloud fetchers (browser) ─────────

  function sbGet(path) {
    return fetch(SUPABASE_URL + '/rest/v1/' + path, {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON },
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function fetchCloud() {
    return Promise.all([
      sbGet('players?select=name,mmr,league,drafted,drafted_by,dropped'),
      sbGet('settings?key=eq.series_archive&select=value'),
      sbGet('settings?key=eq.player_aliases&select=value'),
      sbGet('scheduled_matches?select=match_id,scheduled_time'),
    ]).then(function (res) {
      var players = res[0] || [];
      var archive = (res[1] && res[1][0] && res[1][0].value) || [];
      var aliases = (res[2] && res[2][0] && res[2][0].value) || {};
      var scheduled = res[3] || [];
      return { players: players, archive: Array.isArray(archive) ? archive : [], aliases: aliases, scheduled: scheduled };
    });
  }

  // ───────── Card rendering (browser DOM) ─────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmt(v) { return (Math.round(v * 100) / 100).toFixed(1); }

  // Build the totals list for one public league (qualified peer pool).
  function leagueTotals(agg, players, publicLeague) {
    var adminLeague = PUBLIC_TO_ADMIN[publicLeague];
    var out = [];
    (players || []).forEach(function (p) {
      if (!p.drafted || p.league !== adminLeague) return;
      var t = agg.get(String(p.name).toLowerCase());
      if (t) out.push(t);
    });
    return out;
  }

  // matchup: {league, home, away, round?}; agg: Map;
  // opts: {showStats, showSeries, series, players, minGames}
  function renderCard(matchup, agg, opts) {
    opts = opts || {};
    var league = matchup.league;
    var leagueColor = LEAGUE_COLORS[league] || '#888';
    var homeColor = colorForTeam(matchup.home.name, league);
    var awayColor = colorForTeam(matchup.away.name, league);
    var minGames = opts.minGames != null ? opts.minGames : minGamesFor(getCurrentEraWeek(new Date()));
    var peers = leagueTotals(agg, opts.players || [], league);

    var card = el('div', 'mg-card');
    card.style.setProperty('--accent', leagueColor);
    card.style.setProperty('--home', homeColor);
    card.style.setProperty('--away', awayColor);
    card.appendChild(el('div', 'mg-bg'));

    // Eyebrow: league brand mark.
    var eyebrow = el('div', 'mg-eyebrow');
    eyebrow.appendChild(el('span', 'mg-eyebrow-mark', 'ELITE ROCKET ASSOCIATION'));
    eyebrow.appendChild(el('span', 'mg-eyebrow-dot'));
    eyebrow.appendChild(el('span', 'mg-eyebrow-sub', 'MATCHUP'));
    card.appendChild(eyebrow);

    // League banner with round / series meta.
    var banner = el('div', 'mg-banner');
    banner.appendChild(el('div', 'mg-banner-league', (LEAGUE_LABELS[league] || '').toUpperCase()));
    var s = opts.series || {};
    var hasSeries = opts.showSeries !== false && (s.format || s.leftWins || s.rightWins);
    if (hasSeries) {
      var meta = el('div', 'mg-banner-meta');
      meta.appendChild(el('span', 'mg-banner-fmt', s.format || 'BO5'));
      meta.appendChild(el('span', 'mg-banner-score', (s.leftWins || 0) + ' – ' + (s.rightWins || 0)));
      banner.appendChild(meta);
    } else if (matchup.round) {
      banner.appendChild(el('div', 'mg-banner-meta', matchup.round.toUpperCase()));
    }
    card.appendChild(banner);

    var body = el('div', 'mg-body');
    body.appendChild(renderTeam(matchup.home, agg, peers, minGames, opts, 'left', homeColor));
    var vs = el('div', 'mg-vs');
    vs.appendChild(el('span', 'mg-vs-text', 'VS'));
    body.appendChild(vs);
    body.appendChild(renderTeam(matchup.away, agg, peers, minGames, opts, 'right', awayColor));
    card.appendChild(body);
    return card;
  }

  function renderTeam(team, agg, peers, minGames, opts, side, teamColor) {
    var wrap = el('div', 'mg-team mg-team-' + side);
    wrap.style.setProperty('--team', teamColor);

    var head = el('div', 'mg-team-head');
    var logoWrap = el('div', 'mg-logo-wrap');
    if (team.logo) {
      var img = el('img', 'mg-logo');
      img.src = team.logo;
      img.alt = team.name || '';
      img.onerror = function () { logoWrap.classList.add('mg-logo-missing'); img.remove(); };
      logoWrap.appendChild(img);
    } else { logoWrap.classList.add('mg-logo-missing'); }
    head.appendChild(logoWrap);

    var nameWrap = el('div', 'mg-team-name-wrap');
    nameWrap.appendChild(el('div', 'mg-team-name', team.name || '—'));
    nameWrap.appendChild(el('div', 'mg-team-bar'));
    head.appendChild(nameWrap);
    wrap.appendChild(head);

    var roster = (team.roster || []).slice(0, 3);
    var players = el('div', 'mg-players');
    roster.forEach(function (pl) {
      players.appendChild(renderPlayer(pl, agg, peers, minGames, opts));
    });
    if (roster.length === 0) players.appendChild(el('div', 'mg-empty', 'No roster'));
    wrap.appendChild(players);
    return wrap;
  }

  function renderPlayer(pl, agg, peers, minGames, opts) {
    var row = el('div', 'mg-player');
    var nameWrap = el('div', 'mg-pname');
    nameWrap.appendChild(el('span', 'mg-pn', pl.name));
    if (pl.isSub) nameWrap.appendChild(el('span', 'mg-sub', 'SUB'));
    if (pl.mmr) nameWrap.appendChild(el('span', 'mg-mmr', String(pl.mmr)));
    row.appendChild(nameWrap);

    if (opts.showStats !== false) {
      var t = agg.get(String(pl.name).toLowerCase()) || blankTotals(pl.name);
      var pg = perGame(t);
      if (opts.statMode === 'full') {
        // Compact per-game line: all stats as small chips.
        var full = el('div', 'mg-pstats mg-pstats-full');
        // [label, per-game value, isScore(round + accent)]
        [['G', pg.goalsPG, false], ['A', pg.assistsPG, false], ['SV', pg.savesPG, false], ['SH', pg.shotsPG, false], ['DM', pg.demosPG, false], ['SC/G', pg.scorePG, true]]
          .forEach(function (s) { full.appendChild(chip(s[0], s[2] ? String(Math.round(s[1])) : fmt(s[1]))); });
        row.appendChild(full);
      } else {
        var best = pickBestOfRest(t, peers, minGames);
        var stats = el('div', 'mg-pstats');
        stats.appendChild(statBox('SCORE/G', fmt(pg.scorePG), false));
        stats.appendChild(statBox(best.label.toUpperCase() + '/G', fmt(best.value), true));
        row.appendChild(stats);
      }
    }
    return row;
  }

  function statBox(label, value, accent) {
    var b = el('div', 'mg-stat' + (accent ? ' mg-stat-accent' : ''));
    b.appendChild(el('span', 'mg-stat-v', value));
    b.appendChild(el('span', 'mg-stat-l', label));
    return b;
  }

  function chip(label, value) {
    var c = el('div', 'mg-chip');
    c.appendChild(el('span', 'mg-chip-v', value));
    c.appendChild(el('span', 'mg-chip-l', label));
    return c;
  }

  // ───────── Series aggregation ─────────

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

  // ───────── Export ─────────

  var MatchupCore = {
    SUPABASE_URL: SUPABASE_URL, SUPABASE_ANON: SUPABASE_ANON,
    LEAGUE_COLORS: LEAGUE_COLORS, LEAGUE_LABELS: LEAGUE_LABELS, LEAGUE_KEYS: LEAGUE_KEYS,
    ORG_TO_GM: ORG_TO_GM, ADMIN_TO_PUBLIC: ADMIN_TO_PUBLIC, PUBLIC_TO_ADMIN: PUBLIC_TO_ADMIN, TEAM_DATA: TEAM_DATA,
    TEAM_COLORS: TEAM_COLORS, colorForTeam: colorForTeam, roundLabel: roundLabel,
    slug: slug, normName: normName, levenshtein: levenshtein, matchPlayer: matchPlayer,
    getCurrentEraWeek: getCurrentEraWeek, minGamesFor: minGamesFor,
    aggregate: aggregate, perGame: perGame, pickBestOfRest: pickBestOfRest,
    rosterFor: rosterFor, eligibleSubs: eligibleSubs, LEAGUE_NUM: LEAGUE_NUM, buildMatchup: buildMatchup, resolveTonight: resolveTonight,
    leagueTotals: leagueTotals, fetchCloud: fetchCloud, renderCard: renderCard, sumSeriesGames: sumSeriesGames,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MatchupCore;
  if (typeof window !== 'undefined') window.MatchupCore = MatchupCore;
})();
