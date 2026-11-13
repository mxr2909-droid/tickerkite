const test = require("node:test");
const assert = require("node:assert");
const { summarize, chartBars, annualize, PERIODS, barsFromChart, usMarketOpen, symbols } = require("../src/markets");

// one weekday bar per day from `from` to `to` (UTC), close = f(date)
function bars(from, to, f) {
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) out.push({ t, close: f(new Date(t)), high: f(new Date(t)) });
  }
  return out;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("computes every period from daily bars", () => {
  // close = 100 + day index since 2025-10-01; easy to recompute by hand
  const base = Date.parse("2025-10-01");
  const b = bars("2025-10-01", "2026-10-15", (d) => 100 + (d - base) / 86400000);
  const s = summarize(b);
  const at = (iso) => 100 + (Date.parse(iso) - base) / 86400000;
  const last = at("2026-10-15"); // a Thursday
  near(s.last, last);
  near(s.ret["1D"], (last / at("2026-10-14") - 1) * 100);
  near(s.ret["1W"], (last / at("2026-10-08") - 1) * 100);
  near(s.ret["1M"], (last / at("2026-09-15") - 1) * 100);
  near(s.ret["3M"], (last / at("2026-07-15") - 1) * 100);
  near(s.ret.YTD, (last / at("2025-12-31") - 1) * 100);
  near(s.fromHigh, 0); // rising series: at its high
});

test("falls back to the prior trading day over weekends and month ends", () => {
  const b = bars("2025-01-01", "2026-05-31", (d) => d.getUTCDate()); // close = day of month
  const s = summarize(b);
  // last bar Fri 2026-05-29 (31st is Sunday); 1W -> Fri 05-22; 1M -> 04-29 (Wed); 3M -> 02-27 (Fri, Feb 29 doesn't exist)
  near(s.last, 29);
  near(s.ret["1W"], (29 / 22 - 1) * 100);
  near(s.ret["1M"], 0);
  near(s.ret["3M"], (29 / 27 - 1) * 100);
  near(s.ret.YTD, (29 / 31 - 1) * 100); // 2025-12-31 was a Wednesday
});

test("52-week high and distance from it", () => {
  const b = bars("2025-10-01", "2026-10-15", (d) => (d.toISOString().startsWith("2026-03-02") ? 200 : 100));
  const s = summarize(b);
  near(s.high52, 200);
  near(s.fromHigh, -50);
});

test("missing history gives null returns, not NaN", () => {
  const s = summarize(bars("2026-10-01", "2026-10-15", () => 50));
  assert.equal(s.ret["3M"], null);
  assert.equal(s.ret.YTD, null);
  near(s.ret["1D"], 0);
  assert.equal(summarize([{ t: 0, close: 1, high: 1 }]), null);
});

test("parses Yahoo chart JSON, drops null bars, uses the live price", () => {
  const json = { chart: { result: [{ meta: { gmtoffset: 3600, regularMarketPrice: 12, currency: "EUR" }, timestamp: [1760000000, 1760086400, 1760172800],
    indicators: { quote: [{ close: [10, null, 11], high: [10.5, null, 11.5] }] } }] } };
  const p = barsFromChart(json);
  assert.equal(p.bars.length, 2);
  assert.equal(p.bars[0].t, 1760000000 * 1000 + 3600000);
  assert.equal(p.bars[1].close, 12);
  assert.equal(p.currency, "EUR");
  assert.equal(barsFromChart({ chart: { result: null } }), null);
});

test("US market hours in New York time", () => {
  assert.equal(usMarketOpen(new Date("2026-10-15T14:00:00Z")), true);   // Thu 10:00 EDT
  assert.equal(usMarketOpen(new Date("2026-10-15T13:00:00Z")), false);  // 09:00 EDT
  assert.equal(usMarketOpen(new Date("2026-10-15T20:30:00Z")), false);  // 16:30 EDT
  assert.equal(usMarketOpen(new Date("2026-10-17T15:00:00Z")), false);  // Saturday
});

test("symbol list covers all three sections without duplicates", () => {
  const s = symbols();
  assert.equal(new Set(s).size, s.length);
  for (const x of ["XLK", "XLRE", "^GSPC", "^BSESN", "EEM", "IWF", "RSP", "SPY", "TLT", "BTC-USD", "IWM"]) assert.ok(s.includes(x), x);
});

// weekly bars (Mondays) from `from` to `to`, close = f(date)
function weekly(from, to, f) {
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 7 * 86400000) out.push({ t, close: f(new Date(t)) });
  return out;
}

function effective(rate, years) { return ((1 + rate) ** years - 1) * 100; }

test("annualize inverts compounding; bad input gives null", () => {
  assert.ok(Math.abs(annualize(effective(0.1, 5), 5) - 10) < 1e-9);
  assert.ok(Math.abs(annualize(effective(-0.05, 3), 3) + 5) < 1e-9);
  assert.equal(annualize(null, 3), null);
  assert.equal(annualize(-100, 3), null);
});

test("long periods use weekly history; per-year matches compounding", () => {
  const f = (d) => 100 * 1.1 ** ((d - Date.parse("2015-01-05")) / (365.25 * 86400000)); // 10%/yr
  const w = weekly("2015-01-05", "2026-10-12", f);
  const d = bars("2025-10-15", "2026-10-15", f);
  const s = summarize(d, w);
  assert.equal(PERIODS.length, 9);
  for (const [p, y] of [["3Y", 3], ["5Y", 5], ["10Y", 10]]) {
    assert.ok(Math.abs(s.ann[p] - 10) < 0.35, `${p} ${s.ann[p]}`);
    assert.ok(Math.abs(s.ret[p] - effective(0.1, y)) < 3, `${p} ${s.ret[p]}`);
  }
  assert.ok(Math.abs(s.ret["1Y"] - 10) < 0.5);
  assert.equal(s.historyFrom, Date.parse("2015-01-05"));
});

