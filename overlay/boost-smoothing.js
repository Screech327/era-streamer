// Frame-rate-independent easing for the live boost meters.
//
// RL's native StatsAPI emits UpdateState at a variable/irregular cadence
// (driven by the observer's machine + game FPS), so rendering raw boost
// values per tick makes the meters jump. The overlay instead eases the
// *displayed* value toward the latest target every animation frame — the
// same approach the Customize preview already uses — which decouples visual
// smoothness from source cadence.
//
// This math lives in its own module so it can be unit-tested (see
// test/boost-smoothing.test.js). match.html loads it as a plain <script>.
(function (root) {
  'use strict';

  // Ease `display` toward `target` over `dt` seconds using an exponential
  // smoothing time constant `tau` (seconds; smaller = snappier). Snaps to
  // `target` once within `epsilon` so it settles instead of chasing a
  // forever-shrinking remainder. Frame-rate independent: the same tau gives
  // the same wall-clock response whether called at 30fps or 144fps.
  function easeToward(display, target, dt, tau, epsilon) {
    if (!(dt > 0) || !(tau > 0)) return target;
    if (epsilon == null) epsilon = 0.4;
    const alpha = 1 - Math.exp(-dt / tau);
    let next = display + (target - display) * alpha;
    if (Math.abs(target - next) <= epsilon) next = target;
    return next;
  }

  // Coerce an arbitrary boost reading into a sane 0..100 number. NaN/±Inf/
  // undefined collapse to 0 so a garbage tick can't blow up the meter.
  function clampBoost(value) {
    value = Number(value);
    if (!isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
  }

  const api = { easeToward, clampBoost };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoostSmoothing = api;
})(typeof window !== 'undefined' ? window : null);
