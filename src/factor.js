// Factor page: main-process side. main.js calls register(ctx) once at startup.
//  - IPC channels start with "factor:" (the preload only forwards those)
//  - A "case" is a yes/no event over a window: "S&P 500 falls 10%+ within 6 months", "recession
//    within 12 months". Every past month is labeled with whether the case then happened, and a
//    logistic regression on macro factors turns today's factor values into a probability.
//  - Windows overlap month to month (a 12-month case repeats the same information 12 times), so
//    standard errors are widened by √horizon. Without that, p-values look far better than they are.
const { alignSeries, resample, shape, tPValue, searchSeries } = require("./regress");

// ---------- logistic regression ----------
const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** Solve A·x = b for a small symmetric positive-definite A (Cholesky). Returns { x, inv }. */
function solveSPD(A, b) {
  const n = A.length, L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) { if (s <= 1e-12) throw new Error("The factors overlap too much (or one never changes) to fit. Remove one."); L[i][i] = Math.sqrt(s); }
    else L[i][j] = s / L[j][j];
  }
  const fwd = (v) => { const y = new Array(n); for (let i = 0; i < n; i++) { let s = v[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; } return y; };
  const back = (y) => { const x = new Array(n); for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; } return x; };
  const inv = Array.from({ length: n }, (_, j) => back(fwd(Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)))));
  return { x: back(fwd(b)), inv: inv[0].map((_, i) => inv.map((col) => col[i])) };
}

/**
 * Logistic regression by Newton–Raphson (IRLS), with a small ridge so a factor that perfectly
 * separates the outcomes still gives finite numbers.
 * @param {number[][]} X rows of factor values (no intercept)  @param {number[]} y 0/1
 */
function logit(X, y, { ridge = 1e-4, iters = 50 } = {}) {
  const n = y.length, k = (X[0]?.length || 0) + 1;
  const A = X.map((r) => [1, ...r]);
  let b = new Array(k).fill(0), cov = null, ll = 0;
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  b[0] = Math.log(Math.max(1e-6, ybar) / Math.max(1e-6, 1 - ybar));
  for (let it = 0; it < iters; it++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0)), g = new Array(k).fill(0);
    ll = 0;
    for (let i = 0; i < n; i++) {
      const z = A[i].reduce((s, v, j) => s + v * b[j], 0), p = sigmoid(z), wgt = Math.max(p * (1 - p), 1e-10);
      ll += y[i] ? Math.log(Math.max(p, 1e-15)) : Math.log(Math.max(1 - p, 1e-15));
      for (let j = 0; j < k; j++) { g[j] += (y[i] - p) * A[i][j]; for (let m = 0; m <= j; m++) H[j][m] += wgt * A[i][j] * A[i][m]; }
    }
    for (let j = 0; j < k; j++) { for (let m = 0; m < j; m++) H[m][j] = H[j][m]; if (j) { H[j][j] += ridge; g[j] -= ridge * b[j]; } }
    const { x: step, inv } = solveSPD(H, g);
    cov = inv;
    b = b.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  const ll0 = n * (ybar > 0 && ybar < 1 ? ybar * Math.log(ybar) + (1 - ybar) * Math.log(1 - ybar) : 0);
  return { b, cov, ll, ll0, pseudoR2: ll0 ? 1 - ll / ll0 : 0, prob: (row) => sigmoid([1, ...row].reduce((s, v, j) => s + v * b[j], 0)) };
}

// ---------- scoring a probability model ----------
/** Area under the ROC curve: chance a random "yes" month got a higher probability than a random "no" month. */
function auc(p, y) {
  const pos = [], neg = [];
  p.forEach((v, i) => (y[i] ? pos : neg).push(v));
  if (!pos.length || !neg.length) return null;
  const all = p.map((v, i) => [v, y[i]]).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j < all.length && all[j][0] === all[i][0]) j++;
    const r = (i + j + 1) / 2; for (let m = i; m < j; m++) if (all[m][1]) rankSum += r;
    i = j;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}
