// Turns raw series into scorecard readings and 0–100 asset scores. No I/O: everything here is testable.
//
// For each indicator:
//   level L = where the latest value sits in its last 10 years (0 = lowest, 1 = highest)
//   trend T = where its 6-month change sits among all 6-month changes in that window
// Both become -1..+1, are mixed (35% level / 65% trend by default), and signed so that +1
// means "more of the factor" (stronger growth, hotter inflation, tighter credit...).
//
// For each asset, every factor's weight is split evenly across the indicators that feed it,
// so inflation having 7 indicators doesn't make it count 7 times. The weighted average is
// stretched and mapped to 0–100: 50 neutral, higher = more constructive over 6–12 months.

const DAY = 864e5;
const STALE_DAYS = { d: 10, w: 21, m: 120, q: 230 };
const DROP_DAYS = 400; // older than this, an indicator is shown but not scored

const ASSETS = [
  ["stocks", "Stocks"], ["bonds", "Bonds"], ["commodities", "Commodities"],
  ["realestate", "Real Estate"], ["crypto", "Crypto"], ["alts", "Alts"]
];

// ---------- series helpers ----------
/** Index of the last point at or before t, or -1. */
function idxAt(s, t) {
  let lo = 0, hi = s.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
const valueAt = (s, t) => { const i = idxAt(s, t); return i < 0 ? null : s[i][1]; };

/** Join two series on calendar day. */
function joinByDay(a, b, fn) {
  const m = new Map(b.map(([t, v]) => [Math.floor(t / DAY), v]));
  const out = [];
  for (const [t, v] of a) {
    const w = m.get(Math.floor(t / DAY));
    if (w != null) { const r = fn(v, w); if (Number.isFinite(r)) out.push([t, r]); }
  }
  return out;
}

/** Build one indicator's display series from the raw downloads. Returns [] if a source is missing. */
function transform(def, raw) {
  let s;
  if (def.src.startsWith("derived:")) {
    const expr = def.src.slice(8);
    if (expr.includes("/")) {
      const [a, b] = expr.split("/").map((x) => raw["yahoo:" + x]);
      if (!a || !b) return [];
      s = joinByDay(a, b, (x, y) => x / y);
    } else {
      const [a, b] = expr.split("-").map((x) => raw["fred:" + x]);
      if (!a || !b) return [];
      // the second series may not print on the same day (weekends, holidays): use its latest value
      s = a.map(([t, v]) => { const w = valueAt(b, t); return w == null ? null : [t, v - w]; }).filter(Boolean);
    }
  } else {
    s = raw[def.src];
    if (!s) return [];
  }
  if (def.scale) s = s.map(([t, v]) => [t, v * def.scale]);

  switch (def.tf) {
    case "yoy": return lagged(s, 360, (v, p) => (v / p - 1) * 100);
    case "ann3m": return lagged(s, 88, (v, p) => (Math.pow(v / p, 4) - 1) * 100);
    case "chg3": return lagged(s, 88, (v, p) => (v - p) / 3);
    case "ma200": return ma200(s);
    default: return s;
  }
}
function lagged(s, days, fn) {
  const out = [];
  for (const [t, v] of s) {
    const p = valueAt(s, t - days * DAY);
    if (p == null || p === 0) continue;
    const r = fn(v, p);
    if (Number.isFinite(r)) out.push([t, r]);
  }
  return out;
}
function ma200(s) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    sum += s[i][1];
    if (i >= 200) sum -= s[i - 200][1];
    if (i >= 199) out.push([s[i][0], (s[i][1] / (sum / 200) - 1) * 100]);
  }
  return out;
}

/** Share of values below x (ties count half). */
function pctile(vals, x) {
  if (!vals.length) return 0.5;
  let below = 0, eq = 0;
  for (const v of vals) { if (v < x) below++; else if (v === x) eq++; }
  return (below + eq / 2) / vals.length;
}

/** Level and trend readings for one series as of a date. */
function analyze(s, asOf, { horizonMonths = 6, historyYears = 10, freq = "m" } = {}) {
  const i = idxAt(s, asOf);
  if (i < 0) return null;
  const [t, v] = s[i];
  const hz = horizonMonths * 30.44 * DAY;
  const start = asOf - historyYears * 365.25 * DAY;
  const vals = [], changes = [];
  for (let j = 0; j <= i; j++) {
    const [tj, vj] = s[j];
    if (tj < start) continue;
    vals.push(vj);
    const p = valueAt(s, tj - hz);
    if (p != null && tj - hz >= s[0][0]) changes.push(vj - p);
  }
  const prior = valueAt(s, t - hz);
  const chg = prior == null ? null : v - prior;
  const age = (asOf - t) / DAY;
  return {
    t, v, prior, chg,
    L: pctile(vals, v),
    T: chg == null ? 0.5 : pctile(changes, chg),
    years: Math.round(((asOf - Math.max(start, s[0][0])) / (365.25 * DAY)) * 10) / 10, // history actually available
    stale: age > (STALE_DAYS[freq] || 120),
    dropped: age > DROP_DAYS
  };
}

