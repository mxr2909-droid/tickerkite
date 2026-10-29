const test = require("node:test");
const assert = require("node:assert");
const R = require("../src/regress");

const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
// Anscombe's quartet, set I: published results intercept 3.0001, slope 0.5001, R² 0.6665, slope SE 0.1179, t 4.24, p 0.00217
const ax = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5], ay = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];

test("simple regression matches Anscombe's published numbers", () => {
  const r = R.ols(ax.map((v) => [v]), ay, ["x"]);
  near(r.coefs[0].coef, 3.0001); near(r.coefs[1].coef, 0.5001); near(r.r2, 0.6665);
  near(r.coefs[1].se, 0.1179); near(r.coefs[1].t, 4.24, 0.01); near(r.coefs[1].p, 0.00217, 0.0001);
  near(r.F, 17.99, 0.01); near(r.Fp, 0.00217, 0.0001);
  assert.strictEqual(r.df, 9);
});

test("t and F distributions", () => {
  near(R.tCrit(0.05, 10), 2.228); near(R.tCrit(0.05, 1e6), 1.96); near(R.tPValue(2.228, 10), 0.05, 1e-3);
  near(R.fPValue(4.96, 1, 10), 0.05, 1e-3);
});

test("multiple regression recovers known coefficients; collinear inputs are refused", () => {
  const X = [], y = [];
  for (let i = 0; i < 40; i++) { const a = Math.sin(i) * 5, b = (i % 7) - 3; X.push([a, b]); y.push(1 + 2 * a - 3 * b + (i % 2 ? 0.01 : -0.01)); }
  const r = R.fitModel({ y, X, yName: "y", xNames: ["a", "b"], model: "multiple" });
  near(r.coefs[0].coef, 1, 0.01); near(r.coefs[1].coef, 2, 0.01); near(r.coefs[2].coef, -3, 0.01);
  assert.ok(r.r2 > 0.999);
  assert.throws(() => R.ols(X.map(([a]) => [a, 2 * a]), y), /collinear/);
});

test("polynomial fit reports coefficients on x itself", () => {
  const xs = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6], y = xs.map((x) => 1 + 2 * x + 3 * x * x);
  const r = R.fitModel({ y, X: xs.map((x) => [x]), xNames: ["x"], model: "poly", degree: 2 });
  near(r.coefs[0].coef, 1, 1e-6); near(r.coefs[1].coef, 2, 1e-6); near(r.coefs[2].coef, 3, 1e-6);
  assert.deepStrictEqual(r.coefs.map((c) => c.term), ["Intercept", "x", "x^2"]);
  near(R.predictFrom({ ...r, _fit: R.ols(xs.map((x) => [(x - r.poly.m) / r.poly.s, ((x - r.poly.m) / r.poly.s) ** 2]), y) }, [10]).yhat, 1 + 20 + 300, 1e-6);
});

test("predictions come with an interval around the fitted value", () => {
  const r = R.fitModel({ y: ay, X: ax.map((v) => [v]), xNames: ["x"], model: "linear" });
  const p = R.predictFrom({ ...r, _fit: R.ols(ax.map((v) => [v]), ay) }, [10]);
  near(p.yhat, 3.0001 + 0.5001 * 10, 0.01);
  assert.ok(p.lo < p.yhat && p.yhat < p.hi && p.hi - p.lo > 4 && p.hi - p.lo < 8);
});

test("held-out data is scored separately and warns when the fit breaks down", () => {
  const xs = Array.from({ length: 50 }, (_, i) => i), y = xs.map((x) => (x < 40 ? 2 * x : 200 - 3 * x)); // relationship flips at the end
  const r = R.fitModel({ y, X: xs.map((x) => [x]), xNames: ["x"], model: "linear", holdout: 0.2 });
  assert.strictEqual(r.nTrain, 40); assert.strictEqual(r.oos.n, 10);
  assert.ok(r.r2 > 0.99 && r.oos.r2 < 0);
  assert.ok(r.warnings.some((w) => /held-out/.test(w)));
});

test("pasted tables: tabs, commas, headers, $ and % signs", () => {
  const t = R.parseTable("Month\tSales\tAds\nJan\t$1,200\t5%\n1\t$1,250\t6%\n2\t$1,400\t8%\n3\t$1,500\t9%");
  assert.deepStrictEqual(t.names, ["Month", "Sales", "Ads"]);
  assert.deepStrictEqual(t.cols.Sales, [1250, 1400, 1500]); // the "Jan" row isn't numeric and is skipped
  assert.strictEqual(t.skipped, 1);
  const c = R.parseTable("1,2\n2,4.1\n3,5.9\n4,8.2");
  assert.deepStrictEqual(c.names, ["Column 1", "Column 2"]); assert.deepStrictEqual(c.cols["Column 2"], [2, 4.1, 5.9, 8.2]);
  assert.throws(() => R.parseTable("1\n2\n3"), /two columns/);
});

test("series are resampled, transformed, lagged and lined up", () => {
  const day = (y, m, d) => Date.UTC(y, m - 1, d);
  const a = [], b = [];
  for (let m = 1; m <= 24; m++) { a.push([day(2025, m, 5), 100 + m], [day(2025, m, 20), 100 + m + 0.5]); b.push([day(2025, m, 28), m * 10]); }
  const out = R.alignSeries([{ name: "A", points: a, transform: "pct", lag: 0 }, { name: "B", points: b, transform: "level", lag: 1 }], "M");
  // monthly last values: A = 100.5 + m, so the first % change is for the 2nd month; B lagged 1 month
  assert.strictEqual(out.periods[0], "2025-02");
  near(out.cols.A[0], (102.5 / 101.5 - 1) * 100, 1e-9);
  assert.strictEqual(out.cols.B[0], 10); // January's B lines up with February's A
  assert.strictEqual(out.periods.length, 23);
  assert.strictEqual(R.periodOf(day(2026, 10, 28), "Q"), "2026-Q4");
  assert.strictEqual(R.periodOf(day(2026, 10, 28), "W"), "2026-10-30"); // week ending Friday
});
