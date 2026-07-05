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
