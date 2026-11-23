const test = require("node:test");
const assert = require("node:assert");
const S = require("../renderer/fintechstats");
const U = require("../src/fintech-universe");

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// ---------- dates ----------
// a holiday (Jan 1) and weekends in the calendar
const CAL = ["2025-12-30", "2025-12-31", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12"];

test("startIndex: each period from the last date", () => {
  assert.equal(S.startIndex(CAL, "1D"), 7);        // the trading day before
  assert.equal(S.startIndex(CAL, "1W"), 3);        // 2026-01-05, exactly a week back
  assert.equal(S.startIndex(CAL, "YTD"), 1);       // last close of the old year
  assert.equal(S.startIndex(CAL, "1M"), 0);        // history too short: the first date
  assert.equal(S.startIndex(CAL, "3Y"), 0);
  assert.equal(S.startIndex([], "1M"), -1);
});

test("startIndex: a weekend or holiday start falls back to the close before it", () => {
  // as of Sunday the 11th: 1D is the day before Friday; 1W starts Sunday the 4th → Friday the 2nd
  assert.equal(S.startIndex(CAL, "1D", "2026-01-11"), 6);
  assert.equal(S.startIndex(CAL, "1W", "2026-01-11"), 2);
  // a week before the 8th is the 1st, a holiday → Dec 31
  assert.equal(S.startIndex(CAL, "1W", "2026-01-08"), 1);
});

test("periodStart: month steps clamp to the month's end", () => {
  assert.equal(S.periodStart("2026-05-31", "3M"), "2026-02-28");
  assert.equal(S.periodStart("2024-05-31", "3M"), "2024-02-29");
  assert.equal(S.periodStart("2024-02-29", "1Y"), "2023-02-28");
  assert.equal(S.periodStart("2026-11-20", "3Y"), "2023-11-20");
  assert.equal(S.periodStart("2026-03-15", "YTD"), "2025-12-31");
  assert.equal(S.periodStart("2026-01-05", "1W"), "2025-12-29");
});

test("ret: null when a close is missing", () => {
  assert.equal(S.ret([100, 110], 0, 1).toFixed(6), "10.000000");
  assert.equal(S.ret([null, 110], 0, 1), null);
  assert.equal(S.ret([100, 0], 0, 1), null);
  assert.equal(S.ret(undefined, 0, 1), null);
});

// ---------- indexes ----------
// A trades all along; B lists on day 2 (no look-ahead: it joins with its first move, day 3); C misses day 1.
const D5 = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
const SNAP = {
  subsectors: [{ id: "pay", name: "Payments" }, { id: "lend", name: "Lending" }],
  companies: [
    { sym: "A", sub: "pay", name: "Alpha", cap: 300 },
    { sym: "B", sub: "lend", name: "Beta", cap: 100 },
    { sym: "C", sub: "pay", name: "Gamma", cap: 600 }
  ],
  benchmarks: [{ sym: "SPY", name: "S&P 500" }],
  dates: D5,
  closes: {
    A: [100, 110, 110, 121, 121],
    B: [null, null, 50, 50, 100],
    C: [10, null, 12, 12, 12],
    SPY: [400, 404, null, 408, 420]
  }
};

test("indexSeries: equal weight chains the average daily move; a late listing joins on its first move", () => {
  const s = S.indexSeries({ ...SNAP, companies: SNAP.companies.slice(0, 2) }, "3Y", { weight: "equal" });
  assert.deepEqual(s.dates, D5);
  assert.equal(s.values[0], 100);
  close(s.values[1], 110);              // A +10%
  close(s.values[2], 110);              // A flat, B has no day before
  close(s.values[3], 110 * 1.05);       // (A +10% + B 0%) / 2
  close(s.values[4], 110 * 1.05 * 1.5); // (A 0% + B +100%) / 2
});

test("indexSeries: no look-ahead, the days before a listing match the index without it", () => {
  const both = S.indexSeries({ ...SNAP, companies: SNAP.companies.slice(0, 2) }, "3Y", { weight: "cap" });
  const onlyA = S.indexSeries({ ...SNAP, companies: SNAP.companies.slice(0, 1) }, "3Y", { weight: "cap" });
  assert.deepEqual(both.values.slice(0, 3), onlyA.values.slice(0, 3));
  assert.notEqual(both.values[4], onlyA.values[4]);
});

test("indexSeries: cap weights are today's value scaled back by price", () => {
  const s = S.indexSeries({ ...SNAP, companies: SNAP.companies.slice(0, 2) }, "3Y");
  // shares: A 300/121, B 100/100. Day 3: A 110→121 with weight sA·110, B flat with weight 1·50
  const sA = 300 / 121, w3 = sA * 110, d3 = (w3 * 0.1) / (w3 + 50);
  const w4 = sA * 121, d4 = (50 * 1) / (w4 + 50);
  close(s.values[3], 110 * (1 + d3));
  close(s.values[4], 110 * (1 + d3) * (1 + d4));
});

test("indexSeries: a period start inside the data rebases to 100 there", () => {
  const s = S.indexSeries(SNAP, "1D", { weight: "equal", sub: "lend" });
  assert.deepEqual(s.dates, D5.slice(3));
  assert.deepEqual(s.values, [100, 200]);
});

test("indexSeries: a missing close is bridged from the day before it", () => {
  const s = S.indexSeries({ ...SNAP, companies: [SNAP.companies[2]] }, "3Y", { weight: "equal" });
  assert.deepEqual(s.values.map((v) => +v.toFixed(6)), [100, 100, 120, 120, 120]);
});

test("benchSeries: rebased closes with gaps left empty", () => {
  const b = S.benchSeries(SNAP, "SPY", "3Y");
  assert.deepEqual(b.values, [100, 101, null, 102, 105]);
  assert.equal(S.benchSeries(SNAP, "NOPE", "3Y"), null);
});

test("companyReturns: a company without a close at the start has no return for that period", () => {
  const R = S.companyReturns(SNAP);
  close(R.get("A")["3Y"], 21);
  assert.equal(R.get("B")["3Y"], null);
  close(R.get("B")["1D"], 100);
  close(R.get("SPY")["1D"], (420 / 408 - 1) * 100);
});

test("subStats: shares add to 100%, cap-weighted return matches the index, best and worst", () => {
  const st = S.subStats(SNAP, "1W");
  assert.deepEqual(st.map((s) => s.id), ["pay", "lend"]);
  close(st.reduce((a, s) => a + s.share, 0), 100, 1e-9);
  const pay = st[0];
  assert.equal(pay.n, 2); assert.equal(pay.cap, 900);
  close(pay.share, 90);
  close(pay.ret, S.seriesReturn(S.indexSeries(SNAP, "1W", { sub: "pay" })));
  assert.equal(pay.best.sym, "A"); close(pay.best.ret, 21);
  assert.equal(pay.worst.sym, "C"); close(pay.worst.ret, 20);
  close(pay.eqRet, 20.5);
});

test("subStats: cap-weighted and equal-weighted differ when sizes differ", () => {
  const st = S.subStats(SNAP, "3Y");
  const cap = S.seriesReturn(S.indexSeries(SNAP, "3Y", { sub: "pay" })), eq = S.seriesReturn(S.indexSeries(SNAP, "3Y", { sub: "pay", weight: "equal" }));
  close(st[0].ret, cap);
  assert.notEqual(+cap.toFixed(6), +eq.toFixed(6));
});

test("leaders: only risers up and fallers down", () => {
  const snap = { ...SNAP, closes: { ...SNAP.closes, C: [10, 10, 10, 10, 8] } };
  const L = S.leaders(snap, "3Y", 5);
  assert.deepEqual(L.up.map((x) => x.sym), ["A"]);
  assert.deepEqual(L.down.map((x) => x.sym), ["C"]);
  assert.equal(L.up[0].name, "Alpha"); assert.equal(L.up[0].sub, "pay");
});

// ---------- M&A ----------
const co = (name, ...tickers) => ({ name, tickers });
const deal = (o) => ({ target: co("Target Co", "TGT"), acquirers: [co("Buyer Corp", "BUY")], sic: "2834", industry: "Pharmaceutical Preparations", type: "Merger", date: "2026-10-01", value: 1e9, ...o });

test("FINTECH_RE: fintech names in, plain companies out", () => {
  for (const n of ["FinTech Acquisition Corp V", "Payoneer Global", "Global Payments Inc", "Repay Holdings", "LendingTree", "Digital Bank Corp", "Insurtech Holdings", "Bitcoin Depot", "Blockchain Coinvestors", "Robo-Advisor Partners", "money transfer group"])
    assert.ok(S.FINTECH_RE.test(n), n);
  for (const n of ["Acme Software Inc", "First Community Bank", "Heartland Insurance Group", "Regional Health Properties", "Services-Prepackaged Software", "National Commercial Banks", "Fire, Marine & Casualty Insurance"])
    assert.ok(!S.FINTECH_RE.test(n), n);
});

test("fintechDeal: universe target and buyer", () => {
  assert.deepEqual(S.fintechDeal(deal({ target: co("PayPal Holdings", "PYPL") })), { sub: "pay", why: "target in universe" });
  assert.deepEqual(S.fintechDeal(deal({ target: co("Some Data Co", "SDC"), acquirers: [co("Merger Sub"), co("Coinbase Global", "COIN")] })), { sub: "cryp", why: "buyer in universe" });
  // a universe passed in (the snapshot's companies) replaces the full list; tickers match case and class-insensitively
  assert.deepEqual(S.fintechDeal(deal({ target: co("X", "abc.b") }), [{ sym: "ABC-B", sub: "soft" }]), { sub: "soft", why: "target in universe" });
  assert.equal(S.fintechDeal(deal({ target: co("PayPal Holdings", "PYPL") }), [{ sym: "V", sub: "pay" }]), null);
});

test("fintechDeal: SIC codes that are fintech on their own", () => {
  const want = { 6099: "pay", 6141: "lend", 6153: "lend", 6159: "lend", 6162: "lend", 6163: "lend", 6211: "brok", 6282: "brok", 6200: "infra", 6231: "infra" };
  for (const [sic, sub] of Object.entries(want)) assert.deepEqual(S.fintechDeal(deal({ sic, target: co("Plain Name Inc", "PNI") })), { sub, why: `SIC ${sic}` });
  assert.equal(S.fintechDeal(deal({ target: co("Plain Pharma", "PP") })), null);
});

test("fintechDeal: software, insurance and bank codes count only with a fintech name", () => {
  const gated = { 7374: "pay", 7371: "soft", 7372: "soft", 7373: "soft", 6331: "ins", 6411: "ins", 6021: "bank", 6022: "bank", 6035: "bank", 6036: "bank" };
  for (const [sic, sub] of Object.entries(gated)) {
    assert.equal(S.fintechDeal(deal({ sic, target: co("Heartland Holdings", "HH"), industry: "National Commercial Banks" })), null, `plain ${sic}`);
    assert.deepEqual(S.fintechDeal(deal({ sic, target: co("PayGrid Holdings", "PG") })), { sub, why: `SIC ${sic} + fintech name` });
  }
  assert.equal(S.fintechDeal(deal({ sic: "7372", target: co("Acme Software", "ACM"), industry: "Services-Prepackaged Software" })), null);
  assert.deepEqual(S.fintechDeal(deal({ sic: "6022", target: co("Digital Bank Corp", "DBC") })).sub, "bank");
});

test("fintechDeal: a crypto name counts under any code", () => {
  assert.deepEqual(S.fintechDeal(deal({ sic: "6099", target: co("Bitcoin Depot", "BTM") })), { sub: "cryp", why: "crypto name" });
  assert.deepEqual(S.fintechDeal(deal({ sic: "3990", target: co("Digital Asset Miners Inc", "DAM") })), { sub: "cryp", why: "crypto name" });
});

test("fintechDeal: SPAC mergers left out unless the SPAC has a fintech name", () => {
  assert.equal(S.fintechDeal(deal({ type: "SPAC merger", sic: "6770", target: co("Alpha Acquisition Corp", "ALPA") })), null);
  // even when its SIC would count, or a universe buyer is named
  assert.equal(S.fintechDeal(deal({ type: "SPAC merger", sic: "6199", target: co("Alpha Acquisition Corp", "ALPA"), acquirers: [co("Visa", "V")] })), null);
  assert.deepEqual(S.fintechDeal(deal({ type: "SPAC merger", sic: "6770", target: co("FinTech Acquisition Corp V", "FTV") })), { sub: "soft", why: "fintech SPAC" });
  assert.deepEqual(S.fintechDeal(deal({ type: "SPAC merger", sic: "6770", target: co("Payments Partners Acquisition", "PPA") })), { sub: "pay", why: "fintech SPAC" });
  assert.deepEqual(S.fintechDeal(deal({ type: "SPAC merger", sic: "6770", target: co("Bitcoin Growth Acquisition", "BGA") })).sub, "cryp");
});

test("dealStats: quarter buckets, sub-sector totals, disclosed and largest", () => {
  const NOW = Date.parse("2026-11-13T12:00:00Z");
  const ds = [
    { sub: "pay", date: "2026-11-01", value: 2e9 },
    { sub: "pay", date: "2026-10-01", value: null },
    { sub: "lend", date: "2026-09-30", value: 5e8 },
    { sub: "cryp", date: "2024-01-15", value: 7e9 },
    { sub: "bank", date: "2023-09-30", value: 1e8 } // before the 12 quarters
  ];
  const st = S.dealStats(ds, NOW);
  assert.equal(st.byQuarter.length, 12);
  assert.equal(st.byQuarter[0].q, "2024Q1");
  assert.equal(st.byQuarter[11].q, "2026Q4");
  assert.deepEqual(st.byQuarter[11], { q: "2026Q4", n: 2, value: 2e9, bySub: { pay: 2 } });
  assert.deepEqual(st.byQuarter[10], { q: "2026Q3", n: 1, value: 5e8, bySub: { lend: 1 } });
  assert.equal(st.byQuarter[0].bySub.cryp, 1);
  assert.equal(st.byQuarter.reduce((a, q) => a + q.n, 0), 4);
  assert.deepEqual(st.bySub.map((s) => s.id), U.SUBSECTORS.map((s) => s.id));
  assert.deepEqual(st.bySub.find((s) => s.id === "pay"), { id: "pay", n: 2, value: 2e9 });
  assert.equal(st.total, 5); assert.equal(st.disclosed, 4);
  assert.equal(st.largest.value, 7e9);
  assert.equal(S.quarterKey("2025-07-01"), "2025Q3");
});

// ---------- news ----------
const NOW = Date.parse("2026-11-20T15:00:00Z");
let id = 0;
const story = (title, hoursAgo = 1, summary = "") => ({ id: "s" + ++id, title, summary, link: "https://x/" + id, ts: NOW - hoursAgo * 3600e3, updated: NOW - hoursAgo * 3600e3, assets: [], sources: [] });
const NEWS = [
  story("Visa and Mastercard settle swipe fee lawsuit with merchants"),
  story("Fed holds rates steady as inflation cools"),
  story("Coinbase shares jump as bitcoin rallies", 30),
  story("Senate passes GENIUS Act to regulate stablecoins", 50),
  story("Apple unveils new AI features for iPhone"),
  story("Fintech startup raises $50 million in funding round", 2),
  story("H-1B Visa Fees Rise For Tech Workers"),
  story("Shares of $HOOD rise after record trading volumes"),
  story("Affirm shares surge as buy now, pay later demand grows", 200),
  story("Officials affirm commitment to the alliance"),
  story("Nasdaq hits a record as tech rallies")
];

test("newsFilter: keeps fintech stories, tags tickers and themes", () => {
  const got = S.newsFilter(NEWS);
  const by = Object.fromEntries(got.map((s) => [s.title.slice(0, 12), s]));
  assert.deepEqual(got.map((s) => s.id), ["s1", "s3", "s4", "s6", "s8", "s9"]);
  assert.deepEqual(by["Visa and Mas"].tickers.sort(), ["MA", "V"]);
  assert.ok(by["Visa and Mas"].themes.includes("pay"));
  assert.deepEqual(by["Coinbase sha"].tickers, ["COIN"]);
  assert.deepEqual(by["Coinbase sha"].themes, ["crypto"]);
  assert.deepEqual(by["Senate passe"].tickers, []);
  assert.deepEqual(by["Senate passe"].themes.sort(), ["reg", "stable"]);
  assert.deepEqual(by["Fintech star"].themes, ["deals"]);
  assert.deepEqual(by["Shares of $H"].tickers, ["HOOD"]);
  assert.deepEqual(by["Affirm share"].tickers, ["AFRM"]);
  assert.deepEqual(by["Affirm share"].themes, ["bnpl"]);
  // the original story objects are left alone
  assert.equal(NEWS[0].tickers, undefined);
});

test("newsFilter: tickers in parentheses and a narrower universe", () => {
  const got = S.newsFilter([story("Payments firm (NASDAQ: TOST) beats estimates"), story("Coinbase and Robinhood fall")], [{ sym: "TOST", sub: "pay" }, { sym: "HOOD", sub: "brok" }]);
  assert.deepEqual(got[0].tickers, ["TOST"]);
  assert.deepEqual(got[1].tickers, ["HOOD"]); // Coinbase is off this list; the story stays because Robinhood is named
});

test("themeCounts: 24 hours and 7 days", () => {
  const rows = S.themeCounts(S.newsFilter(NEWS), NOW);
  assert.deepEqual(rows.map((r) => r.id), S.THEMES.map((t) => t.id));
  const r = Object.fromEntries(rows.map((x) => [x.id, x]));
  assert.deepEqual([r.crypto.n24h, r.crypto.n7d], [0, 1]);
  assert.deepEqual([r.stable.n24h, r.stable.n7d], [0, 1]);
  assert.deepEqual([r.pay.n24h, r.pay.n7d], [1, 1]);
  assert.deepEqual([r.bnpl.n24h, r.bnpl.n7d], [0, 0]); // 200 hours old
  assert.deepEqual([r.deals.n24h, r.deals.n7d], [1, 1]);
});