const brier = (p, y) => p.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) / p.length;
/** Predicted vs actual in probability buckets. */
function calibration(p, y, edges = [0, 0.1, 0.25, 0.5, 0.75, 1.0001]) {
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1], idx = p.map((v, j) => j).filter((j) => p[j] >= lo && p[j] < hi);
    return { lo, hi: Math.min(1, hi), n: idx.length, predicted: idx.length ? idx.reduce((s, j) => s + p[j], 0) / idx.length : null, actual: idx.length ? idx.reduce((s, j) => s + y[j], 0) / idx.length : null };
  });
}

// ---------- the case: label each month ----------
/**
 * Did the case happen in the h periods after each month?
 * @param {[string, number][]} rows monthly [period, value] of the case's series (already measured)
 * @param {{ cond: "rise"|"fall"|"above"|"below", x: number, h: number, when: "end"|"within", unit: "pct"|"pts" }} c
 * @returns {Map<string, 0|1>} only for months whose whole window is in the past
 */
function labelCase(rows, c) {
  const out = new Map(), h = Math.max(1, Math.round(c.h));
  const move = (a, b) => (c.unit === "pct" ? (a ? (b / a - 1) * 100 : 0) : b - a);
  for (let i = 0; i + h < rows.length; i++) {
    const v0 = rows[i][1], fut = rows.slice(i + 1, i + 1 + h).map((r) => r[1]);
    // "new cases only": skip months that are already in the case (e.g. already in a recession),
    // so the model learns to see it coming instead of recognizing it once it's here
    if (c.onlyNew && ((c.cond === "above" && v0 >= c.x) || (c.cond === "below" && v0 <= c.x))) continue;
    const look = c.when === "end" ? [fut[fut.length - 1]] : fut;
    let hit;
    if (c.cond === "rise") hit = look.some((v) => move(v0, v) >= c.x);
    else if (c.cond === "fall") hit = look.some((v) => move(v0, v) <= -c.x);
    else if (c.cond === "above") hit = look.some((v) => v >= c.x);
    else hit = look.some((v) => v <= c.x);
    out.set(rows[i][0], hit ? 1 : 0);
  }
  return out;
}

/** Plain-English description of a case. */
function describeCase(c, name) {
  const amt = c.unit === "pct" ? `${c.x}%` : `${c.x} point${Math.abs(c.x) === 1 ? "" : "s"}`;
  const win = c.when === "end" ? `${c.h} months from now` : `at any point within ${c.h} months`;
  const verb = { rise: `rises ${amt} or more`, fall: `falls ${amt} or more`, above: `is at or above ${c.x}`, below: `is at or below ${c.x}` }[c.cond];
  return `${name} ${verb}, ${win}${c.onlyNew ? " (new cases only)" : ""}`;
}

