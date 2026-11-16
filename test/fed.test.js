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

// ---------- the fan: how the expected path has moved ----------
const MTGS = [["2026-09-15", "2026-09-16"], ["2026-10-27", "2026-10-28"], ["2026-12-08", "2026-12-09"], ["2027-01-26", "2027-01-27"], ["2027-03-16", "2027-03-17"]].map(([start, date]) => ({ start, date }));
const weekdays = (from, to) => { const out = []; for (let t = Date.parse(from); t <= Date.parse(to); t += 864e5) { const d = new Date(t); if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); } return out; };
// Each contract's implied rate drifts down by 1bp a trading day per month out (more cuts priced over time), from `from`.
function synth(from, to, months, late = {}) {
  const futures = {};
  months.forEach((k, i) => {
    const days = weekdays(late[k] || from, to);
    futures[k] = { sym: k, closes: days.map((d, j) => [d, 100 - (4.0 - 0.05 * i - 0.0001 * (i + 1) * (j + (weekdays(from, to).length - days.length)))]) };
    futures[k].price = futures[k].closes[futures[k].closes.length - 1][1];
  });
  return futures;
}
const MONTHS = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"];
const DFF = [["2026-07-01", 4.0]];

test("fan: today's path, the path 1W / 1M / 3M ago and nested min–max ranges from every stored day", () => {
  const fut = synth("2026-07-20", "2026-11-13", MONTHS);
  const f = fed.pathFan(fut, {}, MTGS, DFF, "2026-11-13");
  assert.deepStrictEqual(f.rows.map((r) => r.date), ["2026-12-09", "2027-01-27", "2027-03-17"]);
  assert.deepStrictEqual(f.windows.map((w) => [w.key, w.full, w.from]), [["w1", true, "2026-11-06"], ["m1", true, "2026-10-14"], ["m3", true, "2026-08-14"]]);
  const now = fed.pathAt(fut, {}, MTGS, DFF, "2026-11-13"), m1 = fed.pathAt(fut, {}, MTGS, DFF, "2026-10-14");
  for (const [i, r] of f.rows.entries()) {
    near(r.now, now.rows[i].post);
    near(r.ago.m1, m1.rows.find((x) => x.date === r.date).post);
    for (const k of ["w1", "m1", "m3"]) { const g = r.range[k]; assert.ok(g.lo <= r.now + 1e-9 && g.hi >= r.now - 1e-9 && g.lo <= r.ago[k] + 1e-9 && g.hi >= r.ago[k] - 1e-9, k); }
    assert.ok(r.range.m3.lo <= r.range.m1.lo && r.range.m1.lo <= r.range.w1.lo && r.range.m3.hi >= r.range.m1.hi && r.range.m1.hi >= r.range.w1.hi);
    assert.ok(r.now < r.ago.m3, "rates drifted down"); // more cuts priced in over the three months
  }
  // ranges come from every day, not just the endpoints: the 3-month range counts ~65 trading days
  const w3 = f.windows[2];
  assert.ok(w3.obs >= 60 && w3.obs <= 70, String(w3.obs)); assert.strictEqual(f.rows[0].range.m3.n, w3.obs + 1);
  near(f.windows[0].start.lo, 4.0); near(f.start, 4.0);
});

test("fan: history shorter than a window uses what exists and says how far it reaches", () => {
  const fut = synth("2026-10-30", "2026-11-13", MONTHS.slice(2));
  const f = fed.pathFan(fut, {}, MTGS, DFF, "2026-11-13");
  const [w1, m1, m3] = f.windows;
  assert.strictEqual(w1.full, true); assert.strictEqual(m1.full, false); assert.strictEqual(m3.full, false);
  assert.strictEqual(m1.since, "2026-10-30"); assert.strictEqual(m1.span, 14); assert.strictEqual(m1.obs, m3.obs);
  for (const r of f.rows) { assert.strictEqual(r.ago.m1, null); assert.strictEqual(r.ago.m3, null); assert.ok(r.ago.w1 != null); assert.ok(r.range.m3.n > 1); }
});

test("fan: a meeting with no contract yet on an old date is null then, not guessed", () => {
  // the March and April 2027 contracts only start trading on Oct 20
  const fut = synth("2026-07-20", "2026-11-13", MONTHS, { "2027-03": "2026-10-20", "2027-04": "2026-10-20" });
  const f = fed.pathFan(fut, {}, MTGS, DFF, "2026-11-13");
  const mar = f.rows.find((r) => r.date === "2027-03-17"), dec = f.rows.find((r) => r.date === "2026-12-09");
  assert.strictEqual(mar.ago.m1, null); assert.strictEqual(mar.ago.m3, null); assert.ok(mar.ago.w1 != null);
  assert.ok(dec.ago.m3 != null);
  assert.ok(mar.range.m3.n < dec.range.m3.n);
  // no stored prices at all → nothing
  assert.strictEqual(fed.pathFan({}, {}, MTGS, DFF, "2026-11-13"), null);
});

test("fan: daily snapshots fill days the futures closes don't cover", () => {
  const fut = synth("2026-11-02", "2026-11-13", MONTHS.slice(2));
  const hist = { "2026-10-01": { rates: { "2026-10": 3.95, "2026-11": 3.9, "2026-12": 3.8, "2027-01": 3.7, "2027-02": 3.6, "2027-03": 3.5, "2027-04": 3.4 } } };
  const f = fed.pathFan(fut, hist, MTGS, DFF, "2026-11-13");
  assert.strictEqual(f.windows[1].full, true); assert.ok(f.rows[0].ago.m1 != null);
  assert.strictEqual(f.windows[2].full, false); assert.strictEqual(f.windows[2].since, "2026-10-01");
});

test("expired contracts keep their recent closes in the cache", () => {
  const prev = { futures: { "2026-10": { sym: "ZQV26.CBT", closes: [["2026-06-01", 96], ["2026-10-30", 96.1]] }, "2026-11": { sym: "ZQX26.CBT", closes: [["2026-11-12", 96.1]] } },
    expired: { "2026-05": { sym: "ZQK26.CBT", closes: [["2026-05-29", 95.7]] } } };
  const e = fed.keepExpired(prev, "2026-11-13");
  assert.deepStrictEqual(Object.keys(e), ["2026-10"]); assert.deepStrictEqual(e["2026-10"].closes, [["2026-10-30", 96.1]]);
});

test("build adds the fan to the snapshot", () => {
  const fut = synth("2026-07-20", "2026-11-13", MONTHS.slice(2));
  const cache = { at: 1, futures: fut, expired: synth("2026-07-20", "2026-10-30", MONTHS.slice(0, 2)), fred: { DFF }, errors: {} };
  const p = fed.build(cache, { items: MTGS, live: true }, {}, Date.parse("2026-11-13T15:00:00Z"));
  assert.strictEqual(p.fan.rows.length, p.path.rows.length); assert.strictEqual(p.fan.windows[2].full, true);
  assert.ok(p.fan.rows[0].ago.m3 != null); // the 3-month-ago path needed the expired Sep/Oct contracts
  near(p.fan.rows[0].ago.m1, p.m1.rows.find((r) => r.date === p.fan.rows[0].date).post);
});
