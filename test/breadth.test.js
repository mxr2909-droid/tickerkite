const test = require("node:test");
const assert = require("node:assert");
const B = require("../src/breadth");
const { historyPayload, HISTORY_DAYS } = require("../src/sectormap");

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const dayT = (ymd) => Date.UTC(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100, 9, 30);
const bars = (list) => list.map(([d, close]) => ({ t: dayT(d), close }));

test("rounds to 4 significant digits; bad prices become null", () => {
  assert.equal(B.sig(123.456), 123.5);
  assert.equal(B.sig(0.0123456), 0.01235);
  assert.equal(B.sig(4321.9), 4322);
  assert.equal(B.sig(null), null);
  assert.equal(B.sig(0), null);
  assert.equal(B.sig(NaN), null);
});

test("last closed session in New York", () => {
  // Thu 2026-11-12: 3 pm (still trading) → Wed; 5 pm → Thu
  assert.equal(B.lastCloseYmd(new Date("2026-11-12T20:00:00Z")), 20261111);
  assert.equal(B.lastCloseYmd(new Date("2026-11-12T22:00:00Z")), 20261112);
  // Saturday and Monday morning → Friday
  assert.equal(B.lastCloseYmd(new Date("2026-11-14T18:00:00Z")), 20261113);
  assert.equal(B.lastCloseYmd(new Date("2026-11-16T14:00:00Z")), 20261113);
  // once a day, after the close
  const store = { dates: [20261111], asOf: 20261111 };
  assert.equal(B.historyDue(store, new Date("2026-11-12T20:00:00Z")), false);
  assert.equal(B.historyDue(store, new Date("2026-11-12T22:00:00Z")), true);
  assert.equal(B.historyDue(null), true);
  assert.equal(B.historyDue({ dates: [] }), true);
});

test("history: one calendar (SPY's), nulls for missing days, a day still trading left out, thin symbols skipped", () => {
  const cal = bars([[20260102, 1], [20260105, 1], [20260106, 1], [20260107, 1]]);
  const days = [20260102, 20260105, 20260106, 20260107];
  const full = (p) => bars(days.map((d, i) => [d, p + i]));
  const h = B.buildHistory({
    AAA: full(10.123456),
    BBB: bars([[20260102, 50], [20260105, 50.5], [20260107, 52], [20260108, 99]]), // a gap and a day still trading
    THIN: bars([[20260106, 5]])
  }, cal, 3, 20260107);
  assert.deepEqual(h.dates, [20260105, 20260106, 20260107]);
  assert.deepEqual(h.closes.AAA, [11.12, 12.12, 13.12]);
  assert.deepEqual(h.closes.BBB, [50.5, null, 52]);
  assert.ok(!("THIN" in h.closes));
  // no calendar: the most complete symbol's days
  const h2 = B.buildHistory({ AAA: full(1), BBB: bars([[20260102, 1]]) }, null, 10, 20991231);
  assert.deepEqual(h2.dates, days);
});

/** Closes for a few companies over `n` days from a function of (company, day). */
const store = (n, k, f) => B.prepare(Array.from({ length: k }, (_, j) => Array.from({ length: n }, (_, i) => f(j, i))), n);

test("prepare: daily returns, 50-day average and 20-day highs and lows", () => {
  const P = store(60, 2, (j, i) => (j === 0 ? 100 + i : i === 59 ? 50 : 100 + (i % 2)));
  const up = P.rows[0], flat = P.rows[1];
  assert.ok(Number.isNaN(up.r[0]));
  near(up.r[1], 101 / 100 - 1);
  assert.equal(up.a50[38], -1);           // fewer than 40 closes so far
  assert.equal(up.a50[39], 1);            // a steady climb sits above its average
  assert.equal(up.hl[14], -2);            // fewer than 15 earlier days
  assert.equal(up.hl[15], 1);             // a new 20-day high
  assert.equal(flat.hl[59], -1);          // the drop to 50 is a new low
  assert.equal(flat.a50[59], 0);
  assert.equal(up.last, 159);
  // a missing close breaks the returns on both sides
  const G = B.prepare([[10, null, 12, 13]], 4);
  assert.ok(Number.isNaN(G.rows[0].r[1]) && Number.isNaN(G.rows[0].r[2]));
  near(G.rows[0].r[3], 13 / 12 - 1);
});

test("breadth: share rising, equal weight vs cap weight", () => {
  // day 1: the big company +10%, the two small ones −1%; day 2: everyone +1%
  const P = B.prepare([[100, 110, 111.1], [10, 9.9, 9.999], [10, 9.9, 9.999]], 3);
  const b = B.breadth(P, [0, 1, 2], [1110, 10, 10]);
  assert.equal(b.up[0], null);
  near(b.up[1], 1 / 3);
  near(b.up[2], 1);
  near(b.ew[1], 1 + (0.1 - 0.01 - 0.01) / 3);
  // caps on day 0: 1110 × 100/111.1 ≈ 999.1 and 10 × 10/9.999 ≈ 10 each
  const w0 = 1110 * 100 / 111.1, w1 = 10 * 10 / 9.999;
  near(b.cw[1], 1 + (w0 * 0.1 - 2 * w1 * 0.01) / (w0 + 2 * w1));
  near(b.ew[2] / b.ew[1], 1.01, 1e-6);
  assert.ok(b.cw[2] > b.ew[2]); // the giant carried the index: the average stock is behind
  // one sector only: the subset is counted on its own
  const s = B.breadth(P, [1, 2], [10, 10]);
  near(s.up[1], 0);
});

