const test = require('node:test');
const assert = require('node:assert');
const { easeToward, clampBoost } = require('../overlay/boost-smoothing.js');

test('easeToward moves toward the target', () => {
  const next = easeToward(0, 100, 1 / 60, 0.09);
  assert.ok(next > 0 && next < 100, `expected 0<next<100, got ${next}`);
});

test('easeToward converges to the target over time and never overshoots', () => {
  let v = 0;
  let prev = 0;
  for (let i = 0; i < 600; i++) {           // ~10s at 60fps
    v = easeToward(v, 100, 1 / 60, 0.09);
    assert.ok(v >= prev, `must be monotonic up: ${prev} -> ${v}`);
    assert.ok(v <= 100, `must not overshoot: ${v}`);
    prev = v;
  }
  assert.equal(v, 100);
});

test('easeToward eases downward too', () => {
  const next = easeToward(100, 0, 1 / 60, 0.09);
  assert.ok(next > 0 && next < 100, `expected drain toward 0, got ${next}`);
});

test('easeToward snaps to target within epsilon', () => {
  assert.equal(easeToward(99.9, 100, 1 / 60, 0.09), 100);
  assert.equal(easeToward(0.05, 0, 1 / 60, 0.09), 0);
});

test('easeToward is frame-rate independent (similar response for same wall-clock)', () => {
  // One 100ms step vs six ~16.7ms steps should land close to each other.
  const big = easeToward(0, 100, 0.1, 0.09);
  let small = 0;
  for (let i = 0; i < 6; i++) small = easeToward(small, 100, 0.1 / 6, 0.09);
  assert.ok(Math.abs(big - small) < 1.5, `expected close, got ${big} vs ${small}`);
});

test('easeToward with non-positive dt/tau returns target (no NaN)', () => {
  assert.equal(easeToward(10, 50, 0, 0.09), 50);
  assert.equal(easeToward(10, 50, 1 / 60, 0), 50);
});

test('clampBoost clamps to 0..100 and coerces garbage to 0', () => {
  assert.equal(clampBoost(50), 50);
  assert.equal(clampBoost(-5), 0);
  assert.equal(clampBoost(150), 100);
  assert.equal(clampBoost(NaN), 0);
  assert.equal(clampBoost(undefined), 0);
  assert.equal(clampBoost(Infinity), 0);
  assert.equal(clampBoost('73'), 73);
});
