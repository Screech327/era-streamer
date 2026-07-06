const test = require('node:test');
const assert = require('node:assert');
const C = require('../overlay/matchup-graphic-core.js');

test('slug matches schedule id format', () => {
  assert.equal(C.slug('The Berk Night Furies'), 'the-berk-night-furies');
  assert.equal(C.slug('Queen City Monarchs'), 'queen-city-monarchs');
  assert.equal(C.slug("Dragon's Edge Rumblehorns"), 'dragons-edge-rumblehorns');
});

test('matchPlayer resolves alias then exact then fuzzy', () => {
  const known = [{ name: 'Dain' }, { name: 'Knightyuh' }];
  assert.equal(C.matchPlayer('DAINBRAMAGE18', { dainbramage18: 'Dain' }, known).name, 'Dain');
  assert.equal(C.matchPlayer('knightyuh', {}, known).name, 'Knightyuh');
  assert.equal(C.matchPlayer('Knightyuh!', {}, known).name, 'Knightyuh'); // normalized exact
  assert.equal(C.matchPlayer('totally-unknown-xyz', {}, known), null);
});

test('aggregate sums per-player across games', () => {
  const archive = [{
    matchup: { left: { code: 'qc', league: 'league1' }, right: { code: 'berk', league: 'league1' } },
    games: [
      { teamScores: [3, 1], players: { 0: { name: 'Knightyuh', teamNum: 0, score: 400, goals: 2, saves: 1, shots: 4, assists: 0, demos: 1 } } },
      { teamScores: [2, 3], players: { 0: { name: 'Knightyuh', teamNum: 0, score: 200, goals: 1, saves: 3, shots: 2, assists: 1, demos: 0 } } },
    ],
  }];
  const agg = C.aggregate(archive, {}, [{ name: 'Knightyuh' }]);
  const k = agg.get('knightyuh');
  assert.equal(k.gamesPlayed, 2);
  assert.equal(k.goals, 3);
  assert.equal(k.saves, 4);
  assert.equal(k.score, 600);
});

test('aggregate counts a player once per game even if duplicated', () => {
  const archive = [{
    matchup: { left: { code: 'qc', league: 'league1' }, right: { code: 'berk', league: 'league1' } },
    games: [
      { teamScores: [1, 0], players: {
        a: { name: 'Knightyuh', teamNum: 0, score: 100, goals: 1, saves: 0, shots: 1, assists: 0, demos: 0 },
        b: { name: 'knightyuh', teamNum: 0, score: 999, goals: 9, saves: 9, shots: 9, assists: 9, demos: 9 },
      } },
    ],
  }];
  const agg = C.aggregate(archive, {}, [{ name: 'Knightyuh' }]);
  assert.equal(agg.get('knightyuh').gamesPlayed, 1);
  assert.equal(agg.get('knightyuh').goals, 1);
});

test('perGame computes rates', () => {
  const r = C.perGame({ gamesPlayed: 4, score: 800, goals: 4, assists: 2, saves: 12, shots: 16, demos: 2 });
  assert.equal(r.scorePG, 200);
  assert.equal(r.savesPG, 3);
  assert.equal(r.goalsPG, 1);
});

test('pickBestOfRest returns highest-percentile stat vs peers', () => {
  // Player is league-best at saves/game though shots/game is numerically larger.
  const me = { gamesPlayed: 4, goals: 4, assists: 1, saves: 12, shots: 16, demos: 2 };
  const peers = [
    me,
    { gamesPlayed: 4, goals: 8, assists: 4, saves: 2, shots: 40, demos: 1 },
    { gamesPlayed: 4, goals: 6, assists: 3, saves: 3, shots: 30, demos: 0 },
  ];
  const best = C.pickBestOfRest(me, peers, 3);
  assert.equal(best.key, 'saves');
  assert.equal(best.value, 3); // 12/4
});

test('pickBestOfRest falls back to raw top rate below minGames', () => {
  const me = { gamesPlayed: 1, goals: 0, assists: 0, saves: 5, shots: 1, demos: 0 };
  const best = C.pickBestOfRest(me, [me], 3);
  assert.equal(best.key, 'saves'); // 5/game is the raw top
});

