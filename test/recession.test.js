const test = require("node:test");
const assert = require("node:assert");
const R = require("../src/recession");

// deterministic pseudo-random numbers
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function normal(u) { return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u()); }

test("probit fit recovers known parameters from synthetic data", () => {
  const u = rng(7), z = normal(u), a = -0.4, b = -0.7, x = [], y = [];
  for (let i = 0; i < 20000; i++) { const xi = 1 + 1.3 * z(); x.push(xi); y.push(a + b * xi + z() > 0 ? 1 : 0); }
  const f = R.fitProbit(x, y);
  assert.ok(Math.abs(f.a - a) < 0.05, `a=${f.a}`);
  assert.ok(Math.abs(f.b - b) < 0.05, `b=${f.b}`);
  // the MLE beats nearby parameters
  const ll = (aa, bb) => x.reduce((s, xi, i) => { const p = R.Phi(aa + bb * xi); return s + (y[i] ? Math.log(p) : Math.log(1 - p)); }, 0);
  assert.ok(f.logLik >= ll(f.a + 0.02, f.b) && f.logLik >= ll(f.a, f.b - 0.02));
});

test("Phi matches known values, including the tails", () => {
  assert.ok(Math.abs(R.Phi(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(R.Phi(1.959964) - 0.975) < 1e-6);
  assert.ok(Math.abs(R.Phi(-3) - 0.0013499) < 1e-6);
});

test("track record: caught, lead times, false alarms, pending, late", () => {
  // months 0..119; probabilities ≥ 0.3 in runs: 10–14 (leads recession at 20), 40–42 (false alarm),
  // 70–73 (starts during recession 68–75: late), 105–108 (pending: fewer than 24 months of outcomes)
  const hi = new Set([10, 11, 12, 13, 14, 40, 41, 42, 70, 71, 72, 73, 105, 106, 107, 108]);
  const probs = Array.from({ length: 120 }, (_, m) => [m, hi.has(m) ? 0.6 : 0.1]);
  const recs = [{ start: 20, end: 25 }, { start: 68, end: 75 }, { start: 95, end: 97 }];
  const t = R.trackRecord(probs, recs, 119, 0.3, 24);
  assert.deepStrictEqual(t.recessions.map((r) => [r.start, r.caught, r.lead]), [[68, false, null], [95, false, null]]);
  // recession at 20 has fewer than 24 months of readings before it, so it isn't scored
  assert.strictEqual(t.total, 2);
  assert.strictEqual(t.caught, 0);
  assert.deepStrictEqual(t.falseAlarms.map((w) => [w.start, w.end]), [[40, 42]]);
  assert.deepStrictEqual(t.late.map((w) => w.start), [70]);
  assert.deepStrictEqual(t.pending.map((w) => w.start), [105]);
});

test("track record: lead is months from first warning to recession start", () => {
  const hi = new Set([30, 31, 32, 33, 60, 61, 80]);
  const probs = Array.from({ length: 150 }, (_, m) => [m, hi.has(m) ? 0.5 : 0.05]);
  const recs = [{ start: 42, end: 50 }, { start: 70, end: 72 }, { start: 120, end: 125 }];
  const t = R.trackRecord(probs, recs, 149, 0.3, 24);
  assert.deepStrictEqual(t.recessions.map((r) => [r.start, r.caught, r.lead]), [[42, true, 12], [70, true, 10], [120, false, null]]);
  assert.strictEqual(t.avgLead, 11);
  // run at 80 is 40 months before the 120 recession: a false alarm
  assert.deepStrictEqual(t.falseAlarms.map((w) => w.start), [80]);
});

test("episodes splits a 0/1 monthly series into recessions", () => {
  const f = new Map([[0, 0], [1, 1], [2, 1], [3, 0], [4, 0], [5, 1]]);
  assert.deepStrictEqual(R.episodes(f), [{ start: 1, end: 2 }, { start: 5, end: 5, ongoing: true }]);
});