// ---------- presets ----------
const F = (key, name, tf, lag = 0) => ({ key, name, tf, lag });
const MONITORS = require("./monitor-models");
const PRESETS = [
  // validated monitors first (see src/monitor-models.js), then simpler examples
  ...MONITORS.map((m) => ({ ...m, name: `✓ ${m.name}` })),
  { id: "spx-drop", name: "S&P 500 falls 10%+ within 6 months (hard to predict)", target: { key: "yahoo:^GSPC", name: "S&P 500", measure: "level" }, c: { text: "The S&P 500 falls 10% or more at some point in the next 6 months", cond: "fall", x: 10, h: 6, when: "within", unit: "pct" },
    factors: [F("yahoo:^VIX", "VIX", "level"), F("fred:T10Y3M", "Yield curve (10y minus 3m)", "level"), F("fred:BAA10Y", "Corporate bond spread (Baa)", "chg3"), F("yahoo:^GSPC", "S&P 500", "pct12")] },
  { id: "spx-up", name: "S&P 500 up 10%+ over 12 months", target: { key: "yahoo:^GSPC", name: "S&P 500", measure: "level" }, c: { text: "The S&P 500 is up 10% or more 12 months from now", cond: "rise", x: 10, h: 12, when: "end", unit: "pct" },
    factors: [F("yahoo:^VIX", "VIX", "level"), F("fred:DGS10", "10-year Treasury yield", "chg12"), F("fred:BAA10Y", "Corporate bond spread (Baa)", "level"), F("fred:UNRATE", "Unemployment rate", "chg12")] },
  { id: "inflation", name: "CPI inflation above 3% in 12 months", target: { key: "fred:CPIAUCSL", name: "CPI inflation", measure: "yoy" }, c: { text: "CPI inflation is 3% or higher 12 months from now", cond: "above", x: 3, h: 12, when: "end", unit: "pts" },
    factors: [F("fred:CPIAUCSL", "CPI inflation (12-mo)", "pct12"), F("yahoo:CL=F", "Crude oil (WTI)", "pct12"), F("fred:UNRATE", "Unemployment rate", "level"), F("fred:M2SL", "M2 money supply", "pct12")] },
  { id: "yields", name: "10-year yield up 0.5+ points within 6 months", target: { key: "fred:DGS10", name: "10-year Treasury yield", measure: "level" }, c: { text: "The 10-year Treasury yield rises 0.5 points or more within 6 months", cond: "rise", x: 0.5, h: 6, when: "within", unit: "pts" },
    factors: [F("fred:CPIAUCSL", "CPI inflation (12-mo)", "pct12"), F("fred:DFF", "Fed funds rate", "chg6"), F("fred:T10Y2Y", "Yield curve (10y minus 2y)", "level"), F("yahoo:CL=F", "Crude oil (WTI)", "pct6")] },
  { id: "gold", name: "Gold up 10%+ within 6 months", target: { key: "yahoo:GC=F", name: "Gold", measure: "level" }, c: { text: "Gold rises 10% or more at some point in the next 6 months", cond: "rise", x: 10, h: 6, when: "within", unit: "pct" },
    factors: [F("fred:DFII10", "10-year real yield (TIPS)", "chg6"), F("yahoo:DX-Y.NYB", "US dollar index", "pct6"), F("fred:CPIAUCSL", "CPI inflation (12-mo)", "pct12"), F("yahoo:^VIX", "VIX", "level")] },
  { id: "oil", name: "Oil falls 20%+ within 6 months", target: { key: "yahoo:CL=F", name: "Crude oil (WTI)", measure: "level" }, c: { text: "Oil falls 20% or more at some point in the next 6 months", cond: "fall", x: 20, h: 6, when: "within", unit: "pct" },
    factors: [F("yahoo:CL=F", "Crude oil (WTI)", "pct6"), F("yahoo:DX-Y.NYB", "US dollar index", "pct6"), F("fred:INDPRO", "Industrial production", "pct12"), F("yahoo:^VIX", "VIX", "level")] }
];

// ---------- real time: what the model would have said at the time ----------
/**
 * Replay history month by month using only what was known then: a month's outcome is known once its
 * window has passed (h months later), and standardization uses training data only. Refits every
 * `every` months (expanding window). Factor values are today's revised data, not original releases.
 * @returns [{ p, prob, base }] with prob null until there's enough history (minN months, 5+ cases each way)
 */
function realtime(months, X, y, h, ridge, { every = 12, minN = 120 } = {}) {
  const out = [];
  let fit = null, mu = null, sd = null, base = null, since = -Infinity;
  for (let i = 0; i < months.length; i++) {
    if (i - since >= every || !fit) {
      const tr = []; for (let j = 0; j <= i - h; j++) if (y[j] != null) tr.push(j);
      const ev = tr.reduce((s, j) => s + y[j], 0);
      if (tr.length >= minN && ev >= 5 && tr.length - ev >= 5) {
        const k = X[0].length;
        mu = Array.from({ length: k }, (_, c) => tr.reduce((s, j) => s + X[j][c], 0) / tr.length);
        sd = Array.from({ length: k }, (_, c) => Math.sqrt(tr.reduce((s, j) => s + (X[j][c] - mu[c]) ** 2, 0) / tr.length) || 1);
        try { fit = logit(tr.map((j) => X[j].map((v, c) => (v - mu[c]) / sd[c])), tr.map((j) => y[j]), { ridge }); base = ev / tr.length; since = i; } catch { /* keep the last fit */ }
      }
    }
    out.push({ p: months[i], prob: fit ? fit.prob(X[i].map((v, c) => (v - mu[c]) / sd[c])) : null, base });
  }
  return out;
}

