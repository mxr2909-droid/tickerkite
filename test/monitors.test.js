const test = require("node:test");
const assert = require("node:assert");
const M = require("../src/monitors");
const MODELS = require("../src/monitor-models");

test("status: WARNING needs 30%+ and twice the usual rate; WATCH on 1.5× or a jump", () => {
  assert.strictEqual(M.status(0.31, 0.09, 0), "WARNING");
  assert.strictEqual(M.status(0.33, 0.30, 0), "NORMAL");   // common event, about its usual level
  assert.strictEqual(M.status(0.62, 0.30, 0), "WARNING");  // twice a common event's rate
  assert.strictEqual(M.status(0.16, 0.10, 0), "WATCH");    // 1.6× usual
  assert.strictEqual(M.status(0.12, 0.10, 0.09), "WATCH"); // jumped 9 points in a month
  assert.strictEqual(M.status(0.12, 0.10, 0.02), "NORMAL");
});

test("summarize: month and quarter changes and drivers", () => {
  const hist = [0.1, 0.1, 0.1, 0.12, 0.15, 0.2].map((prob, i) => ({ p: `2026-0${i + 1}`, prob }));
  const r = { history: hist, now: { p: 0.2, lo: 0.1, hi: 0.35, period: "2026-06" }, base: 0.1, pushes: [{ name: "Oil", logOdds: 0.5, zscore: 1.2 }, { name: "Curve", logOdds: -0.2, zscore: 0.4 }] };
  const s = M.summarize(MODELS[0], r);
  assert.ok(Math.abs(s.d1m - 0.05) < 1e-9 && Math.abs(s.d3m - 0.1) < 1e-9);
  assert.strictEqual(s.status, "WATCH");
  assert.deepStrictEqual(s.drivers.map((d) => [d.name, d.up, d.level]), [["Oil", true, "high"], ["Curve", false, "high"]]);
});

test("every monitor model is complete and documented", () => {
  const ids = new Set();
  for (const m of MODELS) {
    assert.ok(!ids.has(m.id)); ids.add(m.id);
    assert.ok(m.short && m.why && m.c.text && m.factors.length >= 2 && m.quality.auc > 0.6 && m.ridge > 0, m.id);
  }
});
