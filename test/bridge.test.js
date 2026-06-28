const test = require('node:test');
const assert = require('node:assert');
const { JsonStreamParser } = require('../src/bridge.js');

function collect(parser, buf) {
  const out = [];
  parser.feed(buf, (m) => out.push(m));
  return out;
}

test('parses a complete message and unwraps escaped Data', () => {
  const p = new JsonStreamParser();
  const msg = JSON.stringify({ Event: 'UpdateState', Data: JSON.stringify({ a: 1 }) });
  const out = collect(p, Buffer.from(msg, 'utf8'));
  assert.equal(out.length, 1);
  assert.equal(out[0].Event, 'UpdateState');
  assert.deepEqual(out[0].Data, { a: 1 }); // Data string was JSON.parsed
});

test('reassembles a message split across two chunks', () => {
  const p = new JsonStreamParser();
  const msg = JSON.stringify({ Event: 'X', Data: 'y' });
  const b = Buffer.from(msg, 'utf8');
  const out = [];
  p.feed(b.slice(0, 7), (m) => out.push(m));
  assert.equal(out.length, 0);
  p.feed(b.slice(7), (m) => out.push(m));
  assert.equal(out.length, 1);
  assert.equal(out[0].Event, 'X');
});

test('handles a multi-byte UTF-8 char split across chunk boundary', () => {
  const p = new JsonStreamParser();
  // "café" — é is 0xC3 0xA9; split the buffer between those two bytes.
  const msg = JSON.stringify({ name: 'café' });
  const b = Buffer.from(msg, 'utf8');
  const cut = b.indexOf(0xc3) + 1; // mid-character
  const out = [];
  p.feed(b.slice(0, cut), (m) => out.push(m));
  p.feed(b.slice(cut), (m) => out.push(m));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'café'); // char intact, not corrupted
});

test('two messages back to back, with junk/whitespace between them', () => {
  const p = new JsonStreamParser();
  const data = '\n  ' + JSON.stringify({ Event: 'A' }) + '\r\n garbage }} ' + JSON.stringify({ Event: 'B' });
  const out = collect(p, Buffer.from(data, 'utf8'));
  assert.deepEqual(out.map((m) => m.Event), ['A', 'B']);
});

test('desync (stray closing braces) does not grow the buffer unbounded', () => {
  const p = new JsonStreamParser();
  // A pile of stray close-braces + garbage: must NOT accumulate in buf.
  collect(p, Buffer.from('}}}}'.repeat(100000), 'utf8'));
  assert.ok(p.buf.length < 1000, 'buffer should stay small after garbage, got ' + p.buf.length);
  // Parser still works afterward.
  const out = collect(p, Buffer.from(JSON.stringify({ Event: 'OK' }), 'utf8'));
  assert.equal(out.length, 1);
  assert.equal(out[0].Event, 'OK');
});

test('an unterminated object past the cap is dropped (no OOM), then resyncs', () => {
  const p = new JsonStreamParser();
  // Open an object and never close it, far past the 4MB cap.
  collect(p, Buffer.from('{"x":"' + 'a'.repeat(5 * 1024 * 1024), 'utf8'));
  assert.ok(p.buf.length < 5 * 1024 * 1024, 'over-cap buffer should have been reset');
  const out = collect(p, Buffer.from(JSON.stringify({ Event: 'AFTER' }), 'utf8'));
  assert.equal(out.length, 1);
  assert.equal(out[0].Event, 'AFTER');
});