// ---------- the whole analysis ----------
/**
 * @param spec {{ target: { name, points, measure: "level"|"yoy" }, c, factors: [{ name, points, tf, lag }], sinceYear?, holdout? }}
 */
function analyze(spec) {
  const { target, c } = spec;
  const h = Math.max(1, Math.min(36, Math.round(c.h || 12)));
  if (!spec.factors?.length) throw new Error("Add at least one factor.");
  // the case series, monthly
  let trow = resample(target.points, "M");
  if (target.measure === "yoy") trow = shape(trow, "pct12", 0, "M");
  if (trow.length < h + 24) throw new Error(`${target.name} has too little history for a ${h}-month case.`);
  const labels = labelCase(trow, { ...c, h });

  // factors, lined up monthly (all of them, including months whose outcome isn't known yet)
  const fac = alignSeries(spec.factors.map((f) => ({ name: f.name, points: f.points, transform: f.tf, lag: f.lag || 0 })), "M");
  const names = spec.factors.map((f) => f.name);
  const sinceP = spec.sinceYear ? `${spec.sinceYear}-01` : null;
  const months = fac.periods.filter((p) => !sinceP || p >= sinceP);
  if (!months.length) throw new Error("The factors don't share any months. Try fewer or different factors.");
  const row = (p) => { const i = fac.periods.indexOf(p); return names.map((n) => fac.cols[n][i]); };
  const known = months.filter((p) => labels.has(p));
  if (known.length < 36) throw new Error(`Only ${known.length} months have both factor data and a known outcome; need at least 36. Try a longer range or other factors.`);

  // standardize factors so coefficients are per 1 standard deviation and comparable
  const X0 = known.map(row), y = known.map((p) => labels.get(p));
  const mu = names.map((_, j) => X0.reduce((s, r) => s + r[j], 0) / X0.length);
  const sd = names.map((_, j) => Math.sqrt(X0.reduce((s, r) => s + (r[j] - mu[j]) ** 2, 0) / X0.length) || 1);
  const z = (r) => r.map((v, j) => (v - mu[j]) / sd[j]);
  const Z = X0.map(z);
  const events = y.reduce((s, v) => s + v, 0);
  if (events < 5 || events > y.length - 5) throw new Error(`The case happened in ${events} of ${y.length} months: too ${events < 5 ? "rare" : "common"} to model. Loosen or tighten the condition.`);

  const ridge = Math.max(1e-4, Math.min(100, Number(spec.ridge) || 1e-4)); // shrinkage toward 0 on standardized factors
  const fit = logit(Z, y, { ridge });
  const inflate = Math.sqrt(h); // overlapping windows: about h months share each outcome
  const coefs = fit.b.map((b, j) => {
    const se = Math.sqrt(Math.max(0, fit.cov[j][j])) * inflate, zst = se ? b / se : null;
    return { term: j ? names[j - 1] : "Intercept", coef: b, se, z: zst, p: zst == null ? null : tPValue(Math.abs(zst), 1e6), oddsRatio: j ? Math.exp(b) : null };
  });

  // now: the latest month with every factor
  const lastP = months[months.length - 1], xNow = row(lastP), zNow = z(xNow);
  const linNow = [1, ...zNow].reduce((s, v, j) => s + v * fit.b[j], 0);
  let varNow = 0; const a = [1, ...zNow];
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) varNow += a[i] * fit.cov[i][j] * a[j];
  const seNow = Math.sqrt(Math.max(0, varNow)) * inflate;
  const now = { period: lastP, p: sigmoid(linNow), lo: sigmoid(linNow - 1.645 * seNow), hi: sigmoid(linNow + 1.645 * seNow), values: xNow };
  // what pushes today's probability up or down: each factor's share of the log-odds, vs the average month
  const pushes = names.map((n, j) => ({ name: n, value: xNow[j], zscore: zNow[j], logOdds: fit.b[j + 1] * zNow[j] })).sort((p, q) => Math.abs(q.logOdds) - Math.abs(p.logOdds));

  // how good is it?
  const pIn = Z.map((r) => fit.prob(r));
  const base = events / y.length;
  const score = { auc: auc(pIn, y), brier: brier(pIn, y), brierBase: base * (1 - base), pseudoR2: fit.pseudoR2 };
  score.skill = score.brierBase ? 1 - score.brier / score.brierBase : null;

  // held-out: fit on the first part, score the most recent stretch it never saw
  let oos = null;
  const ho = Math.max(0, Math.min(0.5, spec.holdout ?? 0.25)), nTest = Math.floor(known.length * ho);
  if (nTest >= 24) {
    const cut = known.length - nTest, gap = h; // leave a gap so training labels don't peek into the test window
    try {
      const f2 = logit(Z.slice(0, Math.max(0, cut - gap)), y.slice(0, Math.max(0, cut - gap)), { ridge });
      const pt = Z.slice(cut).map((r) => f2.prob(r)), yt = y.slice(cut);
      oos = { n: nTest, from: known[cut], auc: auc(pt, yt), brier: brier(pt, yt), events: yt.reduce((s, v) => s + v, 0) };
    } catch { oos = null; }
  }

  // simple splits: how often the case happened when each factor was low / middle / high
  const splits = names.map((n, j) => {
    const vals = X0.map((r) => r[j]).slice().sort((p, q) => p - q), t1 = vals[Math.floor(vals.length / 3)], t2 = vals[Math.floor((2 * vals.length) / 3)];
    const bucket = (f) => { const idx = X0.map((r, i) => i).filter((i) => f(X0[i][j])); return { n: idx.length, rate: idx.length ? idx.reduce((s, i) => s + y[i], 0) / idx.length : null }; };
    return { name: n, cut1: t1, cut2: t2, low: bucket((v) => v < t1), mid: bucket((v) => v >= t1 && v < t2), high: bucket((v) => v >= t2), nowIn: xNow[j] < t1 ? "low" : xNow[j] < t2 ? "mid" : "high" };
  });

  const warnings = [];
  if (events < 15) warnings.push(`The case happened in only ${events} months (${(base * 100).toFixed(0)}% of the time), so the estimates are rough.`);
  if (oos && oos.auc != null && score.auc != null && oos.auc < score.auc - 0.15) warnings.push(`Accuracy drops on recent years (AUC ${score.auc.toFixed(2)} fitted vs ${oos.auc.toFixed(2)} held out): the relationship may have changed.`);
  if (oos && oos.events === 0) warnings.push("The case never happened in the held-out years, so the held-out AUC can't be measured.");
  if (score.auc != null && score.auc < 0.6) warnings.push("AUC below 0.6: these factors barely separate the months when the case happened from the ones when it didn't.");

  return {
    case: c.text || describeCase({ ...c, h }, target.name), h, n: known.length, events, base, from: known[0], to: known[known.length - 1],
    ridge, onlyNew: !!c.onlyNew, coefs, now, pushes, score, oos, splits, calibration: calibration(pIn, y), warnings, names, mu, sd,
    history: months.map((p) => ({ p, prob: fit.prob(z(row(p))), y: labels.has(p) ? labels.get(p) : null })),
    realtime: spec.realtime ? (() => {
      const yAll = months.map((p) => (labels.has(p) ? labels.get(p) : null));
      const rt = realtime(months, months.map(row), yAll, h, ridge);
      const scored = rt.map((r, i) => [r.prob, yAll[i]]).filter(([pr, yy]) => pr != null && yy != null);
      return { history: rt.map((r, i) => ({ ...r, y: yAll[i] })), auc: scored.length ? auc(scored.map((x) => x[0]), scored.map((x) => x[1])) : null, from: rt.find((r) => r.prob != null)?.p || null };
    })() : null
  };
}

// ---------- IPC ----------
function register(ctx) {
  const { ipcMain } = ctx;
  ipcMain.handle("factor:search", (_e, q) => searchSeries(q));
  ipcMain.handle("factor:presets", () => PRESETS);
  ipcMain.handle("factor:analyze", (_e, spec) => { try { return { ok: true, ...analyze(spec) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
}

module.exports = { register, realtime, logit, auc, brier, calibration, labelCase, describeCase, analyze, PRESETS, sigmoid };
