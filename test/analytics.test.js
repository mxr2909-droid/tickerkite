const test = require("node:test");
const assert = require("node:assert");
const A = require("../src/analytics");

const DAY = 86400e3;
// Build Yahoo-shaped JSON from closes
function yahoo(closes, { start = Date.UTC(2026, 6, 1, 20), step = DAY, prevClose = null, gmtoffset = -14400 } = {}) {
  return {
    chart: {
      result: [{
        meta: { regularMarketPrice: closes.at(-1), chartPreviousClose: prevClose ?? closes[0], gmtoffset, fiftyTwoWeekHigh: Math.max(...closes) * 1.05, fiftyTwoWeekLow: Math.min(...closes) * 0.9 },
        timestamp: closes.map((_, i) => (start + i * step) / 1000),
        indicators: { quote: [{ close: closes, high: closes.map((c) => c * 1.002), low: closes.map((c) => c * 0.998), open: closes, volume: closes.map(() => 1000) }] }
      }]
    }
  };
}

test("accelerating uptrend reads as accelerating higher", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 * Math.exp(0.00005 * i * i)); // convex
  const r = A.analyze(yahoo(closes), "3M", "idx");
  assert.ok(r.momentum.vNow > 0);
  assert.ok(r.momentum.aNow > 0);
  assert.equal(r.momentum.regime, "Accelerating higher");
  assert.equal(r.momentum.unitVel, "%/day");
  assert.ok(r.stats.pct > 0 && r.stats.pos > 0.95);
});

test("decline that is flattening reads as losing steam", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 - 20 * (1 - Math.exp(-i / 15))); // falling, decelerating
  const r = A.analyze(yahoo(closes), "3M", "idx");
  assert.ok(r.momentum.vNow < 0);
  assert.ok(r.momentum.aNow > 0);
  assert.equal(r.momentum.regime, "Falling, but losing steam");
  assert.ok(r.stats.maxDD < -15);
});

test("big moves find the shock days in time order", () => {
  const closes = [];
  let p = 100;
  for (let i = 0; i < 40; i++) {
    p *= 1 + (i % 2 ? 0.002 : -0.0015);
    if (i === 10) p *= 0.95;
    if (i === 25) p *= 1.04;
    closes.push(p);
  }
  const r = A.analyze(yahoo(closes), "1M", "idx");
  const top = r.moves.filter((m) => Math.abs(m.z) > 3);
  assert.equal(top.length, 2);
  assert.ok(top[0].ret < -4 && top[1].ret > 3.5);
  assert.ok(r.moves.every((m, i) => i === 0 || m.t > r.moves[i - 1].t));
  assert.match(top[0].day, /^\d{4}-\d{2}-\d{2}$/);
});

test("yields use basis points", () => {
  const closes = [4.0, 4.05, 4.1, 4.02, 4.2];
  const r = A.analyze(yahoo(closes), "1M", "yld");
  assert.equal(r.stats.volUnit, "bp");
  assert.equal(r.stats.pct, null);
  assert.ok(Math.abs(r.stats.chg - 0.2) < 1e-9);
  const big = r.moves.find((m) => m.day && Math.abs(m.ret - 18) < 1e-6);
  assert.ok(big, "the +18bp day is a big move");
  assert.equal(r.momentum.unitVel, "bp/day");
});

test("intraday 1D measures against previous close and per-hour momentum", () => {
  const closes = Array.from({ length: 78 }, (_, i) => 101 + Math.sin(i / 10));
  const r = A.analyze(yahoo(closes, { step: 5 * 60e3, prevClose: 100 }), "1D", "idx");
  assert.ok(Math.abs(r.stats.base - 100) < 1e-9);
  assert.equal(r.momentum.unitVel, "%/hr");
  assert.equal(r.moves[0].gap, true, "the opening gap vs prior close is a candidate move");
  assert.ok(r.moves.length <= 4);
});

test("5D groups moves by trading day", () => {
  const closes = [];
  for (let d = 0; d < 5; d++) for (let b = 0; b < 13; b++) closes.push(100 + d * (d === 3 ? 4 : 0.2) + b * 0.01);
  const start = Date.UTC(2026, 9, 9, 13, 30);
  const json = yahoo(closes, { start, step: 30 * 60e3, prevClose: 99.8 });
  // spread bars over 5 separate days
  json.chart.result[0].timestamp = closes.map((_, i) => (start + Math.floor(i / 13) * DAY + (i % 13) * 30 * 60e3) / 1000);
  const r = A.analyze(json, "5D", "idx");
  assert.ok(r.moves.length <= 3);
  assert.ok(new Set(r.moves.map((m) => m.day)).size === r.moves.length);
  assert.ok(r.moves.some((m) => m.ret > 3), "finds the jump day");
});

test("bad payload throws a readable error", () => {
  assert.throws(() => A.analyze({ chart: { result: null, error: { description: "No data found" } } }, "1M", "idx"), /No data found/);
});
