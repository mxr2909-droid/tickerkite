const test = require("node:test");
const assert = require("node:assert");
const MC = require("../src/montecarlo");

const DAY = 864e5, T0 = Date.UTC(2024, 0, 1); // a Monday
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
/** n weekday closes starting at T0, each day's return given by f(i). */
function prices(n, f, start = 100) {
  const out = []; let v = start, t = T0;
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY;
    if (i) v *= 1 + f(i);
    out.push([t, v]); t += DAY;
  }
  return out;
}
const noise = (seed, mu, sd) => { const r = MC.rng(seed); return () => mu + sd * (r() + r() + r() + r() - 2) * 1.732; };

test("rng is reproducible and stays in [0, 1)", () => {
  const a = MC.rng(7), b = MC.rng(7), c = MC.rng(8);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepStrictEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.notStrictEqual(xs[0], c());
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  near(xs.reduce((s, x) => s + x, 0) / 1000, 0.5, 0.05);
});

test("pctl interpolates between neighbours", () => {
  near(MC.pctl([1, 2, 3, 4, 5], 50), 3);
  near(MC.pctl([1, 2, 3, 4], 50), 2.5);
  near(MC.pctl([10, 20], 5), 10.5);
  near(MC.pctl([7], 95), 7);
});

test("addTradingDays skips weekends", () => {
  const d = (t) => new Date(t).toISOString().slice(0, 10);
  assert.strictEqual(d(MC.addTradingDays(T0, 0)), "2024-01-01");
  assert.strictEqual(d(MC.addTradingDays(T0, 4)), "2024-01-05");
  assert.strictEqual(d(MC.addTradingDays(T0, 5)), "2024-01-08");
  assert.strictEqual(d(MC.addTradingDays(Date.UTC(2024, 0, 6), 1)), "2024-01-08"); // from a Saturday
  assert.strictEqual(d(MC.addTradingDays(Date.UTC(2024, 0, 4), 252)), "2024-12-23"); // a Thursday + 50 weeks + 2 days
});

test("alignReturns: weighted portfolio return on the benchmark's dates", () => {
  const bench = prices(400, () => 0.001), a = prices(400, () => 0.002), b = prices(400, () => -0.001);
  const r = MC.alignReturns({ A: a, B: b }, [{ sym: "A", weight: 300 }, { sym: "B", weight: 100 }], bench);
  assert.strictEqual(r.port.length, 399);
  near(r.bench[10], 0.001); near(r.port[10], 0.75 * 0.002 - 0.25 * 0.001);
  near(r.used.find((u) => u.sym === "A").weight, 75);
});

test("alignReturns: short and missing histories are left out, cash without history is held flat", () => {
  const bench = prices(600, () => 0.001), a = prices(600, () => 0.002);
  const young = prices(600, () => 0.01).slice(-100), mid = prices(600, () => 0.004).slice(-300);
  const r = MC.alignReturns({ A: a, Y: young, M: mid }, [
    { sym: "A", weight: 50 }, { sym: "Y", weight: 20 }, { sym: "GONE", weight: 10 }, { sym: "CASH", weight: 25, flat: true }, { sym: "M", weight: 25 }
  ], bench);
  assert.strictEqual(r.used.find((u) => u.sym === "CASH").flat, true);
  // cash with a real history (a T-bill fund) is simulated; cash with a short one is held flat
  const c2 = MC.alignReturns({ A: a, B: a, S: young }, [{ sym: "A", weight: 1 }, { sym: "B", weight: 1, flat: true }, { sym: "S", weight: 2, flat: true }], bench);
  assert.deepStrictEqual(c2.used.map((u) => u.flat), [false, false, true]); near(c2.port[5], 0.5 * 0.002);
  assert.deepStrictEqual(r.excluded.map((e) => e.sym).sort(), ["GONE", "Y"]);
  assert.strictEqual(r.port.length, 299); // the window starts where the youngest kept holding starts
  near(r.port[5], 0.5 * 0.002 + 0.25 * 0.004); // the cash quarter earns nothing
  assert.ok(MC.alignReturns({}, [{ sym: "X", weight: 1 }], bench).error);
  assert.ok(MC.alignReturns({ A: a }, [{ sym: "A", weight: 1 }], bench.slice(0, 50)).error);
});

test("alignReturns: a weekend move lands on the next trading day", () => {
  const bench = prices(300, () => 0);
  const coin = bench.map(([t, v]) => [t, v]);
  const fri = coin.findIndex(([t]) => new Date(t).getUTCDay() === 5 && t > T0 + 20 * DAY);
  coin.splice(fri + 1, 0, [coin[fri][0] + DAY, 110]); // Saturday: +10%
  for (let i = fri + 2; i < coin.length; i++) coin[i][1] = 110;
  const r = MC.alignReturns({ C: coin }, [{ sym: "C", weight: 1 }], bench);
  near(r.port[fri], 0.1); // index fri is the return into the Monday after
  near(r.port.reduce((s, x) => s + x, 0), 0.1);
});

