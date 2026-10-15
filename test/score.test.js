const test = require("node:test");
const assert = require("node:assert");
const S = require("../src/macro/score");
const W = require("../src/macro/weights");
const { parseFredCsv } = require("../src/macro/data");
const { INDICATORS, sourcesFor } = require("../src/macro/indicators");

const DAY = 864e5;
const now = Date.UTC(2026, 9, 15);
// monthly series for 11 years, value = f(month index)
const monthly = (f) => Array.from({ length: 132 }, (_, i) => [Date.UTC(2015, 10 + i, 1), f(i)]);
const daily = (f, n = 400) => Array.from({ length: n }, (_, i) => [now - (n - 1 - i) * DAY, f(i)]);

test("FRED CSV parsing skips missing values", () => {
  const rows = parseFredCsv("observation_date,DGS10\n2026-10-09,4.10\n2026-10-12,.\n2026-10-13,4.15\n");
  assert.deepStrictEqual(rows, [[Date.parse("2026-10-09T00:00:00Z"), 4.1], [Date.parse("2026-10-13T00:00:00Z"), 4.15]]);
});

test("every indicator has a section, factor and data source", () => {
  const ids = new Set();
  for (const d of INDICATORS) {
    assert.ok(!ids.has(d.id), "duplicate id " + d.id); ids.add(d.id);
    assert.ok(d.section && d.factor && d.desc, d.id);
    assert.ok(sourcesFor(d).every((k) => /^(fred|yahoo):/.test(k)), d.id);
  }
  assert.ok(INDICATORS.length >= 50);
});

test("transforms: year over year, 3-month annualized, 3-month average change", () => {
  const idx = monthly((i) => 100 * Math.pow(1.01, i)); // +1% a month
  const yoy = S.transform({ src: "fred:X", tf: "yoy" }, { "fred:X": idx });
  assert.ok(Math.abs(yoy.at(-1)[1] - (Math.pow(1.01, 12) - 1) * 100) < 1e-9);
  const ann = S.transform({ src: "fred:X", tf: "ann3m" }, { "fred:X": idx });
  assert.ok(Math.abs(ann.at(-1)[1] - (Math.pow(1.01, 12) - 1) * 100) < 1e-9);
  const jobs = S.transform({ src: "fred:X", tf: "chg3" }, { "fred:X": monthly((i) => 150000 + i * 120) });
  assert.strictEqual(jobs.at(-1)[1], 120);
});

test("transforms: 200-day gap and derived spreads/ratios", () => {
  const gap = S.transform({ src: "yahoo:X", tf: "ma200" }, { "yahoo:X": daily(() => 100) });
  assert.strictEqual(gap.length, 201);
  assert.strictEqual(gap.at(-1)[1], 0);
  const spread = S.transform({ src: "derived:A-B" }, { "fred:A": daily(() => 4.5, 5), "fred:B": daily(() => 4.0, 5) });
  assert.deepStrictEqual(spread.map((p) => p[1]), [0.5, 0.5, 0.5, 0.5, 0.5]);
  const ratio = S.transform({ src: "derived:A/B", scale: 1000 }, { "yahoo:A": daily(() => 5, 3), "yahoo:B": daily(() => 4000, 3) });
  assert.deepStrictEqual(ratio.map((p) => p[1]), [1.25, 1.25, 1.25]);
  assert.deepStrictEqual(S.transform({ src: "fred:MISSING" }, {}), []);
});

test("analyze: level percentile and 6-month trend", () => {
  const rising = monthly((i) => i); // steadily rising: top of its range, and the latest 6m change is typical
  const a = S.analyze(rising, now);
  assert.ok(a.L > 0.98, "at the top of its range");
  assert.strictEqual(a.chg, 6);
  const spike = monthly((i) => (i > 125 ? 20 + i : i)); // jumped recently: trend in the top of past changes
  assert.ok(S.analyze(spike, now).T > 0.95);
  const old = monthly((i) => i).slice(0, 100);
  assert.ok(S.analyze(old, now).stale && S.analyze(old, now).dropped);
});

// A small fake world: one indicator per factor, all pushed the same way.
function world({ growth, inflation, credit }) {
  const defs = [
    { id: "g", section: "growth", src: "fred:G", factor: "growth", sign: 1, freq: "m" },
    { id: "i", section: "inflation", src: "fred:I", factor: "inflation", sign: 1, freq: "m" },
    { id: "hy", section: "credit", src: "fred:HY", factor: "credit", sign: -1, freq: "m" }
  ];
  // the last 6 months move sharply in the given direction (+1 up, -1 down)
  const shaped = (dir) => monthly((i) => 50 + (i > 125 ? dir * (i - 125) * 5 : Math.sin(i)));
  const raw = { "fred:G": shaped(growth), "fred:I": shaped(inflation), "fred:HY": shaped(credit) };
  return S.evaluate(defs, S.prepare(defs, raw), S.mergeWeights(W, {}), now);
}

test("growth up, inflation down, spreads tightening: goldilocks, stocks bullish, bonds weaker", () => {
  const r = world({ growth: 1, inflation: -1, credit: -1 });
  assert.strictEqual(r.regime.key, "goldilocks");
  assert.ok(r.assets.stocks.score >= 70, "stocks " + r.assets.stocks.score);
  assert.ok(r.assets.stocks.score > r.assets.bonds.score);
  assert.deepStrictEqual(r.assets.stocks.down, []);
});

test("growth down, inflation up, spreads widening: stagflation, stocks bearish, commodities beat stocks", () => {
  const r = world({ growth: -1, inflation: 1, credit: 1 });
  assert.strictEqual(r.regime.key, "stagflation");
  assert.ok(r.assets.stocks.score <= 30, "stocks " + r.assets.stocks.score);
  assert.ok(r.assets.commodities.score > r.assets.stocks.score);
  assert.strictEqual(r.assets.stocks.down[0][0], "hy", "credit has the biggest stocks weight");
});

test("contributions add up to the score and section scores are 0–100", () => {
  const r = world({ growth: 1, inflation: 1, credit: -1 });
  for (const a of Object.values(r.assets)) {
    const sum = Object.values(a.contrib).reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(50 + Math.max(-50, Math.min(50, sum)) - a.score) <= 0.5, `${a.score} vs ${50 + sum}`);
    for (const v of Object.values(a.sections)) assert.ok(v >= 0 && v <= 100);
  }
});

test("bad weight files fall back to defaults", () => {
  const w = S.mergeWeights(W, { stretch: "lots", horizonMonths: 99, assets: { stocks: { growth: 1 } } });
  assert.strictEqual(w.stretch, W.stretch);
  assert.strictEqual(w.horizonMonths, 24);
  assert.deepStrictEqual(w.assets.stocks, { growth: 1 });
  assert.deepStrictEqual(w.assets.bonds, W.assets.bonds);
  assert.deepStrictEqual(S.mergeWeights(W, null).assets, W.assets);
});

test("score labels", () => {
  assert.deepStrictEqual([80, 60, 50, 35, 10].map(S.label), ["Bullish", "Leaning bullish", "Neutral", "Leaning bearish", "Bearish"]);
});