// ---------- scoring ----------
function splitWeight(w, mix) {
  if (w == null || w === 0) return null;
  if (typeof w === "object") return { wl: Number(w.level) || 0, wt: Number(w.trend) || 0 };
  return { wl: w * mix, wt: w * (1 - mix) };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const toScore = (avg, stretch) => Math.round(50 + 50 * clamp(avg * stretch, -1, 1));

function label(score) {
  return score >= 70 ? "Bullish" : score >= 58 ? "Leaning bullish" : score > 42 ? "Neutral" : score > 30 ? "Leaning bearish" : "Bearish";
}

const REGIMES = {
  goldilocks: { name: "Goldilocks", text: "Growth improving, inflation cooling. Historically the best mix for stocks and credit." },
  reflation: { name: "Reflation", text: "Growth and inflation both rising. Historically good for commodities and cyclical stocks, hard on bonds." },
  stagflation: { name: "Stagflation", text: "Growth slowing while inflation rises. Historically the hardest mix for stocks and bonds; real assets hold up best." },
  slowdown: { name: "Slowdown", text: "Growth and inflation both cooling. Historically good for bonds; stocks depend on how fast the Fed eases." }
};

/**
 * Score every asset as of a date.
 * @param prepared  { id: series } from prepare()
 */
function evaluate(defs, prepared, weights, asOf = Date.now()) {
  const opts = { horizonMonths: weights.horizonMonths, historyYears: weights.historyYears };
  const ind = {};
  for (const d of defs) {
    const a = prepared[d.id]?.length ? analyze(prepared[d.id], asOf, { ...opts, freq: d.freq }) : null;
    ind[d.id] = a;
  }
  const live = defs.filter((d) => ind[d.id] && !ind[d.id].dropped);
  const perFactor = {};
  for (const d of live) perFactor[d.factor] = (perFactor[d.factor] || 0) + 1;

  // signed reading per indicator, before asset weights: +1 = more of its factor
  const reading = (d, wl, wt) => {
    const a = ind[d.id];
    return d.sign * (wl * (2 * a.L - 1) + wt * (2 * a.T - 1));
  };

  const assets = {};
  for (const [key] of ASSETS) {
    const W = weights.assets[key] || {};
    const rows = [];
    for (const d of live) {
      const sw = splitWeight(W[d.factor], d.level ?? weights.levelShare);
      if (!sw) continue;
      const n = perFactor[d.factor];
      rows.push({ id: d.id, section: d.section, c: reading(d, sw.wl, sw.wt) / n, eff: (Math.abs(sw.wl) + Math.abs(sw.wt)) / n });
    }
    const total = rows.reduce((x, r) => x + r.eff, 0) || 1;
    const avg = rows.reduce((x, r) => x + r.c, 0) / total;
    const score = toScore(avg, weights.stretch);
    const contrib = {};
    for (const r of rows) contrib[r.id] = (r.c / total) * weights.stretch * 50; // points this row adds or removes
    const sections = {};
    for (const r of rows) (sections[r.section] ||= []).push(r);
    for (const k of Object.keys(sections)) {
      const rs = sections[k];
      const e = rs.reduce((x, r) => x + r.eff, 0) || 1;
      sections[k] = toScore(rs.reduce((x, r) => x + r.c, 0) / e, weights.stretch);
    }
    const ranked = Object.entries(contrib).sort((a, b) => b[1] - a[1]);
    assets[key] = {
      score, label: label(score), sections, contrib,
      up: ranked.filter(([, p]) => p > 0.05).slice(0, 4),
      down: ranked.filter(([, p]) => p < -0.05).reverse().slice(0, 4)
    };
  }

  // regime: which way growth and inflation are heading (trend only)
  const dir = (factor) => {
    const ds = live.filter((d) => d.factor === factor);
    return ds.length ? ds.reduce((x, d) => x + d.sign * (2 * ind[d.id].T - 1), 0) / ds.length : 0;
  };
  const g = dir("growth"), inf = dir("inflation");
  const rk = g >= 0 ? (inf >= 0 ? "reflation" : "goldilocks") : (inf >= 0 ? "stagflation" : "slowdown");
  return { asOf, ind, assets, regime: { key: rk, ...REGIMES[rk], growth: g, inflation: inf } };
}

/** Transform every indicator once; evaluate() can then be run at many dates cheaply. */
function prepare(defs, raw) {
  const out = {};
  for (const d of defs) out[d.id] = transform(d, raw);
  return out;
}

/** Scores now, a month ago, three months ago, and month-end history for the last year. */
function scorecard(defs, raw, weights, now = Date.now()) {
  const prepared = prepare(defs, raw);
  const cur = evaluate(defs, prepared, weights, now);
  const history = [];
  for (let k = 12; k >= 1; k--) {
    const at = now - k * 30.44 * DAY;
    const e = evaluate(defs, prepared, weights, at);
    history.push({ t: at, scores: Object.fromEntries(ASSETS.map(([a]) => [a, e.assets[a].score])) });
  }
  history.push({ t: now, scores: Object.fromEntries(ASSETS.map(([a]) => [a, cur.assets[a].score])) });
  for (const [a] of ASSETS) {
    cur.assets[a].m1 = cur.assets[a].score - history[11].scores[a];
    cur.assets[a].m3 = cur.assets[a].score - history[9].scores[a];
  }
  return { ...cur, history, prepared };
}

/** Merge a weights file with the defaults; bad values fall back to defaults. */
function mergeWeights(defaults, user) {
  const u = user && typeof user === "object" ? user : {};
  const num = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);
  const assets = {};
  for (const [a] of ASSETS) assets[a] = u.assets && typeof u.assets[a] === "object" ? u.assets[a] : defaults.assets[a];
  return {
    horizonMonths: clamp(num(u.horizonMonths, defaults.horizonMonths), 1, 24),
    historyYears: clamp(num(u.historyYears, defaults.historyYears), 2, 10),
    levelShare: clamp(num(u.levelShare, defaults.levelShare), 0, 1),
    stretch: clamp(num(u.stretch, defaults.stretch), 0.5, 4),
    assets
  };
}

module.exports = { ASSETS, transform, analyze, evaluate, prepare, scorecard, mergeWeights, pctile, label, idxAt, valueAt };