test("simulate: constant returns compound exactly and every path starts at the capital", () => {
  const port = new Float64Array(500).fill(0.001), bench = new Float64Array(500).fill(0.0005);
  const s = MC.simulate({ port, bench, days: 252, capital: 5000, runs: 200, startAt: T0 });
  assert.strictEqual(s.t.length, s.port.p50.length);
  assert.strictEqual(s.port.p50[0], 5000); assert.strictEqual(s.bench.p50[0], 5000);
  assert.ok(s.paths.every((p) => p[0] === 5000 && p.length === s.t.length));
  near(s.end.port.p50, 5000 * 1.001 ** 252, 0.01); near(s.end.port.p5, s.end.port.p95, 1e-6);
  near(s.end.bench.p50, 5000 * 1.0005 ** 252, 0.01);
  assert.strictEqual(s.out.ahead, 100); assert.strictEqual(s.out.behind, 0); assert.strictEqual(s.end.probLoss, 0);
  near(s.out.median, (1.001 ** 252 - 1.0005 ** 252) * 100, 1e-6);
  assert.strictEqual(new Date(s.t[s.t.length - 1]).toISOString().slice(0, 10), "2024-12-18"); // 252 trading days on
});

test("simulate: same inputs give the same result; the sample is 100 distinct runs", () => {
  const f = noise(3, 0.0004, 0.01), g = noise(4, 0.0003, 0.008);
  const port = Float64Array.from({ length: 1500 }, f), bench = Float64Array.from({ length: 1500 }, g);
  const a = MC.simulate({ port, bench, days: 126, capital: 10000, runs: 2000, startAt: T0 });
  const b = MC.simulate({ port, bench, days: 126, capital: 10000, runs: 2000, startAt: T0 });
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.paths.length, 100);
  assert.strictEqual(new Set(a.paths.map((p) => p.join())).size, 100);
  assert.strictEqual(a.step, 1); assert.strictEqual(a.t.length, 127);
  const c = MC.simulate({ port, bench, days: 126, capital: 10000, runs: 2000, startAt: T0, seed: 5 });
  assert.notDeepStrictEqual(a.end, c.end);
});

test("simulate: percentiles are ordered, shares add to 100, long horizons stay within the point budget", () => {
  const f = noise(11, 0.0004, 0.012), g = noise(12, 0.0004, 0.01);
  const port = Float64Array.from({ length: 2500 }, f), bench = Float64Array.from({ length: 2500 }, g);
  const s = MC.simulate({ port, bench, days: 1260, capital: 25000, runs: 3000, startAt: T0 });
  assert.ok(s.t.length <= 128 && s.step === 10);
  for (let k = 1; k < s.t.length; k++) {
    const v = ["p1", "p5", "p25", "p50", "p75", "p95", "p99"].map((p) => s.port[p][k]);
    assert.ok(v.every((x, i) => !i || x >= v[i - 1]), `ordered at ${k}`);
    assert.ok(s.t[k] > s.t[k - 1]);
  }
  near(s.out.ahead + s.out.behind + s.out.tied, 100, 1e-9);
  assert.strictEqual(s.out.bins.reduce((n, b) => n + b.n, 0), 3000);
  assert.ok(s.out.p5 < s.out.median && s.out.median < s.out.p95);
  assert.ok(s.end.probLoss > 0 && s.end.probLoss < 50);
  // the middle of the band widens with time
  assert.ok(s.port.p95[100] - s.port.p5[100] > s.port.p95[10] - s.port.p5[10]);
});

test("simulate: a portfolio that is the benchmark ties every run", () => {
  const port = Float64Array.from({ length: 800 }, noise(21, 0.0003, 0.01));
  const s = MC.simulate({ port, bench: port, days: 252, runs: 500, startAt: T0 });
  assert.strictEqual(s.out.tied, 100); assert.strictEqual(s.out.ahead, 0);
  assert.ok(s.out.bins.length >= 2 && s.out.bins.some((b) => b.lo === 0));
});

test("histogram: zero is a bin edge, widths are round, outliers are folded into the end bins", () => {
  const r = MC.rng(9), diffs = Array.from({ length: 5000 }, () => (r() + r() + r() - 1.5) * 20 + 3);
  diffs.push(500, -400);
  const h = MC.histogram(diffs);
  assert.ok(h.bins.some((b) => b.lo === 0) && h.bins.some((b) => b.hi === 0));
  assert.ok([1, 2, 2.5, 5].some((m) => Math.abs(Math.log10(h.width / m) % 1) < 1e-9));
  assert.ok(h.bins.length >= 15 && h.bins.length <= 45);
  assert.strictEqual(h.bins.reduce((n, b) => n + b.n, 0), 5002);
  assert.ok(h.over >= 1 && h.under >= 1);
  for (let i = 1; i < h.bins.length; i++) near(h.bins[i].lo, h.bins[i - 1].hi, 1e-9);
});

test("closesFromChart prefers dividend-adjusted closes and drops gaps", () => {
  const j = { chart: { result: [{ timestamp: [1, 2, 3], meta: { shortName: "Fund" }, indicators: { quote: [{ close: [10, null, 12] }], adjclose: [{ adjclose: [9, null, 12] }] } }] } };
  assert.deepStrictEqual(MC.closesFromChart(j), { pts: [[1000, 9], [3000, 12]], name: "Fund" });
  delete j.chart.result[0].indicators.adjclose;
  assert.deepStrictEqual(MC.closesFromChart(j).pts, [[1000, 10], [3000, 12]]);
  assert.strictEqual(MC.closesFromChart({}), null);
});
