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
