const test = require("node:test");
const assert = require("node:assert");
const cf = require("./fixtures/companyfacts.json");
const { summarize, valuation, ttmAt, estimateNextReport, parseNasdaqEarnings, splitFactor } = require("../src/company");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const SPLITS = [{ date: "2024-10-01", ratio: 2 }];
const s = summarize(cf, { splits: SPLITS });
const byEnd = Object.fromEntries(s.quarters.map((q) => [q.end, q]));

test("quarters come from 10-Qs; 8-Ks are ignored and restatements win", () => {
  assert.deepStrictEqual(s.quarters.map((q) => q.end), ["2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"]);
  assert.strictEqual(byEnd["2023-03-31"].revenue, 101);
  assert.strictEqual(byEnd["2024-06-30"].revenue, 150, "six-month YTD figure is not a quarter");
});

test("Q4 = annual minus the three quarters when there is no nine-month figure", () => {
  assert.strictEqual(byEnd["2023-12-31"].revenue, 460 - (101 + 110 + 120));
  assert.ok(byEnd["2023-12-31"].derived);
});

test("Q4 = annual minus nine-month YTD, and tag variants merge by period", () => {
  assert.strictEqual(byEnd["2024-12-31"].revenue, 620 - 450);
  assert.strictEqual(byEnd["2024-12-31"].netIncome, 50 - 33);
  assert.ok(!byEnd["2024-09-30"].derived);
});

test("per-share values filed before a split are adjusted", () => {
  assert.strictEqual(splitFactor(SPLITS, "2024-08-01"), 2);
  assert.strictEqual(splitFactor(SPLITS, "2024-11-01"), 1);
  near(byEnd["2024-03-31"].eps, 0.5, "Q1 EPS halved");
  near(byEnd["2024-12-31"].eps, 2.4 - 1.65, "Q4 EPS");
});

test("trailing twelve months and margins", () => {
  assert.strictEqual(s.ttm.revenue, 140 + 150 + 160 + 170);
  assert.strictEqual(s.ttm.netIncome, 50);
  near(s.ttm.eps, 0.5 + 0.55 + 0.6 + 0.75, "TTM EPS");
  near(s.ttm.grossMargin, 0.6, "gross margin");
  near(byEnd["2024-12-31"].grossMargin, 0.6, "Q4 gross margin");
  assert.strictEqual(s.ttm.opMargin, null);
});

test("TTM needs four back-to-back quarters", () => {
  const q = (start, end, val) => ({ start, end, val });
  assert.strictEqual(ttmAt([q("2024-01-01", "2024-03-31", 1), q("2024-04-01", "2024-06-30", 1), q("2024-10-01", "2024-12-31", 1), q("2025-01-01", "2025-03-31", 1)]), null);
  assert.strictEqual(ttmAt([q("2024-01-01", "2024-03-31", 1)]), null);
});

test("balance sheet, debt parts and multi-class shares", () => {
  assert.deepStrictEqual(s.balance, { end: "2024-12-31", cash: 500, debt: 250 });
  assert.deepStrictEqual(s.shares, { val: 100, end: "2025-02-01" });
});

test("valuation: P/E, P/S and market cap from a price", () => {
  const v = valuation(s, 24);
  near(v.pe, 24 / 2.4, "P/E");
  assert.strictEqual(v.mcap, 2400);
  near(v.ps, 2400 / 620, "P/S");
  assert.strictEqual(v.peRange, null, "too little history for a range");
  assert.strictEqual(valuation({ ...s, ttm: { ...s.ttm, eps: -1 } }, 24).pe, null);
});

test("earnings date: Nasdaq parsing and the filing-cadence fallback", () => {
  const now = Date.parse("2026-10-15");
  const j = { data: { announcement: "Earnings announcement* for NVDA: Nov 18, 2026", reportText: "NVIDIA is estimated to report earnings on 11/18/2026." } };
  assert.deepStrictEqual(parseNasdaqEarnings(j, now), { date: "2026-11-18", estimated: true, source: "Zacks estimate via Nasdaq" });
  assert.strictEqual(parseNasdaqEarnings({ data: null }, now), null);
  assert.strictEqual(parseNasdaqEarnings({ data: { announcement: "Earnings announcement* for X: Jan 2, 2026" } }, now), null, "past dates are dropped");

  const fl = [
    { end: "2025-03-31", filed: "2025-05-01" }, { end: "2025-06-30", filed: "2025-07-31" },
    { end: "2025-09-30", filed: "2025-10-30" }, { end: "2025-12-31", filed: "2026-02-20" },
    { end: "2026-03-31", filed: "2026-05-01" }
  ];
  // next quarter ends ~30 Jun 2026; a year earlier the same quarter took 31 days
  const e = estimateNextReport(fl, Date.parse("2026-05-10"));
  assert.strictEqual(e.estimated, true);
  assert.strictEqual(e.date, "2026-07-31");
});
