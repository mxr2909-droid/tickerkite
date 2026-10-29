// Regression page: main-process side. main.js calls register(ctx) once at startup.
//  - IPC channels start with "regress:" (the preload only forwards those)
//  - Data comes from two places: market/economic series (aligned here to one frequency) or a table
//    the user pastes or types. Either way the page ends up with named columns of numbers.
//  - Models: simple linear (one x), multiple linear, polynomial (one x, degree 2–4), all ordinary
//    least squares. No dependencies: the small linear algebra and t/F distributions are below.

// ---------- distributions ----------
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const ci of c) s += ci / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}
/** Regularized incomplete beta I_x(a, b), by continued fraction. */
function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (x, a, b) => {
    let c = 1, d = 1 - ((a + b) * x) / (a + 1);
    d = Math.abs(d) < 1e-30 ? 1e-30 : d; d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
      d = 1 + aa * d; d = Math.abs(d) < 1e-30 ? 1e-30 : d; c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c; d = 1 / d; h *= d * c;
      aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
      d = 1 + aa * d; d = Math.abs(d) < 1e-30 ? 1e-30 : d; c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c; d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-14) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (bt * cf(x, a, b)) / a : 1 - (bt * cf(1 - x, b, a)) / b;
}
/** Two-sided p-value for a t statistic with df degrees of freedom. */
const tPValue = (t, df) => ibeta(df / (df + t * t), df / 2, 0.5);
/** Upper-tail p-value for an F statistic. */
const fPValue = (f, d1, d2) => (f <= 0 ? 1 : ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2));
/** t value with two-sided tail probability alpha (e.g. 0.05 → 1.96 for large df). */
function tCrit(alpha, df) {
  let lo = 0, hi = 1000;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (tPValue(mid, df) > alpha) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// ---------- least squares ----------
/** QR by modified Gram–Schmidt: returns { Q (n×k), R (k×k) } or throws if columns are collinear. */
function qr(X) {
  const n = X.length, k = X[0].length;
  const Q = X.map((r) => r.slice()), R = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < j; i++) {
      let d = 0; for (let r = 0; r < n; r++) d += Q[r][i] * Q[r][j];
      R[i][j] = d; for (let r = 0; r < n; r++) Q[r][j] -= d * Q[r][i];
    }
    let nrm = 0; for (let r = 0; r < n; r++) nrm += Q[r][j] * Q[r][j];
    nrm = Math.sqrt(nrm);
    const scale = Math.sqrt(X.reduce((s, row) => s + row[j] * row[j], 0)) || 1;
    if (nrm < 1e-10 * scale) throw new Error("Two or more inputs carry the same information (perfectly collinear). Remove one.");
    R[j][j] = nrm; for (let r = 0; r < n; r++) Q[r][j] /= nrm;
  }
  return { Q, R };
}
/** Inverse of an upper-triangular matrix. */
function invUpper(R) {
  const k = R.length, Ri = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = k - 1; i >= 0; i--) {
    Ri[i][i] = 1 / R[i][i];
    for (let j = i + 1; j < k; j++) { let s = 0; for (let m = i + 1; m <= j; m++) s += R[i][m] * Ri[m][j]; Ri[i][j] = -s / R[i][i]; }
  }
  return Ri;
}

/**
 * Ordinary least squares with an intercept.
 * @param {number[][]} X rows of predictor values (no intercept column)
 * @param {number[]} y
 * @returns coefficients (intercept first) with SE, t, p; R², adjusted R², F test, RMSE, fitted, residuals,
 *          and the (X'X)⁻¹ matrix used for prediction intervals.
 */
