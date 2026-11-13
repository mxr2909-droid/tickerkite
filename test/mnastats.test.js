const test = require("node:test");
const assert = require("node:assert");
const S = require("../renderer/mnastats");

const NOW = Date.parse("2026-11-13T12:00:00Z");
const co = (name, ...tickers) => ({ name, tickers });
let n = 0;
const deal = (o) => ({ id: "d" + ++n, target: co("Target " + n, "T" + n), acquirers: [co("Buyer Corp", "BUY")], sector: "Technology", industry: "Software", type: "Merger",
  stage: "announced", date: "2026-10-01", lastDate: "2026-10-01", active: true, value: 5e8, price: null, state: null, filings: [], ...o });
const D = [
  deal({ target: co("Acme Software", "ACME"), date: "2026-11-01", value: 5e7 }),                                        // under $100M
  deal({ target: co("Bolt Pharma", "BOLT"), sector: "Health Care", industry: "Biotech", date: "2026-10-15", value: 2e9, type: "Tender offer" }),
  deal({ target: co("Cobalt Energy", "COBT"), sector: "Energy", industry: "Oil", date: "2026-08-10", value: 2e10, active: false, type: "Going private" }),
  deal({ target: co("Delta Shell", "DLTA"), date: "2026-09-20", value: null, type: "SPAC merger" }),                    // hidden by default
  deal({ target: co("Echo Data", "ECHO"), date: "2025-06-20", value: 3e8, active: false }),                              // previous 1Y window
  deal({ target: co("Foxtrot Soft", "FOX"), date: "2026-02-03", value: null, acquirers: [co("Globex", "GBX")] })
];
const ids = (ds) => ds.map((d) => d.target.tickers[0]);

test("span: preset range, custom range, previous window", () => {
  const s = S.span({ range: "1Y" }, NOW);
  assert.strictEqual(s.to, "2026-11-13"); assert.strictEqual(s.from, "2025-11-13"); assert.strictEqual(s.days, 365);
  assert.strictEqual(s.prevTo, "2025-11-12"); assert.strictEqual(s.prevFrom, "2024-11-13");
  const m = S.span({ range: "3M" }, NOW);
  assert.strictEqual(m.days, 91); assert.strictEqual(m.from, "2026-08-14");
  const c = S.span({ range: "custom", from: "2026-01-01", to: "2026-01-31" }, NOW);
  assert.strictEqual(c.days, 30); assert.strictEqual(c.prevTo, "2025-12-31"); assert.strictEqual(c.prevFrom, "2025-12-02");
  assert.strictEqual(S.span({ range: "custom", from: "2026-01-01" }, NOW).to, "2026-11-13");
  assert.strictEqual(S.span({ range: "bogus" }, NOW).days, 365);
  const p = S.span({ range: "6M" }, NOW);
  assert.strictEqual((Date.parse(p.prevTo) - Date.parse(p.prevFrom)) / 864e5 + 1, p.days); // same length, ends the day before
});

test("filter: date window, SPAC hiding, sector, industry, status", () => {
  const F = S.defaults();
  assert.deepStrictEqual(ids(S.filter(D, F, NOW)).sort(), ["ACME", "BOLT", "COBT", "FOX"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, spacs: true }, NOW)).sort(), ["ACME", "BOLT", "COBT", "DLTA", "FOX"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, type: "SPAC merger" }, NOW)), ["DLTA"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, sector: "Energy" }, NOW)), ["COBT"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, industry: "Biotech" }, NOW)), ["BOLT"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, status: "past" }, NOW)), ["COBT"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, status: "active" }, NOW)).sort(), ["ACME", "BOLT", "FOX"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, type: "Tender offer" }, NOW)), ["BOLT"]);
});

test("filter: size buckets including na", () => {
  const F = S.defaults();
  const k = (size) => ids(S.filter(D, { ...F, size }, NOW)).sort();
  assert.deepStrictEqual(k("u100"), ["ACME"]);
  assert.deepStrictEqual(k("100m"), []);
  assert.deepStrictEqual(k("1b"), ["BOLT"]);
  assert.deepStrictEqual(k("10b"), ["COBT"]);
  assert.deepStrictEqual(k("na"), ["FOX"]);
  const edge = [deal({ value: 1e8 }), deal({ value: 1e9 }), deal({ value: 1e10 })];
  assert.deepStrictEqual(S.SIZES.slice(0, 4).map(([key]) => S.allTime(edge, { size: key }).length), [0, 1, 1, 1]);
});

test("filter: text search over target, buyer and ticker", () => {
  const F = S.defaults();
  assert.deepStrictEqual(ids(S.filter(D, { ...F, q: "bolt" }, NOW)), ["BOLT"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, q: "  COBT " }, NOW)), ["COBT"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, q: "globex" }, NOW)), ["FOX"]);
  assert.deepStrictEqual(ids(S.filter(D, { ...F, q: "gbx" }, NOW)), ["FOX"]);
  assert.deepStrictEqual(S.filter(D, { ...F, q: "nothing here" }, NOW), []);
  assert.strictEqual(S.filter(D, { ...F, q: "   " }, NOW).length, 4);
});

test("previous and allTime", () => {
  const F = S.defaults();
  assert.deepStrictEqual(ids(S.previous(D, F, NOW)), ["ECHO"]);
  assert.deepStrictEqual(ids(S.previous(D, { ...F, status: "active" }, NOW)), []);
  assert.strictEqual(S.allTime(D, F).length, 5);             // all but the SPAC
  assert.strictEqual(S.allTime(D, { ...F, spacs: true }).length, 6);
  assert.deepStrictEqual(ids(S.allTime(D, { ...F, sector: "Energy" })), ["COBT"]);
});

