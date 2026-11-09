const test = require("node:test");
const assert = require("node:assert");
const FX = require("../src/fx");

const DAY = 864e5, T0 = Date.UTC(2024, 0, 1);
const series = (n, f) => Array.from({ length: n }, (_, i) => [T0 + i * DAY, f(i)]);
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test("usdSeries flips quotes that are units per dollar", () => {
  const s = FX.usdSeries([{ t: 1, close: 150 }, { t: 2, close: 100 }], true);
  near(s[0][1], 1 / 150, 1e-7); near(s[1][1], 0.01, 1e-7);
  assert.deepStrictEqual(FX.usdSeries([{ t: 1, close: 1.25 }, { t: 2, close: 0 }], false), [[1, 1.25]]);
});

test("cross rate is usdPer(A) / usdPer(B), and USD is the number 1", () => {
  const eur = series(5, () => 1.1), jpy = series(5, () => 0.0100);
  const c = FX.cross(eur, jpy);
  near(c.pts[0][1], 110);
  const eurUsd = FX.cross(eur, null);
  near(eurUsd.pts[0][1], 1.1);
  const usdJpy = FX.cross(null, jpy);
  near(usdJpy.pts[0][1], 100);
});

test("cross rebases both legs to 100 and forward-fills the slower leg", () => {
  const a = series(4, (i) => [1, 2, 4, 4][i]);
  const b = [[T0, 10], [T0 + 2 * DAY, 20]]; // no point on days 1 and 3
  const c = FX.cross(a, b);
  assert.strictEqual(c.pts.length, 4);
  assert.deepStrictEqual(c.idx[0].slice(1), [100, 100]);
  near(c.idx[2][1], 400); near(c.idx[2][2], 200); near(c.idx[1][2], 100);
});

test("sliceRange keeps the window before the last point; joinSeries lets daily win the overlap", () => {
  const s = series(400, (i) => i);
  const m = FX.sliceRange(s, "1M");
  assert.ok(m.length >= 31 && m.length <= 33);
  assert.strictEqual(FX.sliceRange(s, "MAX").length, 400);
  const weekly = [[T0, 1], [T0 + 7 * DAY, 2], [T0 + 14 * DAY, 3]], daily = [[T0 + 10 * DAY, 9], [T0 + 11 * DAY, 10]];
  assert.deepStrictEqual(FX.joinSeries(weekly, daily).map((p) => p[1]), [1, 2, 9, 10]);
});

test("windowStats: change, high/low and position", () => {
  const pts = [[1, 10], [2, 20], [3, 15]];
  const s = FX.windowStats(pts, [[0, 5], [1, 10], [2, 20], [3, 15]]);
  near(s.chgPct, 50); near(s.high, 20); near(s.low, 10); near(s.pctInWindow, 50);
  near(s.pctOfHistory, 50); // 2 of 4 values below 15
});

test("compare rejects unknown or identical currencies and returns a cross for known ones", () => {
  const store = { EUR: { daily: series(300, () => 1.1), weekly: [] }, JPY: { daily: series(300, () => 0.01), weekly: [] } };
  assert.strictEqual(FX.compare(store, "EUR", "EUR", "1Y"), null);
  assert.strictEqual(FX.compare(store, "EUR", "XXX", "1Y"), null);
  const r = FX.compare(store, "EUR", "JPY", "3M");
  near(r.stats.last, 110); assert.ok(r.pts.length > 60 && r.pts.length < 100);
  near(FX.compare(store, "USD", "JPY", "1Y").stats.last, 100);
});

test("payload builds rows and megatrend cards from stored series", () => {
  const daily = series(400, (i) => 1 + i / 1000);
  const store = { EUR: { daily, weekly: [] }, DXY: { daily: series(400, (i) => 100 + i / 10), weekly: [] } };
  const p = FX.payload({ at: 1, store });
  assert.strictEqual(p.rows[0].code, "EUR");
  assert.ok(p.rows[0].ret["1M"] > 0 && p.rows[0].vsMa200 > 0);
  assert.ok(p.megatrends.some((m) => /dollar/i.test(m.title)));
  assert.strictEqual(FX.payload({ at: 0, store: {} }).empty, true);
});

test("cross ends on the later leg's newest value even when the timestamps differ", () => {
  const a = [[T0, 1], [T0 + DAY, 2]], b = [[T0, 10], [T0 + DAY, 10], [T0 + DAY + 3600e3, 20]];
  const c = FX.cross(a, b);
  near(c.pts[c.pts.length - 1][1], 2 / 20);
});