test("periods longer than the history are null; 1Y falls back to weekly when daily is short", () => {
  const f = () => 100;
  const s = summarize(bars("2025-12-01", "2026-10-15", f), weekly("2024-06-03", "2026-10-12", f));
  assert.equal(s.ret["5Y"], null);
  assert.equal(s.ann["5Y"], null);
  near(s.ret["1Y"], 0);
  assert.equal(summarize(bars("2025-12-01", "2026-10-15", f)).ret["1Y"], null);
});

test("52-week high carries its date", () => {
  const b = bars("2025-10-01", "2026-10-15", (d) => (d.toISOString().startsWith("2026-03-02") ? 200 : 100));
  assert.equal(new Date(summarize(b).high52At).toISOString().slice(0, 10), "2026-03-02");
});

test("chart bars: daily for 1Y, weekly beyond, ends at the live price", () => {
  const d = bars("2025-10-15", "2026-10-15", () => 100);
  const w = weekly("2015-01-05", "2026-10-12", () => 90);
  const y1 = chartBars(d, w, "1Y", 123);
  assert.equal(y1[0][1], 100);
  assert.ok(y1.length > 240);
  assert.deepEqual(y1[y1.length - 1], [d[d.length - 1].t, 123]);
  const y5 = chartBars(d, w, "5Y", 123);
  assert.ok(y5.length > 250 && y5.length < 300);
  assert.equal(chartBars(d, w, "MAX", 123)[0][0], Date.parse("2015-01-05"));
  assert.equal(chartBars(d, null, "10Y", 5).length, d.length);
});

test("sector rotation: strength and momentum against a benchmark", () => {
  const { rotation, quadrant } = require("../src/markets");
  const W = 7 * 86400000, t0 = Date.parse("2025-01-06"); // a Monday
  const weeks = (n, f) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * W, close: f(i) }));
  const bench = weeks(60, () => 100);
  // moving with the benchmark: dead center
  const same = rotation(weeks(60, () => 50), bench);
  assert.equal(same.length, 12);
  near(same[11][1], 100); near(same[11][2], 100);
  // steadily outperforming: strength above 100; at a constant pace its momentum settles just above 100 too
  const up = rotation(weeks(60, (i) => 50 * 1.01 ** i), bench).at(-1);
  assert.ok(up[1] > 105 && up[2] >= 100, `${up}`);
  assert.equal(quadrant(up[1], up[2]), "leading");
  // outperformed, then started slipping: still strong, momentum below 100
  const turn = rotation(weeks(60, (i) => (i < 56 ? 50 * 1.01 ** i : 50 * 1.01 ** 56 * 0.985 ** (i - 56))), bench).at(-1);
  assert.equal(quadrant(turn[1], turn[2]), "weakening");
  assert.equal(quadrant(95, 101), "improving"); assert.equal(quadrant(95, 99), "lagging");
  // the week in progress is stamped mid-week on one side: still matched to the same week
  const b2 = weeks(40, () => 100); b2[39] = { t: b2[39].t + 3 * 86400000 + 3600e3, close: 100 };
  assert.equal(rotation(weeks(40, () => 10), b2, { tail: 4 }).length, 4);
  // too little history for the averages: nothing, not NaN
  assert.deepEqual(rotation(weeks(20, () => 1), weeks(20, () => 1)), []);
  assert.deepEqual(rotation(null, bench), []);
});

test("correlations: shared calendar, weekend bars ignored, matrix symmetric", () => {
  const { alignedReturns, pearson, correlations, pairDetail } = require("../src/markets");
  const D = 86400000, t0 = Date.parse("2026-01-05T00:00:00Z"); // a Monday
  const days = [];
  for (let i = 0; i < 120; i++) { const t = t0 + i * D, wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) days.push(t); }
  const wig = (i) => Math.sin(i * 1.7) * 0.01 + Math.cos(i * 0.6) * 0.006;
  let a = 100, b = 50, c = 80;
  const A = [], B = [], C = [];
  days.forEach((t, i) => { a *= 1 + wig(i); b *= 1 + 2 * wig(i); c *= 1 - wig(i); A.push({ t, close: a }); B.push({ t, close: b }); C.push({ t, close: c }); });
  // B also trades at weekends: those bars must not shift its returns
  const Bw = [...B, { t: t0 + 5 * D, close: 1 }, { t: t0 + 6 * D, close: 9999 }].sort((x, y) => x.t - y.t);
  const al = alignedReturns({ A, B: Bw, C }, ["A", "B", "C", "ZZ"], "A");
  assert.equal(al.t.length, days.length);
  assert.equal(al.r.A[0], null);
  assert.ok(Math.abs(al.r.B[5] - 2 * wig(5)) < 1e-9); // Monday's move is Friday → Monday
  const m = correlations(al, ["A", "B", "C", "ZZ"], 63);
  assert.equal(m.days, 63);
  assert.equal(m.m[0][0], 1);
  assert.ok(m.m[0][1] > 0.999 && m.m[0][2] < -0.999);
  assert.equal(m.m[0][1], m.m[1][0]);
  assert.equal(m.m[0][3], null); assert.equal(m.m[3][3], null);
  assert.equal(pearson([1, 2, 3], [1, 2, 3]), null); // too few pairs
  const p = pairDetail(al, "A", "C", 21);
  assert.equal(p.dots.length, 21);
  assert.ok(p.rolling.length > 30 && p.rolling.every(([, r]) => r < -0.99));
  assert.equal(p.rolling[p.rolling.length - 1][0], days[days.length - 1]);
});