function ols(X, y, names = []) {
  const n = y.length, p = X[0]?.length || 0, k = p + 1;
  if (n !== X.length) throw new Error("x and y have different lengths");
  if (n < k + 2) throw new Error(`Need at least ${k + 2} observations for ${p} input${p === 1 ? "" : "s"} (have ${n}).`);
  const A = X.map((r) => [1, ...r]);
  const { Q, R } = qr(A);
  const qty = new Array(k).fill(0);
  for (let j = 0; j < k; j++) for (let r = 0; r < n; r++) qty[j] += Q[r][j] * y[r];
  const Ri = invUpper(R);
  const beta = new Array(k).fill(0);
  for (let i = 0; i < k; i++) for (let j = i; j < k; j++) beta[i] += Ri[i][j] * qty[j];
  const xtxInv = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => { let s = 0; for (let m = Math.max(i, j); m < k; m++) s += Ri[i][m] * Ri[j][m]; return s; }));
  const fitted = A.map((r) => r.reduce((s, v, j) => s + v * beta[j], 0));
  const resid = y.map((v, i) => v - fitted[i]);
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const sse = resid.reduce((s, e) => s + e * e, 0), sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  const df = n - k, s2 = sse / df;
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  const adjR2 = 1 - (1 - r2) * (n - 1) / df;
  const F = p > 0 && sse > 0 ? ((sst - sse) / p) / s2 : null;
  const coefs = beta.map((b, i) => {
    const se = Math.sqrt(Math.max(0, s2 * xtxInv[i][i])), t = se > 0 ? b / se : null;
    return { term: i === 0 ? "Intercept" : names[i - 1] || `x${i}`, coef: b, se, t, p: t == null ? null : tPValue(Math.abs(t), df) };
  });
  return {
    n, k, df, coefs, r2, adjR2, rmse: Math.sqrt(sse / n), se: Math.sqrt(s2), sse, sst,
    F, Fp: F == null ? null : fPValue(F, p, df), fitted, resid, xtxInv
  };
}

/** Predicted y and a 95% prediction interval for one new row of predictor values. */
function predict(fit, x, level = 0.95) {
  const a = [1, ...x];
  const yhat = a.reduce((s, v, j) => s + v * fit.coefs[j].coef, 0);
  let q = 0; for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) q += a[i] * fit.xtxInv[i][j] * a[j];
  const tc = tCrit(1 - level, fit.df), half = tc * fit.se * Math.sqrt(1 + q);
  return { yhat, lo: yhat - half, hi: yhat + half, level };
}

/** Variance inflation factor of each predictor: how much it overlaps with the others (above 10 = trouble). */
function vif(X) {
  const p = X[0]?.length || 0;
  if (p < 2) return [];
  return Array.from({ length: p }, (_, j) => {
    try { const r = ols(X.map((row) => row.filter((_, i) => i !== j)), X.map((row) => row[j])); return r.r2 >= 1 ? Infinity : 1 / (1 - r.r2); }
    catch { return Infinity; }
  });
}

/** Expand a polynomial in z = (x − m)/s back into powers of x: returns coefficients c0..cd of x^0..x^d. */
function unscalePoly(b, m, s) {
  const d = b.length - 1, out = new Array(d + 1).fill(0);
  const choose = (n, r) => { let c = 1; for (let i = 1; i <= r; i++) c = (c * (n - r + i)) / i; return c; };
  for (let j = 0; j <= d; j++) for (let i = 0; i <= j; i++) out[i] += b[j] * choose(j, i) * Math.pow(-m, j - i) / Math.pow(s, j);
  return out;
}

/**
 * Fit one of the three models.
 * @param {{ y:number[], X:number[][], yName:string, xNames:string[], model:"linear"|"multiple"|"poly", degree?:number, holdout?:number }} spec
 */
