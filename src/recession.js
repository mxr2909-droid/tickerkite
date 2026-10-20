// Recession model (shown on the Scorecards page): main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, Notification, showStory, showPage }
//  - IPC channels must start with "recession:" (the preload only forwards those for this module)
//  - bus emits "news" (stories), "quotes" (quotes), "scores" (scorecard result) after each refresh
//  - get() returns { stories, quotes, watch, scores } right now
//
// The classic yield-curve probit (Estrella–Mishkin, as the NY Fed publishes it):
//   P(recession in month t+12) = Φ(a + b · spread_t),  spread = 10-year minus 3-month Treasury (GS10 − TB3MS)
// fitted by maximum likelihood on every month since 1953 whose 12-month-ahead outcome (USREC) is known.
// Data: FRED's public CSV export, no key. Cached in recession-cache.json, refreshed daily.

const { fetchText } = require("./news/fetcher");
const { parseFredCsv } = require("./macro/data");

const HORIZON = 12; // months ahead
const THRESHOLD = 0.3; // probability that counts as a warning
const WINDOW = 24; // a warning counts for a recession that starts within this many months
const MAX_AGE_MS = 24 * 3600e3;
const SERIES = { gs10: "GS10", tb3ms: "TB3MS", usrec: "USREC", daily: "T10Y3M", sahm: "SAHMREALTIME" };

// ---------- math ----------
/** erfc with fractional error < 1.2e-7 everywhere (Numerical Recipes erfcc), so the tails stay accurate. */
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const Phi = (x) => 0.5 * erfc(-x / Math.SQRT2);
const phi = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Probit MLE of y ∈ {0,1} on one regressor: P(y=1) = Φ(a + b·x). Fisher scoring (Newton with the expected Hessian). */
function fitProbit(x, y, iters = 100) {
  const n = x.length;
  if (n < 3 || n !== y.length) throw new Error("not enough data to fit");
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  if (ybar <= 0 || ybar >= 1) throw new Error("outcome never varies");
  // start at the base rate with no slope
  let a = -inverseGuess(ybar), b = 0, ll = -Infinity, it = 0;
  for (; it < iters; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < n; i++) {
      const z = a + b * x[i], p = clamp(Phi(z)), d = phi(z), w = (d * d) / (p * (1 - p)), r = ((y[i] - p) * d) / (p * (1 - p));
      g0 += r; g1 += r * x[i]; h00 += w; h01 += w * x[i]; h11 += w * x[i] * x[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 0)) break;
    let da = (h11 * g0 - h01 * g1) / det, db = (h00 * g1 - h01 * g0) / det;
    // step-halve until the log-likelihood doesn't fall
    let step = 1, next;
    for (let k = 0; k < 30; k++, step /= 2) { next = logLik(a + step * da, b + step * db, x, y); if (next >= ll - 1e-12) break; }
    a += step * da; b += step * db;
    const done = Math.abs(next - ll) < 1e-10 && Math.abs(step * da) + Math.abs(step * db) < 1e-9;
    ll = next;
    if (done) break;
  }
  return { a, b, logLik: ll, n, iterations: it + 1, baseRate: ybar };
}
const clamp = (p) => Math.min(1 - 1e-12, Math.max(1e-12, p));
function logLik(a, b, x, y) {
  let s = 0;
  for (let i = 0; i < x.length; i++) { const p = clamp(Phi(a + b * x[i])); s += y[i] ? Math.log(p) : Math.log(1 - p); }
  return s;
}
// rough inverse normal (good enough for a starting point)
function inverseGuess(p) { let lo = -10, hi = 10; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (Phi(m) < 1 - p) lo = m; else hi = m; } return (lo + hi) / 2; }

