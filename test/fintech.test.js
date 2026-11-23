const test = require("node:test");
const assert = require("node:assert");
const F = require("../src/fintech");
const U = require("../src/fintech-universe");

// a daily bar stamped like barsFromChart does: the exchange's local 9:30 written as UTC
const bar = (ymd, close) => ({ t: Date.UTC(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100, 9, 30), close });

test("universe: sub-sectors in order, one per company, no duplicates, aliases compile", () => {
  assert.deepEqual(U.SUBSECTORS.map((s) => s.id), ["pay", "lend", "bank", "brok", "cryp", "infra", "soft", "ins"]);
  const ids = new Set(U.SUBSECTORS.map((s) => s.id)), syms = U.COMPANIES.map((c) => c.sym);
  assert.equal(new Set(syms).size, syms.length);
  for (const c of U.COMPANIES) { assert.ok(ids.has(c.sub), c.sym); assert.ok(c.name); new RegExp(c.alias); }
  for (const s of U.SUBSECTORS) assert.ok(U.COMPANIES.some((c) => c.sub === s.id), s.id);
  assert.equal(U.BENCHMARKS[0].sym, "SPY");
  assert.deepEqual(U.symbols().slice(0, 5), ["SPY", "XLF", "FINX", "ARKF", "IPAY"]);
  assert.equal(U.subOf.COIN, "cryp");
});

test("capsFromScreener: picks the universe's rows, tidies names, parses numbers", () => {
  const rows = [
    { symbol: "V", name: "Visa Inc. Class A Common Stock", marketCap: "650,000,000,000", lastsale: "$340.10", pctchange: "1.25%" },
    { symbol: "AAPL", name: "Apple Inc. Common Stock", marketCap: "3,000,000,000,000", lastsale: "$200.00", pctchange: "0.1%" },
    { symbol: "KLAR", name: "Klarna Group plc Ordinary Shares", marketCap: "", lastsale: "$40.00", pctchange: "--" }
  ];
  assert.deepEqual(F.capsFromScreener(rows, ["V", "KLAR", "MA"]), {
    V: { name: "Visa Inc.", cap: 650e9, price: 340.1, d1: 1.25 },
    KLAR: { name: "Klarna Group plc", cap: null, price: 40, d1: null }
  });
});

test("alignHistory: SPY's days, late listings padded with nulls, five significant digits", () => {
  const cal = [20260105, 20260106, 20260107, 20260108].map((d, i) => bar(d, 400 + i));
  const h = F.alignHistory({ SPY: cal, NEW: [bar(20260107, 12.3456789), bar(20260108, 13)], GONE: [bar(20251201, 5)], ODD: [bar(20260106, 7), bar(20260110, 8)] },
    cal, 20260106, 20260108);
  assert.deepEqual(h.dates, [20260106, 20260107, 20260108]);
  assert.deepEqual(h.closes.SPY, [401, 402, 403]);
  assert.deepEqual(h.closes.NEW, [null, 12.346, 13]);
  assert.deepEqual(h.closes.ODD, [7, null, null]); // a day off SPY's calendar is dropped
  assert.equal(h.closes.GONE, undefined);
});

test("mergeRecent: today appended, recent days overwritten, the oldest day dropped", () => {
  const store = { dates: [20260105, 20260106, 20260107], closes: { SPY: [400, 401, 402], A: [10, 11, null] } };
  const spy = [bar(20260106, 401), bar(20260107, 402.5), bar(20260108, 404)];
  const m = F.mergeRecent(store, { SPY: spy, A: [bar(20260107, 11.5), bar(20260108, 12)], NEW: [bar(20260108, 1)] }, spy, 20260106, 20260108);
  assert.deepEqual(m.dates, [20260106, 20260107, 20260108]);
  assert.deepEqual(m.closes.SPY, [401, 402.5, 404]);
  assert.deepEqual(m.closes.A, [11, 11.5, 12]);
  assert.equal(m.closes.NEW, undefined);
  assert.deepEqual(store.closes.A, [10, 11, null]); // the old store is untouched
});

test("snapshot: caps scaled by the latest close, missing symbols listed, ISO dates", () => {
  const C = {
    dates: [20260107, 20260108],
    closes: { SPY: [400, 404], FINX: [30, 30.3], V: [330, 346.5], KLAR: [40, null] },
    caps: { V: { name: "Visa Inc.", cap: 660e9, price: 330, d1: 0.5 }, KLAR: { name: "Klarna Group plc", cap: 16e9, price: 40, d1: -2 }, MA: { name: "Mastercard", cap: 500e9, price: 550, d1: 1 } },
    fetchedAt: 123
  };
  const s = F.snapshot(C, { loading: true, progress: 0.5 });
  assert.deepEqual(s.dates, ["2026-01-07", "2026-01-08"]);
  assert.deepEqual(s.benchmarks.map((b) => b.sym), ["SPY", "FINX"]);
  const v = s.companies.find((c) => c.sym === "V");
  assert.deepEqual(v, { sym: "V", sub: "pay", name: "Visa Inc.", cap: 693e9, price: 346.5, d1: 5 });
  // no close on the last day: Nasdaq's day change and cap stand
  const k = s.companies.find((c) => c.sym === "KLAR");
  assert.deepEqual([k.cap, k.price, k.d1], [16e9, 40, -2]);
  // MA has a cap but no prices: listed as a company, and as missing prices
  assert.ok(s.companies.some((c) => c.sym === "MA"));
  assert.ok(s.missing.includes("MA") && s.missing.includes("PYPL"));
  assert.ok(!s.companies.some((c) => c.sym === "PYPL"));
  assert.deepEqual(Object.keys(s.closes).sort(), ["FINX", "KLAR", "SPY", "V"]);
  assert.deepEqual(s.subsectors, U.SUBSECTORS);
  assert.equal(s.loading, true); assert.equal(s.progress, 0.5); assert.equal(s.error, null); assert.equal(s.fetchedAt, 123);
});

test("keepFrom: three years and two weeks back", () => {
  assert.equal(F.keepFrom(20261120), 20231106);
  assert.equal(F.isoOf(20260105), "2026-01-05");
  assert.equal(F.sig(123.456789), 123.46);
  assert.equal(F.sig(0), null);
});