function fitModel(spec) {
  const { y, yName = "y", model = "linear" } = spec;
  let X = spec.X, xNames = spec.xNames || [];
  if (!y?.length || !X?.length) throw new Error("No data to fit.");
  if (model === "linear" || model === "poly") { X = X.map((r) => [r[0]]); xNames = [xNames[0] || "x"]; }
  const warnings = [];
  let design = X, names = xNames, poly = null;
  if (model === "poly") {
    const d = Math.max(2, Math.min(4, Math.round(spec.degree || 2)));
    const xs = X.map((r) => r[0]), m = xs.reduce((a, v) => a + v, 0) / xs.length;
    const s = Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / xs.length) || 1;
    // fit on the standardized x so x³ and x⁴ don't swamp the numbers, then convert back
    design = xs.map((v) => Array.from({ length: d }, (_, j) => ((v - m) / s) ** (j + 1)));
    names = Array.from({ length: d }, (_, j) => (j === 0 ? xNames[0] : `${xNames[0]}^${j + 1}`));
    poly = { degree: d, m, s };
  }

  // out-of-sample check: fit on the first part, score the last part (data stays in order, so for
  // time series this is "fit on the past, test on the most recent stretch")
  const h = Math.max(0, Math.min(0.5, spec.holdout || 0));
  const nTest = Math.floor(y.length * h);
  const nTrain = y.length - nTest;
  const fit = ols(design.slice(0, nTrain), y.slice(0, nTrain), names);
  let oos = null;
  if (nTest >= 3) {
    const yt = y.slice(nTrain), pred = design.slice(nTrain).map((r) => r.reduce((a, v, j) => a + v * fit.coefs[j + 1].coef, fit.coefs[0].coef));
    const mean = yt.reduce((a, v) => a + v, 0) / yt.length;
    const sse = yt.reduce((a, v, i) => a + (v - pred[i]) ** 2, 0), sst = yt.reduce((a, v) => a + (v - mean) ** 2, 0);
    oos = { n: nTest, r2: sst > 0 ? 1 - sse / sst : null, rmse: Math.sqrt(sse / nTest), pred };
    if (oos.r2 != null && oos.r2 < fit.r2 - 0.3) warnings.push(`R² falls from ${fit.r2.toFixed(2)} in the fitted period to ${oos.r2.toFixed(2)} on the held-out data: the relationship may not hold up.`);
  }

  let coefs = fit.coefs, equation;
  if (poly) {
    // report the curve in terms of x itself; standard errors stay on the standardized scale, so leave them out
    const c = unscalePoly(fit.coefs.map((x) => x.coef), poly.m, poly.s);
    coefs = c.map((v, i) => ({ term: i === 0 ? "Intercept" : i === 1 ? xNames[0] : `${xNames[0]}^${i}`, coef: v, se: null, t: fit.coefs[i].t, p: fit.coefs[i].p }));
    equation = { y: yName, terms: c.map((v, i) => ({ coef: v, x: i === 0 ? null : i === 1 ? xNames[0] : `${xNames[0]}^${i}` })) };
  } else {
    equation = { y: yName, terms: coefs.map((x, i) => ({ coef: x.coef, x: i === 0 ? null : names[i - 1] })) };
  }

  const v = model === "multiple" ? vif(X.slice(0, nTrain)) : [];
  v.forEach((val, i) => { if (val > 10) warnings.push(`${xNames[i]} overlaps heavily with the other inputs (VIF ${Number.isFinite(val) ? val.toFixed(0) : "∞"}), so its coefficient is unreliable.`); });
  if (fit.n < 30) warnings.push(`Only ${fit.n} observations: treat the results as rough.`);
  if (spec.levels) warnings.push("At least one series is a price or level. Trending levels often show a high R² that means nothing (both just rise over time). Try % change or year-over-year.");
  const sig = coefs.slice(1).filter((c) => c.p != null && c.p < 0.05).length;

  return {
    model, degree: poly?.degree || null, n: fit.n, df: fit.df, r2: fit.r2, adjR2: fit.adjR2, rmse: fit.rmse, se: fit.se,
    F: fit.F, Fp: fit.Fp, coefs, equation, oos, warnings, significant: sig,
    vif: v, fitted: fit.fitted, resid: fit.resid, nTrain, poly, xNames, names,
    _fit: fit // kept in main only, for predictions
  };
}

/** Predict y for user-entered x values (one per input; polynomials take just x). */
function predictFrom(result, xs) {
  let row = xs.map(Number);
  if (row.some((v) => !Number.isFinite(v))) throw new Error("Enter a number for every input.");
  if (result.poly) { const z = (row[0] - result.poly.m) / result.poly.s; row = Array.from({ length: result.poly.degree }, (_, j) => z ** (j + 1)); }
  return predict(result._fit, row);
}

// ---------- data ----------
/** A pasted or typed table → { names, cols: { name: number[] }, rows, skipped }. Header row optional. */
function parseTable(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Paste or type some numbers first.");
  // separator: tab (pasted from Excel or Sheets), then semicolon, then comma, then spaces
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : lines[0].includes(",") ? "," : /\s+/;
  const split = (l) => l.split(sep).map((c) => c.trim());
  // "$1,250" and "4.5%" count as numbers; thousands commas only when comma isn't the separator
  const num = (c) => { let s = c.replace(/[$%€£\s]/g, ""); if (sep !== ",") s = s.replace(/,(?=\d{3}(\D|$))/g, ""); return s !== "" && Number.isFinite(Number(s)) ? Number(s) : null; };
  const first = split(lines[0]);
  const header = first.some((c) => c && num(c) == null);
  const width = Math.max(...lines.map((l) => split(l).length));
  const names = Array.from({ length: width }, (_, i) => (header && first[i]) || `Column ${i + 1}`);
  const cols = Object.fromEntries(names.map((n) => [n, []]));
  let rows = 0, skipped = 0;
  for (const l of lines.slice(header ? 1 : 0)) {
    const cells = split(l).map(num);
    if (cells.length < 2 || cells.some((v) => v == null)) { skipped++; continue; }
    names.forEach((n, i) => cols[n].push(cells[i] ?? null));
    rows++;
  }
  if (width < 2) throw new Error("Need at least two columns (one y and one x).");
  if (rows < 3) throw new Error("Need at least 3 complete rows of numbers.");
  return { names, cols, rows, skipped };
}