// ---------- months ----------
// month index = year*12 + month0, so "12 months later" is +12
const mi = (t) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const miTime = (m) => Date.UTC(Math.floor(m / 12), m % 12, 1);
const miLabel = (m) => new Date(miTime(m)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const toMonthly = (rows) => { const out = new Map(); for (const [t, v] of rows || []) out.set(mi(t), v); return out; };

/** Recession episodes from a 0/1 monthly map: [{ start, end }] in month indexes (end = last recession month). */
function episodes(flags) {
  const ms = [...flags.keys()].sort((p, q) => p - q), out = [];
  let open = null;
  for (const m of ms) {
    if (flags.get(m) >= 0.5 && open == null) open = m;
    if (flags.get(m) < 0.5 && open != null) { out.push({ start: open, end: m - 1 }); open = null; }
  }
  if (open != null) out.push({ start: open, end: ms[ms.length - 1], ongoing: true });
  return out;
}

/**
 * Score the warnings against what happened.
 * probs: [[month, p]] sorted, p = probability (made at that month) of a recession 12 months later.
 * recs:  recession episodes (month indexes). knownTo: last month whose recession status is known.
 * A warning = a run of months with p ≥ threshold. It catches a recession that starts 0–24 months after the run begins
 * (lead = months from the first warning month to the recession's start). A run that starts during a recession is late,
 * not a false alarm; a run with no recession within 24 months is a false alarm once those 24 months have passed.
 */
function trackRecord(probs, recs, knownTo, threshold = THRESHOLD, windowM = WINDOW) {
  const runs = [];
  let open = null, last = null;
  for (const [m, p] of probs) {
    if (p >= threshold) { if (open == null || m !== last + 1) { if (open) runs.push(open); open = { start: m, end: m, peak: p }; } else { open.end = m; open.peak = Math.max(open.peak, p); } last = m; }
    else if (open) { runs.push(open); open = null; }
  }
  if (open) runs.push(open);
  const first = probs.length ? probs[0][0] : Infinity;
  // only recessions we had a fair chance to warn about: a full window of readings before the start
  const scored = recs.filter((r) => r.start - windowM >= first);
  const used = new Set();
  const recessions = scored.map((r) => {
    const run = runs.find((w) => w.start <= r.start && w.start >= r.start - windowM);
    if (run) used.add(run);
    return { start: r.start, end: r.end, caught: !!run, lead: run ? r.start - run.start : null, signal: run ? run.start : null };
  });
  const falseAlarms = [], pending = [], late = [];
  for (const w of runs) {
    if (used.has(w)) continue;
    if (recs.some((r) => w.start >= r.start && w.start <= r.end)) { late.push(w); continue; }
    if (recs.some((r) => r.start > w.start && r.start - w.start <= windowM)) continue; // first run of a pair already credited
    if (w.start + windowM > knownTo) pending.push(w); else falseAlarms.push(w);
  }
  const leads = recessions.filter((r) => r.caught).map((r) => r.lead);
  return {
    recessions, falseAlarms, pending, late,
    caught: leads.length, total: recessions.length,
    avgLead: leads.length ? leads.reduce((s, v) => s + v, 0) / leads.length : null
  };
}

/** Everything the page shows, from raw FRED rows. */
function buildModel(raw, threshold = THRESHOLD) {
  const g10 = toMonthly(raw.gs10), tb = toMonthly(raw.tb3ms), rec = toMonthly(raw.usrec);
  const spread = [...g10.keys()].filter((m) => tb.has(m)).sort((p, q) => p - q).map((m) => [m, g10.get(m) - tb.get(m)]);
  if (spread.length < 120) throw new Error("not enough spread history");
  const recMonths = [...rec.keys()];
  const knownTo = Math.max(...recMonths);
  const fitX = [], fitY = [], fitM = [];
  for (const [m, s] of spread) if (rec.has(m + HORIZON)) { fitX.push(s); fitY.push(rec.get(m + HORIZON) >= 0.5 ? 1 : 0); fitM.push(m); }
  const fit = fitProbit(fitX, fitY);
  const prob = (s) => Phi(fit.a + fit.b * s);
  const probs = spread.map(([m, s]) => [m, prob(s)]);
  const recs = episodes(rec).filter((r) => r.end >= spread[0][0]);
  const tr = trackRecord(probs, recs, knownTo, threshold);

  // latest reading: the monthly average, or the last 30 days of the daily series if that runs later
  const [lm, ls] = spread[spread.length - 1];
  let latest = { source: "monthly", series: "GS10 − TB3MS", month: lm, asOf: miTime(lm), spread: ls, p: prob(ls) };
  const daily = raw.daily || [];
  if (daily.length) {
    const dt = daily[daily.length - 1][0];
    if (mi(dt) > lm) {
      const win = daily.filter(([t]) => t > dt - 30 * 86400e3).map(([, v]) => v);
      const s = win.reduce((a, v) => a + v, 0) / win.length;
      latest = { source: "daily", series: "T10Y3M", asOf: dt, days: win.length, spread: s, p: prob(s), monthly: { month: lm, spread: ls, p: prob(ls) } };
    }
  }
  latest.target = miLabel(mi(latest.asOf) + HORIZON);

  const sahmRows = raw.sahm || [];
  let sahm = null;
  if (sahmRows.length) {
    const [t, v] = sahmRows[sahmRows.length - 1];
    let lastTrig = null, prevBelow = true;
    for (const [tt, vv] of sahmRows) { if (vv >= 0.5 && prevBelow) lastTrig = tt; prevBelow = vv < 0.5; }
    sahm = { v, asOf: t, triggered: v >= 0.5, lastTrigger: lastTrig, history: sahmRows.filter(([tt]) => tt >= miTime(spread[0][0])).map(([tt, vv]) => [mi(tt), vv]) };
  }

  const lbl = (w) => ({ start: miLabel(w.start), end: miLabel(w.end), peak: w.peak });
  return {
    threshold, horizon: HORIZON, window: WINDOW,
    fit: { a: fit.a, b: fit.b, n: fit.n, logLik: fit.logLik, from: miLabel(fitM[0]), to: miLabel(fitM[fitM.length - 1]), outcomesTo: miLabel(knownTo) },
    baseRate: fit.baseRate,
    latest: { ...latest, monthLabel: miLabel(mi(latest.asOf)) },
    track: {
      caught: tr.caught, total: tr.total, avgLead: tr.avgLead,
      recessions: tr.recessions.map((r) => ({ start: miLabel(r.start), end: miLabel(r.end), caught: r.caught, lead: r.lead, signal: r.signal == null ? null : miLabel(r.signal) })),
      falseAlarms: tr.falseAlarms.map(lbl), pending: tr.pending.map(lbl), late: tr.late.map(lbl)
    },
    // chart data in epoch ms
    probs: probs.map(([m, p]) => [miTime(m), +p.toFixed(4)]),
    spread: spread.map(([m, s]) => [miTime(m), +s.toFixed(2)]),
    recessions: recs.map((r) => [miTime(r.start), miTime(r.end + 1)]),
    sahm
  };
}

// ---------- data + IPC ----------
async function fred(id) {
  const rows = parseFredCsv(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=1953-01-01`, 30000));
  if (!rows.length) throw new Error(id + ": no data");
  return rows;
}

function register(ctx) {
  const S = { raw: null, fetchedAt: 0, model: null, error: null, refreshing: false };
  const snap = () => ({ fetchedAt: S.fetchedAt, refreshing: S.refreshing, error: S.error, model: S.model });
  const compute = () => { try { S.model = buildModel(S.raw); S.error = null; } catch (e) { S.error = String(e.message || e); } };

  async function refresh(force = false) {
    if (S.refreshing || (!force && Date.now() - S.fetchedAt < MAX_AGE_MS)) return snap();
    S.refreshing = true;
    ctx.send("recession:update", snap());
    try {
      const keys = Object.keys(SERIES), got = await Promise.allSettled(keys.map((k) => fred(SERIES[k])));
      const raw = { ...(S.raw || {}) };
      keys.forEach((k, i) => { if (got[i].status === "fulfilled") raw[k] = got[i].value; });
      if (!raw.gs10 || !raw.tb3ms || !raw.usrec) throw new Error("couldn't download the Treasury or recession series from FRED");
      S.raw = raw; S.fetchedAt = Date.now();
      ctx.writeJSON("recession-cache.json", { raw, fetchedAt: S.fetchedAt });
      compute();
    } catch (e) {
      S.error = String(e.message || e);
    } finally {
      S.refreshing = false;
      ctx.send("recession:update", snap());
    }
    return snap();
  }

  const c = ctx.readJSON("recession-cache.json", null);
  if (c?.raw) { S.raw = c.raw; S.fetchedAt = c.fetchedAt || 0; compute(); }
  ctx.ipcMain.handle("recession:get", () => snap());
  ctx.ipcMain.handle("recession:refresh", () => refresh(true));
  setTimeout(() => refresh(), 6000);
  setInterval(() => refresh(), 3600e3);
}

module.exports = { register, fitProbit, trackRecord, episodes, buildModel, Phi };
