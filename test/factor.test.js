const test = require("node:test");
const assert = require("node:assert");
const F = require("../src/factor");

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
// deterministic pseudo-random numbers
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test("logistic regression recovers known coefficients", () => {
  const r = rng(7), X = [], y = [];
  for (let i = 0; i < 4000; i++) {
    const a = r() * 4 - 2, b = r() * 4 - 2;
    X.push([a, b]); y.push(r() < F.sigmoid(-0.5 + 1.5 * a - 1 * b) ? 1 : 0);
  }
  const f = F.logit(X, y);
  near(f.b[0], -0.5, 0.15); near(f.b[1], 1.5, 0.15); near(f.b[2], -1, 0.15);
  assert.ok(f.pseudoR2 > 0.2 && f.pseudoR2 < 1);
});

test("AUC, Brier and calibration", () => {
  assert.strictEqual(F.auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1);
  assert.strictEqual(F.auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1]), 0);
  assert.strictEqual(F.auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1]), 0.5);
  near(F.brier([1, 0], [1, 0]), 0, 1e-12); near(F.brier([0.5, 0.5], [1, 0]), 0.25, 1e-12);
  const cal = F.calibration([0.05, 0.05, 0.6, 0.6], [0, 0, 1, 0]);
  assert.strictEqual(cal[0].n, 2); assert.strictEqual(cal[0].actual, 0); assert.strictEqual(cal[3].actual, 0.5);
});

test("cases are labeled from the months after each date", () => {
  const rows = [100, 105, 95, 88, 92, 110].map((v, i) => [`2020-0${i + 1}`, v]);
  // fall 10%+ at any point within 3 months: from 100, 88 is -12% → yes; from 105, 88 is -16% → yes; from 95, (88, 92, 110) → -7% → no
  const within = F.labelCase(rows, { cond: "fall", x: 10, h: 3, when: "within", unit: "pct" });
  assert.deepStrictEqual([...within.values()], [1, 1, 0]);
  // the same, but only the value 3 months later counts
  const end = F.labelCase(rows, { cond: "fall", x: 10, h: 3, when: "end", unit: "pct" });
  assert.deepStrictEqual([...end.values()], [1, 1, 0]); // 100→88 (−12%), 105→92 (−12.4%), 95→110
});

test("point moves and levels", () => {
  const rows = [3.5, 3.6, 4.1, 4.0, 3.2].map((v, i) => [`2021-0${i + 1}`, v]);
  assert.deepStrictEqual([...F.labelCase(rows, { cond: "rise", x: 0.5, h: 2, when: "within", unit: "pts" }).values()], [1, 0, 0]);
  assert.deepStrictEqual([...F.labelCase(rows, { cond: "below", x: 3.3, h: 1, when: "end", unit: "pts" }).values()], [0, 0, 0, 1]);
  assert.match(F.describeCase({ cond: "fall", x: 10, h: 6, when: "within", unit: "pct" }, "S&P 500"), /S&P 500 falls 10% or more, at any point within 6 months/);
});

test("full analysis: a factor that leads the case gets a big, significant coefficient", () => {
  const r = rng(3), day = (i) => Date.UTC(1990, i, 15);
  const factor = [], target = [];
  let level = 100;
  for (let i = 0; i < 360; i++) {
    const f = Math.sin(i / 9) * 2 + (r() - 0.5);
    factor.push([day(i), f]);
    level *= 1 + (f > 1.2 ? -0.06 : 0.01) * (0.5 + r()); // a high factor tends to be followed by falls
    target.push([day(i + 1), level]);
  }
  const res = F.analyze({ target: { name: "Index", points: target, measure: "level" }, c: { cond: "fall", x: 8, h: 3, when: "within", unit: "pct" }, factors: [{ name: "Stress", points: factor, tf: "level", lag: 0 }], holdout: 0.25 });
  assert.ok(res.events > 10 && res.events < res.n - 10);
  assert.ok(res.coefs[1].coef > 0.5, "higher stress → higher odds");
  assert.ok(res.coefs[1].p < 0.05);
  assert.ok(res.score.auc > 0.75);
  assert.ok(res.now.lo <= res.now.p && res.now.p <= res.now.hi);
  assert.strictEqual(res.splits[0].high.rate > res.splits[0].low.rate, true);
  assert.ok(res.history.length >= res.n);
});

test("presets are complete", () => {
  for (const p of F.PRESETS) {
    assert.ok(p.name && p.target.key && p.c.h && p.factors.length >= 2, p.id);
    assert.ok(["rise", "fall", "above", "below"].includes(p.c.cond));
  }
});