const PER_YEAR = { D: 252, W: 52, M: 12, Q: 4 };
/** Period label a timestamp falls in at a given frequency (daily, weekly ending Friday, monthly, quarterly). */
function periodOf(t, f) {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (f === "Q") return `${y}-Q${Math.floor(m / 3) + 1}`;
  if (f === "M") return `${y}-${String(m + 1).padStart(2, "0")}`;
  if (f === "W") { const e = new Date(Date.UTC(y, m, d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7))); return e.toISOString().slice(0, 10); }
  return d.toISOString().slice(0, 10);
}
/** Last value in each period → [[period, value]], oldest first. */
function resample(points, f) {
  const by = new Map();
  for (const [t, v] of points) if (Number.isFinite(v)) by.set(periodOf(t, f), v);
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
/** Apply a transform and lag to a resampled series. */
function shape(rows, transform, lag, f) {
  const k = PER_YEAR[f] || 12;
  let out;
  switch (transform) {
    case "pct": out = rows.map(([p, v], i) => [p, i && rows[i - 1][1] ? (v / rows[i - 1][1] - 1) * 100 : null]); break;
    case "yoy": out = rows.map(([p, v], i) => [p, i >= k && rows[i - k][1] ? (v / rows[i - k][1] - 1) * 100 : null]); break;
    case "diff": out = rows.map(([p, v], i) => [p, i ? v - rows[i - 1][1] : null]); break;
    case "log": out = rows.map(([p, v]) => [p, v > 0 ? Math.log(v) : null]); break;
    default: out = rows.map(([p, v]) => [p, v]);
  }
  const L = Math.max(0, Math.min(36, Math.round(lag || 0)));
  if (L) out = out.map(([p], i) => [p, i >= L ? out[i - L][1] : null]); // x from L periods earlier lines up with today's y
  return out.filter(([, v]) => v != null && Number.isFinite(v));
}
/**
 * Line up several series on shared periods.
 * @param {{ name:string, points:[number,number][], transform:string, lag:number }[]} list (y first)
 * @returns {{ periods:string[], cols: Object<string, number[]> }}
 */
function alignSeries(list, f = "M", sinceMs = null) {
  const shaped = list.map((s) => new Map(shape(resample(sinceMs ? s.points.filter(([t]) => t >= sinceMs) : s.points, f), s.transform, s.lag, f)));
  const periods = [...shaped[0].keys()].filter((p) => shaped.every((m) => m.has(p)));
  return { periods, cols: Object.fromEntries(list.map((s, i) => [s.name, periods.map((p) => shaped[i].get(p))])) };
}

// ---------- IPC ----------
function register(ctx) {
  const { ipcMain } = ctx;
  let last = null; // latest fit, kept for predictions
  ipcMain.handle("regress:parse", (_e, text) => { try { return { ok: true, ...parseTable(text) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle("regress:align", (_e, list, f, sinceMs) => { try { return { ok: true, ...alignSeries(list, f, sinceMs) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle("regress:fit", (_e, spec) => {
    try { last = fitModel(spec); const { _fit, ...out } = last; return { ok: true, ...out }; }
    catch (e) { last = null; return { ok: false, error: e.message }; }
  });
  ipcMain.handle("regress:predict", (_e, xs) => {
    if (!last) return { ok: false, error: "Fit a model first." };
    try { return { ok: true, ...predictFrom(last, xs) }; } catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = { register, ols, fitModel, predict, predictFrom, vif, parseTable, alignSeries, resample, shape, periodOf, tPValue, fPValue, tCrit, unscalePoly };
