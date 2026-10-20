const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const fed = require("../src/fed");

const fx = (f) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("contract symbols use CME month codes", () => {
  const c = fed.contracts("2026-11-03", 3);
  assert.deepStrictEqual(c.map((x) => x.sym), ["ZQX26.CBT", "ZQZ26.CBT", "ZQF27.CBT"]);
  assert.deepStrictEqual(c.map((x) => x.key), ["2026-11", "2026-12", "2027-01"]);
});

test("parses a Yahoo futures chart", () => {
  const r = fed.parseChart(fx("fed-zq.json"));
  assert.ok(r.price > 90 && r.price < 100);
  assert.ok(r.closes.length > 0 && /^\d{4}-\d\d-\d\d$/.test(r.closes[0][0]));
});

test("odds split the expected move between 25bp steps", () => {
  const a = fed.odds(10);
  near(a.p25, 0.4); near(a.hold, 0.6); assert.strictEqual(a.dir, "hold");
  const b = fed.odds(-35);
  near(b.p50, 0.4); near(b.p25, 0.6); near(b.hold, 0); assert.strictEqual(b.dir, "cut");
  assert.strictEqual(fed.odds(20).dir, "hike");
});

test("day-weighting: meeting month solved for the post-meeting rate", () => {
  // Nov 2026 has 30 days; decision Nov 10 → old rate 10 days, new rate 20 days.
  // pre 4.00, post 3.75 → avg = (10·4 + 20·3.75)/30
  const avg = (10 * 4 + 20 * 3.75) / 30;
  const p = fed.impliedPath({ "2026-11": avg, "2026-12": 3.6 }, [{ start: "2026-11-09", date: "2026-11-10" }, { start: "2026-12-15", date: "2026-12-16" }], 4.0, "2026-11-01");
  near(p.rows[0].post, 3.75); near(p.rows[0].move, -25); assert.strictEqual(p.rows[0].dir, "cut");
  near(p.rows[0].p25, 1);
  // December: chained pre 3.75, 31 days, decision on the 16th; no January contract → formula
  near(p.rows[1].pre, 3.75);
  near(p.rows[1].post, (31 * 3.6 - 16 * 3.75) / 15);
  assert.strictEqual(p.extreme.kind, "trough");
  near(p.end, p.rows[1].post);
});

test("a month without a meeting after the meeting month gives the post rate directly", () => {
  const p = fed.impliedPath({ "2026-10": 3.9, "2026-11": 4.1 }, [{ start: "2026-10-27", date: "2026-10-28" }], 3.88, "2026-10-20");
  near(p.rows[0].post, 4.1); near(p.rows[0].move, 22); near(p.rows[0].cum, 22);
  assert.strictEqual(p.rows[0].dir, "hike"); near(p.rows[0].p25, 0.88);
  assert.strictEqual(p.extreme.kind, "peak");
});

test("past meetings are dropped and missing futures stop the path", () => {
  const p = fed.impliedPath({ "2026-10": 3.9 }, [{ start: "2026-09-15", date: "2026-09-16" }, { start: "2026-10-27", date: "2026-10-28" }, { start: "2027-03-16", date: "2027-03-17" }], 3.88, "2026-10-01");
  assert.deepStrictEqual(p.rows.map((r) => r.date), ["2026-10-28"]);
  assert.strictEqual(fed.impliedPath({}, [], null, "2026-10-01"), null);
});

test("rates as of a past date come from closes, then snapshots", () => {
  const fut = { "2026-11": { closes: [["2026-10-10", 96.0], ["2026-10-15", 95.9]] } };
  const hist = { "2026-10-09": { rates: { "2026-11": 9, "2026-12": 3.7 } } };
  const r = fed.ratesOn(fut, hist, "2026-10-12");
  near(r["2026-11"], 4.0); near(r["2026-12"], 3.7);
});

test("parses the SEP median fed funds row", () => {
  const s = fed.parseSep(fx("fed-sep.html"));
  assert.deepStrictEqual(s.years, ["2026", "2027", "2028", "2029", "Longer run"]);
  assert.deepStrictEqual(s.median, [4.1, 4.1, 3.9, 3.6, 3.2]);
  assert.match(s.prior.label, /projection/);
  assert.strictEqual(s.prior.median[3], null);
  assert.deepStrictEqual(fed.latestSepLink('<a href="/x/fomcprojtabl20260617.htm"></a><a href="/x/fomcprojtabl20260916.htm">'), { url: "https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm", asOf: "2026-09-16" });
});

test("market vs dots uses the last meeting of each year", () => {
  const path = { rows: [{ date: "2026-10-28", post: 3.9 }, { date: "2026-12-09", post: 4.0 }] };
  const d = fed.marketVsDots(path, fed.SEP_FALLBACK);
  near(d[0].market, 4.0); near(d[0].gap, -10);
  assert.strictEqual(d[1].market, null);
});

test("parses the Treasury par yield curve CSV and picks comparison dates", () => {
  const rows = fed.parseTreasury(fx("fed-treasury.csv"));
  assert.strictEqual(rows[0].date, "2026-10-19");
  near(rows[0].y["1M"], 4.11); near(rows[0].y["30Y"], 5.48);
  assert.strictEqual(rows[0].y["1.5M"], undefined);
  const c = fed.curves([...rows, { date: "2026-09-15", y: { "1M": 4.3 } }, { date: "2025-10-10", y: { "1M": 4.0 } }]);
  assert.strictEqual(c.m1.date, "2026-09-15"); assert.strictEqual(c.y1.date, "2025-10-10");
});

test("money-market strip change over a month in bp", () => {
  const r = fed.stripRow([["2026-09-10", 4.13], ["2026-09-19", 4.1], ["2026-10-19", 3.88]], "DFF", "EFFR");
  near(r.v, 3.88); near(r.chg, -22);
});

test("no futures → no path, never invented numbers", () => {
  const p = fed.build({ at: 1, futures: {}, fred: {}, errors: { futures: "down" } }, { items: [], live: false }, {});
  assert.strictEqual(p.path, null); assert.strictEqual(p.dots.length, 5);
});
