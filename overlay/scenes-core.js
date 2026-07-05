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

  // ── DOM builders ──────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function chrome(data, wkText) {
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

  function buildIntermission(data) {
    var rows = (data.schedule || []).map(function (row) {
      var timeStr = '';
      try {
        timeStr = new Date(row.time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
      } catch (e) { timeStr = esc(row.time || ''); }
      var live = row.upNext ? ' live' : '';
      var badge = row.upNext ? '<div class="s-badge">UP NEXT</div>' : '';
      return '<div class="s-row' + live + '">' +
        '<div class="s-teams">' +
          '<img src="' + esc((row.away && row.away.logo) || '') + '">' +
          esc((row.away && row.away.name) || '') +
          '<span class="at">AT</span>' +
          esc((row.home && row.home.name) || '') +
          '<img src="' + esc((row.home && row.home.logo) || '') + '">' +
        '</div>' +
        badge +
        '<div class="s-time">' + esc(timeStr) + '</div>' +
      '</div>';
    }).join('');
    return chrome(data) +
      '<div class="center" style="justify-content:flex-start;padding-top:24px">' +
        '<div class="eyebrow">STAY TUNED</div>' +
        '<div class="title" style="font-size:112px">INTER<span class="accent">MISSION</span></div>' +
        countdownBlock(data, 'RESUMING IN') +
        '<div class="sched">' +
          '<div class="s-lbl">TONIGHT\'S SCHEDULE — ALL TIMES EST</div>' +
          rows +
        '</div>' +
      '</div>' + footer();
  }

  function buildBRB(data) {
    return chrome(data) +
      '<div class="center">' +
        '<div class="eyebrow">HANG TIGHT</div>' +
        '<div class="title">BE RIGHT <span class="accent">BACK</span></div>' +
        '<div class="tagline">' + esc(data.tagline || 'Grabbing a quick break — the action resumes shortly.') + '</div>' +
        countdownBlock(data, 'BACK IN') +
      '</div>' + footer();
  }

  function buildThankYou(data) {
    var rows = (data.results || []).map(function (r) {
      var leftWins = r.leftWins || 0;
      var rightWins = r.rightWins || 0;
      var leftWin = leftWins > rightWins;
      var rightWin = rightWins > leftWins;
      var leftCls = leftWin ? ' win' : '';
      var rightCls = rightWin ? ' win' : '';
      var leftTag = leftWin ? '<span class="w-tag">W</span>' : '';
      var rightTag = rightWin ? '<span class="w-tag">W</span>' : '';
      return '<div class="res-row">' +
        '<div class="r-teams' + leftCls + '">' +
          '<img src="' + esc((r.left && r.left.logo) || '') + '">' +
          esc((r.left && r.left.name) || '') + leftTag +
        '</div>' +
        '<div class="r-score">' + leftWins + ' – ' + rightWins + '</div>' +
        '<div class="r-teams' + rightCls + '" style="justify-content:flex-end">' +
          rightTag + esc((r.right && r.right.name) || '') +
          '<img src="' + esc((r.right && r.right.logo) || '') + '">' +
        '</div>' +
        '<div class="r-final">FINAL</div>' +
      '</div>';
    }).join('');
    return chrome(data, data.week || '') +
      '<div class="center">' +
        '<div class="eyebrow">GG — SEE YOU NEXT TIME</div>' +
        '<div class="title" style="font-size:118px">THANK YOU <span class="accent">FOR WATCHING</span></div>' +
        '<div class="tagline">Full results, standings &amp; VODs at eliterocketassociation.com</div>' +
        '<div class="sched" style="max-width:940px">' +
          '<div class="s-lbl">TONIGHT\'S RESULTS</div>' +
          rows +
        '</div>' +
      '</div>' + footer();
  }

  function buildCastersDesk(data) {
    var casters = data.casters || [];
    function camSlot(idx) {
      var c = casters[idx] || {};
      return '<div class="cam">' +
        '<div class="cam-box"><div class="cam-placeholder">CAMERA ' + (idx + 1) + '</div></div>' +
        '<div class="nameplate">' +
          '<div class="caster-name">' + esc(c.name || '') + '</div>' +
          '<div class="caster-role">' + esc(c.role || '') + '</div>' +
        '</div>' +
      '</div>';
    }
    return chrome(data) +
      '<div class="center">' +
        '<div class="eyebrow">ON THE DESK</div>' +
        '<div class="title" style="font-size:100px">CASTERS\' <span class="accent">DESK</span></div>' +
        '<div class="desk">' + camSlot(0) + camSlot(1) + '</div>' +
        '<div class="lower3">' + esc(data.deskTopic || '') + '</div>' +
      '</div>' + footer();
  }

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

  var api = {
    formatCountdown: formatCountdown,
    tonightSchedule: tonightSchedule,
    resolveTonightResults: resolveTonightResults,
    buildScene: buildScene,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SceneRenderer = api;
})(typeof window !== 'undefined' ? window : null);
