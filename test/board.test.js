const test = require("node:test");
const assert = require("node:assert");
const M = require("../src/macro/board");
const { build } = require("../src/board");
const { INDICATORS, SECTIONS } = require("../src/macro/indicators");

const DAY = 864e5;
const mon = (y, m) => Date.UTC(y, m, 1);
// 100 monthly readings from Jan 2000, value = i (so value 0..99, rising)
const rising = Array.from({ length: 100 }, (_, i) => [mon(2000, i), i]);
const up = { id: "x", sign: 1, factor: "growth", freq: "m" };   // higher is better
const down = { id: "y", sign: -1, factor: "labor", freq: "m" }; // e.g. unemployment: lower is better

test("decile boundaries: D1 is the worst tenth, D10 the best", () => {
  assert.strictEqual(M.decile(0), 1);
  assert.strictEqual(M.decile(0.0999), 1);
  assert.strictEqual(M.decile(0.1), 2);
  assert.strictEqual(M.decile(0.5), 6);
  assert.strictEqual(M.decile(0.95), 10);
  assert.strictEqual(M.decile(1), 10);
});

test("percentile counts ties as half", () => {
  assert.strictEqual(M.pctile([1, 2, 3, 4], 3), 0.625);
  assert.strictEqual(M.pctile([5, 5, 5, 5], 5), 0.5);
  assert.strictEqual(M.pctile([], 1), 0.5);
});

test("direction: sign × whether more of the factor is good", () => {
  const d = (id) => M.direction(INDICATORS.find((x) => x.id === id));
  assert.strictEqual(d("gdp"), 1);
  assert.strictEqual(d("unrate"), -1);  // sign −1 on labor
  assert.strictEqual(d("cpi"), -1);     // more inflation is bad
  assert.strictEqual(d("hy"), -1);      // wider spreads are bad
  assert.strictEqual(d("vix"), -1);     // more stress is bad
  assert.strictEqual(d("ff"), -1);      // higher policy rate = tighter
  assert.strictEqual(d("ecb"), -1);
  assert.strictEqual(d("spx"), 1);      // own price trend
  assert.strictEqual(d("curve"), 1);
  for (const x of INDICATORS) assert.ok(Math.abs(M.direction(x)) === 1, x.id);
});

test("rank: the latest of a rising series is D10 when higher is better, D1 when lower is", () => {
  const a = M.rank(rising, up), b = M.rank(rising, down);
  assert.strictEqual(a.v, 99);
  assert.strictEqual(a.n, 100);
  assert.strictEqual(a.decile, 10);
  assert.strictEqual(b.decile, 1);
  assert.strictEqual(a.pct, b.pct); // the raw percentile doesn't depend on direction
  assert.strictEqual(a.good + b.good, 1);
  assert.deepStrictEqual(a.prior, [mon(2000, 98), 98]);
  assert.deepStrictEqual(a.yearAgo, [mon(2000, 87), 87]);
  assert.strictEqual(a.since, mon(2000, 0));
});

test("rank: the range start changes the history, the as-of date changes the reading", () => {
  // a series that is high early and low recently: 50 readings at 100, then 0..49
  const s = [...Array.from({ length: 50 }, (_, i) => [mon(1990, i), 100]), ...Array.from({ length: 50 }, (_, i) => [mon(1990, 50 + i), i])];
  const all = M.rank(s, up);
  assert.strictEqual(all.v, 49);
  assert.ok(all.decile <= 5); // below every early reading
  const recent = M.rank(s, up, { from: mon(1990, 50) });
  assert.strictEqual(recent.n, 50);
  assert.strictEqual(recent.decile, 10); // the top of the recent window
  assert.strictEqual(recent.since, mon(1990, 50));
  // as of month 60 (value 10): only readings up to then count, the latest after it is ignored
  const past = M.rank(s, up, { from: mon(1990, 50), asOf: mon(1990, 60) + 5 * DAY });
  assert.strictEqual(past.v, 10);
  assert.strictEqual(past.t, mon(1990, 60));
  assert.strictEqual(past.n, 11);
  assert.strictEqual(past.decile, 10);
  assert.strictEqual(M.rank(s, up, { asOf: mon(1989, 0) }), null); // before the first reading
});

test("rank: staleness is judged against the as-of date", () => {
  const s = [[mon(2020, 0), 1], [mon(2020, 1), 2]];
  assert.strictEqual(M.rank(s, up, { asOf: mon(2020, 2) }).stale, false);
  assert.strictEqual(M.rank(s, up, { asOf: mon(2020, 9) }).stale, true);
  assert.strictEqual(M.rank(s, up, { asOf: mon(2021, 6) }).dropped, true);
});

test("monthly: keeps the last observation of each month", () => {
  const d = [[Date.UTC(2026, 0, 2), 1], [Date.UTC(2026, 0, 30), 2], [Date.UTC(2026, 1, 3), 3], [Date.UTC(2026, 2, 31), 4]];
  assert.deepStrictEqual(M.toMonthly(d), [[Date.UTC(2026, 0, 30), 2], [Date.UTC(2026, 1, 3), 3], [Date.UTC(2026, 2, 31), 4]]);
});

test("board: section score is the average of its tiles, overall the average of sections", () => {
  const defs = [
    { id: "a", section: "s1", sign: 1, factor: "growth", freq: "m" },
    { id: "b", section: "s1", sign: -1, factor: "growth", freq: "m" },
    { id: "c", section: "s2", sign: 1, factor: "growth", freq: "m" },
    { id: "d", section: "s3", sign: 1, factor: "growth", freq: "m" }
  ];
  const r = M.board(defs, { a: rising, b: rising, c: rising }, [["s1"], ["s2"], ["s3"]], { asOf: mon(2008, 3) });
  assert.strictEqual(r.groups.s1, 50); // one best, one worst
  assert.strictEqual(r.groups.s2, Math.round(r.tiles.c.good * 100));
  assert.strictEqual(r.groups.s3, null); // no data
  assert.strictEqual(r.overall, Math.round((50 + r.groups.s2) / 2));
  assert.strictEqual(r.tiles.d, null);
});

test("range buttons: N years before the as-of date, never before the first data", () => {
  const start = mon(1950, 0), asOf = mon(2026, 9);
  assert.strictEqual(M.rangeFrom("all", asOf, start), start);
  assert.strictEqual(new Date(M.rangeFrom(10, asOf, start)).getUTCFullYear(), 2016);
  assert.strictEqual(M.rangeFrom(100, asOf, start), start);
});

test("build: monthly transformed series per indicator and recession spans", () => {
  const raw = {
    "fred:UNRATE": [[mon(2019, 11), 3.6], [mon(2020, 0), 3.5], [mon(2020, 3), 14.8]],
    "fred:USREC": [[mon(2020, 0), 0], [mon(2020, 2), 1], [mon(2020, 3), 1], [mon(2020, 4), 0]]
  };
  const b = build(raw);
  assert.deepStrictEqual(b.series.unrate, [[mon(2019, 11), 3.6], [mon(2020, 0), 3.5], [mon(2020, 3), 14.8]]);
  assert.deepStrictEqual(b.recessions, [[mon(2020, 2), mon(2020, 4)]]);
  assert.ok(!b.series.gdp); // nothing downloaded for it
  assert.ok(SECTIONS.every(([k]) => INDICATORS.some((x) => x.section === k)));
});
