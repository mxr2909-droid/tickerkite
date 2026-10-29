// Risk monitors: main-process side. main.js calls register(ctx) once at startup.
//  - Runs every model in src/monitor-models.js through the Factor engine on startup and every 6 hours
//  - IPC: "monitors:get" (latest results); pushes "monitors:update" to every window
//  - Status per monitor: WARNING when the probability is at least 30% and at least twice its usual
//    rate; WATCH when it's 1.5× the usual rate or jumped 8+ points in a month; else NORMAL.
//  - A Mac notification when a monitor rises to WARNING, or jumps 10+ points in a month (once per month).
const MODELS = require("./monitor-models");
const { analyze } = require("./factor");

const EVERY_MS = 6 * 3600e3;

function status(p, base, d1m) {
  if (p >= Math.max(0.3, 2 * base)) return "WARNING";
  if (p >= 1.5 * base || (d1m != null && d1m >= 0.08)) return "WATCH";
  return "NORMAL";
}

/**
 * Past warnings: runs of WARNING months (a one-month dip doesn't end a run), whether the event
 * followed, and the S&P 500's return over the next 6 and 12 months from the first warning month.
 * @param hist [{ p: "YYYY-MM", prob, y }]  @param spx Map "YYYY-MM" → month-end close
 */
function episodes(hist, base, spx) {
  const st = hist.map((h, i) => status(h.prob, base, i ? h.prob - hist[i - 1].prob : null));
  const out = [];
  for (let i = 0; i < hist.length; i++) {
    if (st[i] !== "WARNING") continue;
    const last = out[out.length - 1];
    if (last && i - last.endIdx <= 2) { last.endIdx = i; continue; }
    out.push({ startIdx: i, endIdx: i });
  }
  const shift = (p, n) => { const [y, m] = p.split("-").map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
  const ret = (p, n) => { const a = spx?.get(p), b = spx?.get(shift(p, n)); return a && b ? b / a - 1 : null; };
  // months without a label are either too recent (the window hasn't passed) or skipped because the
  // event was already under way ("new cases only" models)
  let lastKnown = -1;
  hist.forEach((h, i) => { if (h.y != null) lastKnown = i; });
  return out.map(({ startIdx, endIdx }) => {
    const run = hist.slice(startIdx, endIdx + 1), known = run.filter((h) => h.y != null);
    const outcome = known.some((h) => h.y === 1) ? "hit" : endIdx > lastKnown ? "pending" : !known.length ? "during" : "false alarm";
    return {
      start: hist[startIdx].p, end: hist[endIdx].p, months: endIdx - startIdx + 1, peak: Math.max(...run.map((h) => h.prob)), outcome,
      spx6: ret(hist[startIdx].p, 6), spx12: ret(hist[startIdx].p, 12)
    };
  });
}

/** One monitor's result from a Factor analysis: today, a month and three months ago, and what drives it. */
function summarize(m, r, spx) {
  const hist = r.history;
  const at = (k) => (hist.length > k ? hist[hist.length - 1 - k].prob : null);
  const p = r.now.p, p1 = at(1), p3 = at(3);
  const d1m = p1 == null ? null : p - p1;
  return {
    id: m.id, name: m.name, short: m.short, why: m.why, quality: m.quality,
    period: r.now.period, p, lo: r.now.lo, hi: r.now.hi, base: r.base,
    d1m, d3m: p3 == null ? null : p - p3, status: status(p, r.base, d1m),
    drivers: r.pushes.slice(0, 3).map((x) => ({ name: x.name, up: x.logOdds > 0, size: Math.abs(x.logOdds), level: x.zscore >= 0 ? "high" : "low" })),
    spark: hist.slice(-36).map((h) => h.prob),
    history: hist.map((h) => [h.p, Math.round(h.prob * 1e4) / 1e4, h.y]),
    episodes: episodes(hist, r.base, spx), h: r.h, case: r.case
  };
}

function register(ctx) {
  const { ipcMain, send, readJSON, writeJSON, Notification, showPage } = ctx;
  let state = readJSON("monitors.json", { at: 0, list: [], notified: {} });
  let running = false;

  async function load(key) {
    const loader = require("./graphs").loadSeries;
    if (!loader) throw new Error("series loader not ready");
    const d = await loader(key);
    if (d?.error || !d?.points?.length) throw new Error(`${key}: ${d?.error || "no data"}`);
    return d.points;
  }

  async function refresh() {
    if (running) return;
    running = true;
    const list = [], errors = {};
    // S&P 500 month-end closes, for what the market did after each past warning
    let spx = null;
    try { spx = new Map(require("./regress").resample(await load("yahoo:^GSPC"), "M")); } catch {}
    for (const m of MODELS) {
      try {
        const [tp, ...fp] = await Promise.all([m.target.key, ...m.factors.map((f) => f.key)].map(load));
        const r = analyze({ target: { ...m.target, points: tp }, c: m.c, factors: m.factors.map((f, i) => ({ name: f.name, tf: f.tf, lag: f.lag, points: fp[i] })), ridge: m.ridge, holdout: 0 });
        list.push(summarize(m, r, spx));
      } catch (e) { errors[m.id] = String(e.message || e); }
    }
    running = false;
    const nErr = Object.keys(errors).length;
    ctx.reportHealth?.("monitors", { label: "Risk monitors", at: list.length ? Date.now() : state.at, level: !list.length ? "bad" : nErr ? "warn" : "ok",
      detail: list.length ? `${list.length} of ${MODELS.length} models${nErr ? ` · failed: ${Object.keys(errors).join(", ")}` : ""}` : `couldn't load: ${Object.values(errors)[0] || "no data"}` });
    if (!list.length) { state = { ...state, errors }; send("monitors:update", state); return; }
    alert(list);
    state = { at: Date.now(), list, errors, notified: state.notified || {} };
    writeJSON("monitors.json", state);
    send("monitors:update", state);
  }

  function alert(list) {
    if (!Notification?.isSupported?.()) return;
    const prev = Object.fromEntries((state.list || []).map((x) => [x.id, x]));
    const notified = (state.notified ||= {});
    for (const x of list) {
      const was = prev[x.id]?.status, key = `${x.id}|${x.period}`;
      const toWarning = x.status === "WARNING" && was && was !== "WARNING";
      const jump = x.d1m != null && x.d1m >= 0.1;
      if (!(toWarning || jump) || notified[key]) continue;
      notified[key] = Date.now();
      const n = new Notification({
        title: `${x.short}: ${(x.p * 100).toFixed(0)}% ${toWarning ? "· WARNING" : `· up ${(x.d1m * 100).toFixed(0)} points in a month`}`,
        body: `${x.name}. Usually ${(x.base * 100).toFixed(0)}%. Driven by ${x.drivers.filter((d) => d.up).map((d) => d.name).join(", ") || "its factors"}.`
      });
      n.on("click", () => showPage("brief"));
      n.show();
    }
    // forget notifications older than a year
    for (const k of Object.keys(notified)) if (Date.now() - notified[k] > 365 * 864e5) delete notified[k];
  }

  ipcMain.handle("monitors:get", () => state);
  ipcMain.handle("monitors:refresh", () => { refresh(); return true; });
  setTimeout(refresh, Date.now() - (state.at || 0) > EVERY_MS ? 15000 : 120000); // after the news and quotes have loaded
  setInterval(refresh, EVERY_MS);
}

module.exports = { register, status, summarize, episodes };