test("summary", () => {
  const F = S.defaults();
  const s = S.summary(S.filter(D, F, NOW), S.previous(D, F, NOW));
  assert.strictEqual(s.cur.n, 4); assert.strictEqual(s.cur.known, 3);
  assert.strictEqual(s.cur.value, 5e7 + 2e9 + 2e10);
  assert.strictEqual(s.cur.median, 2e9); assert.strictEqual(s.cur.big, 2); assert.strictEqual(s.cur.mega, 1);
  assert.strictEqual(s.cur.tender, 1); assert.strictEqual(s.cur.priv, 1);
  assert.strictEqual(s.prev.n, 1); assert.strictEqual(s.nChg, 300);
  assert.strictEqual(s.valueChg, ((5e7 + 2e9 + 2e10 - 3e8) / 3e8) * 100);
  assert.strictEqual(s.bigChg, 2);
  assert.strictEqual(s.topSector.name, "Technology"); assert.strictEqual(s.topSector.n, 2); assert.strictEqual(s.topSector.share, 50);
  assert.strictEqual(s.largest.target.tickers[0], "COBT");
  const e = S.summary([], []);
  assert.strictEqual(e.nChg, null); assert.strictEqual(e.topSector, null); assert.strictEqual(e.largest, null); assert.strictEqual(e.cur.median, null);
  assert.strictEqual(S.median([3, 1, 2, null]), 2); assert.strictEqual(S.median([1, 2, 3, 4]), 2.5);
});

test("monthly and trailing", () => {
  const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
  const m = S.monthly(S.allTime(D, { spacs: true }), months);
  assert.deepStrictEqual(m.map((r) => r.n), [1, 1, 1, 1]);
  assert.strictEqual(m[0].value, 2e10); assert.strictEqual(m[0].big, 1);
  assert.strictEqual(m[1].value, 0); assert.strictEqual(m[1].byType["SPAC merger"], 1);
  assert.strictEqual(m[2].byType["Tender offer"], 1);
  assert.strictEqual(S.monthly(D, []).length, 0);
  const t = S.trailing([{ n: 3 }, { n: 6 }, { n: 9 }, { n: 12 }], "n", 3);
  assert.deepStrictEqual(t, [null, null, 6, 9]);
  assert.deepStrictEqual(S.trailing([{ n: 4 }, { n: 8 }], "n", 2), [null, 6]);
});

test("sizeHist", () => {
  const h = S.sizeHist([deal({ value: 1e7 }), deal({ value: 5e7 }), deal({ value: 1e9 }), deal({ value: 3e10 }), deal({ value: null })]);
  assert.deepStrictEqual(h.map((b) => b.n), [1, 1, 0, 1, 0, 1]);
  assert.strictEqual(h[0].label, "< $50M");
});

test("quarterOf, quarterKeys, sectorQuarters", () => {
  assert.strictEqual(S.quarterOf("2026-01-01"), "2026 Q1"); assert.strictEqual(S.quarterOf("2026-03-31"), "2026 Q1");
  assert.strictEqual(S.quarterOf("2026-04-01"), "2026 Q2"); assert.strictEqual(S.quarterOf("2026-12-31"), "2026 Q4");
  assert.deepStrictEqual(S.quarterKeys(3, NOW), ["2026 Q2", "2026 Q3", "2026 Q4"]);
  assert.deepStrictEqual(S.quarterKeys(2, Date.parse("2026-02-10")), ["2025 Q4", "2026 Q1"]);
  assert.deepStrictEqual(S.quarterKeys(0, NOW), []);
  const qs = S.quarterKeys(4, NOW); // 2026 Q1..Q4
  const rows = S.sectorQuarters(S.allTime(D, { spacs: true }), qs);
  assert.deepStrictEqual(rows.map((r) => r.sector), ["Technology", "Health Care", "Energy"]);
  const tech = rows[0];
  assert.strictEqual(tech.total, 3); // ACME Q4, DLTA Q3, FOX Q1; ECHO (2025) is outside the quarters
  assert.deepStrictEqual(tech.n, [1, 0, 1, 1]);
  assert.deepStrictEqual(tech.value, [0, 0, 0, 5e7]);
  assert.deepStrictEqual(rows[1].n, [0, 0, 0, 1]); assert.deepStrictEqual(rows[2].n, [0, 0, 1, 0]);
});

test("industries", () => {
  const ds = [deal({ industry: "Oil" }), deal({ industry: "Software" }), deal({ industry: "Oil" }), deal({ industry: "Banks" })];
  assert.deepStrictEqual(S.industries(ds), [["Oil", 2], ["Banks", 1], ["Software", 1]]);
  assert.deepStrictEqual(S.industries([]), []);
});

test("money", () => {
  assert.strictEqual(S.money(6.6e9), "$6.6B"); assert.strictEqual(S.money(265e6), "$265M");
  assert.strictEqual(S.money(840e3), "$840K"); assert.strictEqual(S.money(null), "—");
  assert.strictEqual(S.money(NaN), "—"); assert.strictEqual(S.money(1.2e12), "$1.20T");
  assert.strictEqual(S.money(1.5e11), "$150B"); assert.strictEqual(S.money(2.5e8), "$250M");
  assert.strictEqual(S.money(-2e9), "$-2.0B"); assert.strictEqual(S.money(4.56e6, 2), "$4.56M");
});