test("breadth: above the 50-day average and highs minus lows", () => {
  // three climb, one falls: 75% above average, 3 highs − 1 low = +50%
  const P = store(60, 4, (j, i) => (j < 3 ? 100 + i : 200 - i));
  const b = B.breadth(P, [0, 1, 2, 3], [1, 1, 1, 1]);
  assert.equal(b.above[30], null);
  near(b.above[59], 0.75);
  near(b.hl[59], 0.5);
  near(b.up[59], 0.75);
});

test("smooth, gap and span start", () => {
  assert.deepEqual(B.smooth([1, null, 3, 5], 2), [1, 1, 3, 4]);
  assert.deepEqual(B.smooth([null, null, 1], 4), [null, null, null]);
  const g = B.gapSeries([1, 1.1, 1.21], [1, 1.2, 1.2], 1);
  assert.equal(g[0], null);
  near(g[1], 0);
  near(g[2], (1.21 / 1.1 - 1) * 100);
  assert.equal(B.spanStart(312, "3M"), 311 - 63);
  assert.equal(B.spanStart(312, "1Y"), 311 - 252);
  assert.equal(B.spanStart(40, "1Y"), 0);
});

test("summary and plain-English reading", () => {
  const b = { up: [0.4, 0.5, 0.6, null], above: [0.41, 0.5, 0.63, null], hl: [-0.1, 0, 0.12, null], ew: [1, 1, 1.01, 1.01], cw: [1, 1.02, 1.04, 1.04] };
  const m = B.summarize(b, 0, 2);
  assert.equal(m.i, 2);
  assert.equal(m.above, 0.63); assert.equal(m.aboveAgo, 0.41);
  near(m.gap, (1.01 - 1.04) * 100);
  const t = B.readingText({ ...m, up10: 0.5 }, "3 months");
  assert.match(t, /^63% of companies are above their 50-day average, up from 41% a month ago\./);
  assert.match(t, /The average stock is 3\.0 points behind the index over 3 months: the gains are concentrated in the biggest companies\./);
  assert.match(t, /50% of companies rose on a typical day/);
  assert.match(B.readingText({ ...m, gap: 2.5, cwRet: -4 }, "the year", "Energy"), /2\.5 points ahead of the Energy total over the year: the losses are concentrated in the biggest companies/);
  assert.match(B.readingText({ ...m, gap: 0.4 }, "6 months"), /within a point of the index/);
  assert.match(B.readingText({ ...m, aboveAgo: m.above }, "6 months"), /the same as a month ago/);
});

test("replay frames: each day's move, since the start, sectors weighted by today's caps", () => {
  const P = B.prepare([[100, 110, 99], [10, 10, 11], [null, null, null]], 3);
  const fr = B.replayFrames(P, [[{ row: 0, cap: 900 }, { row: 1, cap: 100 }], [{ row: 2, cap: 5 }, { row: -1, cap: 5 }]], 0, 2);
  assert.equal(fr.len, 2);
  near(fr.firm[0][0].day[0], 10, 1e-4); near(fr.firm[0][0].day[1], -10, 1e-4);
  near(fr.firm[0][0].cum[1], -1, 1e-4);
  near(fr.firm[0][1].cum[1], 10, 1e-4);
  near(fr.sec[0].day[0], 0.9 * 10 + 0.1 * 0, 1e-4);
  // since the start: shares = cap ÷ latest close → 900/99 and 100/11; value then vs now
  const a = 900 / 99, c = 100 / 11;
  near(fr.sec[0].cum[1], ((a * 99 + c * 11) / (a * 100 + c * 10) - 1) * 100, 1e-4);
  assert.ok(Number.isNaN(fr.sec[1].day[0]) && Number.isNaN(fr.firm[1][1].cum[0]));
  assert.ok(!("ff" in fr.firm[0][0])); // working arrays are dropped
  const ew = B.ewPath(P, [0, 1], 0, 2);
  near(ew[0], 5, 1e-4);
  near(ew[1], (1.05 * (1 + (-0.1 + 0.1) / 2) - 1) * 100, 1e-4);
});

test("map:history payload: today's caps, closes left out when the caller already has them", () => {
  const sectors = [{ id: "Technology", name: "Technology", firms: [{ sym: "AAA", name: "A Inc.", cap: 2e9, price: 10, d1: 1 }] }];
  const st = { dates: [20260105], closes: { AAA: [10] }, at: 5, asOf: 20260105 };
  const p = historyPayload(st, sectors, { AAA: { price: 11, prev: 10 } }, 0, { loading: true, progress: 0.5 });
  assert.deepEqual(p.syms, [{ sym: "AAA", name: "A Inc.", sector: "Technology", cap: 2.2e9 }]);
  assert.deepEqual(p.sectors, [{ id: "Technology", name: "Technology" }]);
  assert.deepEqual(p.closes, { AAA: [10] });
  assert.equal(p.loading, true); assert.equal(p.progress, 0.5); assert.equal(p.same, false);
  const q = historyPayload(st, sectors, {}, 5);
  assert.equal(q.same, true); assert.equal(q.closes, null); assert.equal(q.dates, null);
  const empty = historyPayload(null, [], {}, 0);
  assert.deepEqual([empty.dates, empty.at, empty.same], [[], 0, false]);
  assert.ok(HISTORY_DAYS >= 260);
});