test('getCurrentEraWeek math (season start + bye)', () => {
  assert.equal(C.getCurrentEraWeek(new Date('2026-04-27T12:00:00-04:00')), 1);
  assert.equal(C.getCurrentEraWeek(new Date('2026-04-20T12:00:00-04:00')), 0); // pre-season
  // After the 6/1 bye, weeks shift back by one.
  assert.equal(C.getCurrentEraWeek(new Date('2026-06-15T12:00:00-04:00')), 7);
});

test('resolveTonight parses match_id and filters to today ET', () => {
  const players = [
    { name: 'A', mmr: 1500, league: 'league1', drafted: true, drafted_by: 'qc', dropped: false },
    { name: 'B', mmr: 1400, league: 'league1', drafted: true, drafted_by: 'qc', dropped: false },
    { name: 'C', mmr: 1300, league: 'league1', drafted: true, drafted_by: 'qc', dropped: false },
    { name: 'D', mmr: 1500, league: 'league1', drafted: true, drafted_by: 'berk', dropped: false },
    { name: 'E', mmr: 1400, league: 'league1', drafted: true, drafted_by: 'berk', dropped: false },
    { name: 'F', mmr: 1300, league: 'league1', drafted: true, drafted_by: 'berk', dropped: false },
  ];
  const scheduled = [
    { match_id: 'champion-w9-queen-city-monarchs-vs-the-berk-night-furies', scheduled_time: '2026-06-28T19:00:00-04:00' },
    { match_id: 'champion-w9-queen-city-monarchs-vs-the-berk-night-furies', scheduled_time: '2026-07-01T19:00:00-04:00' },
  ];
  const got = C.resolveTonight(scheduled, players, new Date('2026-06-28T20:00:00-04:00'));
  assert.equal(got.length, 1);
  assert.equal(got[0].league, 'champion');
  assert.equal(got[0].home.org, 'qc');
  assert.equal(got[0].home.name, 'Queen City Monarchs');
  assert.equal(got[0].away.org, 'berk');
  assert.equal(got[0].home.roster.length, 3);
  // roster sorted MMR desc
  assert.equal(got[0].home.roster[0].name, 'A');
});

test('eligibleSubs: same org, strictly lower league only', () => {
  const players = [
    { name: 'ChampGuy', mmr: 2000, league: 'league1', drafted: true, drafted_by: 'qc', dropped: false },
    { name: 'MajorGuy', mmr: 1600, league: 'league2', drafted: true, drafted_by: 'qc', dropped: false },
    { name: 'MinorGuy', mmr: 1400, league: 'league3', drafted: true, drafted_by: 'qc', dropped: false },
    { name: 'AcadGuy',  mmr: 1200, league: 'league4', drafted: true, drafted_by: 'qc', dropped: false },
    { name: 'OtherOrg', mmr: 1500, league: 'league3', drafted: true, drafted_by: 'berk', dropped: false },
  ];
  // Major can pull from minor + academy (below), never champion (above) or another org.
  assert.deepEqual(C.eligibleSubs(players, 'qc', 'major').map(p => p.name).sort(), ['AcadGuy', 'MinorGuy']);
  // Champion can pull from every lower tier of its org.
  assert.deepEqual(C.eligibleSubs(players, 'qc', 'champion').map(p => p.name).sort(), ['AcadGuy', 'MajorGuy', 'MinorGuy']);
  // Academy (lowest) has nobody below it.
  assert.deepEqual(C.eligibleSubs(players, 'qc', 'academy'), []);
});

test('buildMatchup attaches rosters by org+league', () => {
  const players = [
    { name: 'A', mmr: 1500, league: 'league2', drafted: true, drafted_by: 'qc', dropped: false },
    { name: 'B', mmr: 1400, league: 'league2', drafted: true, drafted_by: 'qc', dropped: false },
    { name: 'X', mmr: 1500, league: 'league2', drafted: true, drafted_by: 'suit', dropped: false },
  ];
  const m = C.buildMatchup('major', 'qc', 'suit', players);
  assert.equal(m.home.name, 'Queen City Knights'); // qc major team
  assert.equal(m.away.name, 'Silver Spring Stars'); // suit major team
  assert.equal(m.home.roster.length, 2);
});

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
