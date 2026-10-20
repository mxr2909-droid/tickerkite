// Decile board (a view on the Scorecards page): main-process side. main.js calls register(ctx) once.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, Notification, showStory, showPage }
//  - IPC channels start with "board:" (the preload only forwards those for this module)
//
// The scorecard keeps 11 years of data; the board ranks against each series' full history, so it
// downloads its own copy: FRED from each series' first observation, Yahoo daily closes back to 1928.
// It's fetched the first time the board is opened, then at most once a day, and cached in
// board-cache.json as one transformed reading per month (a few hundred KB), not the raw dailies.

const { fetchText } = require("./news/fetcher");
const yahoo = require("./data/yahoo");
const { parseFredCsv } = require("./macro/data");
const { INDICATORS, sourcesFor, RECESSIONS } = require("./macro/indicators");
const { transform } = require("./macro/score");
const { toMonthly } = require("./macro/board");

const MAX_AGE_MS = 24 * 3600e3;
const YAHOO_FROM = -1325376000; // 1928-01-01 in Unix seconds; Yahoo returns from each symbol's first day

async function fredFull(id) {
  const rows = parseFredCsv(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, 40000));
  if (!rows.length) throw new Error("no data");
  return rows;
}
async function yahooFull(sym) {
  return (await yahoo.dailyCloses(sym, YAHOO_FROM, 40000)).points;
}

async function pool(jobs, n) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < jobs.length) await jobs[next++](); }));
}

const round = (v) => +v.toPrecision(5);

/** Raw downloads → { id: monthly transformed series }, recession spans [[start, end], …] in ms. */
function build(raw) {
  const series = {};
  for (const d of INDICATORS) {
    const s = toMonthly(transform(d, raw));
    if (s.length) series[d.id] = s.map(([t, v]) => [t, round(v)]);
  }
  const recessions = [];
  let open = null;
  for (const [t, v] of raw[RECESSIONS] || []) {
    if (v === 1 && open == null) open = t;
    if (v !== 1 && open != null) { recessions.push([open, t]); open = null; }
  }
  if (open != null) recessions.push([open, Date.now()]);
  return { series, recessions };
}

function register(ctx) {
  const S = { series: {}, recessions: [], fetchedAt: 0, refreshing: false, error: null, failed: [] };
  const snap = () => ({ fetchedAt: S.fetchedAt, refreshing: S.refreshing, error: S.error, failed: S.failed, series: S.series, recessions: S.recessions });

  async function refresh(force = false) {
    if (S.refreshing || (!force && Date.now() - S.fetchedAt < MAX_AGE_MS)) return;
    S.refreshing = true;
    ctx.send("board:update", { refreshing: true });
    try {
      const keys = [...new Set([RECESSIONS, ...INDICATORS.flatMap(sourcesFor)])], raw = {}, failed = [];
      await pool(keys.map((k) => async () => {
        const id = k.slice(k.indexOf(":") + 1);
        try { raw[k] = k.startsWith("fred:") ? await fredFull(id) : await yahooFull(id); } catch { failed.push(k); }
      }), 6);
      const b = build(raw);
      if (!Object.keys(b.series).length) throw new Error("couldn't download any history");
      // keep the last copy of an indicator whose download failed
      for (const [id, s] of Object.entries(S.series)) if (!b.series[id]) b.series[id] = s;
      if (!b.recessions.length) b.recessions = S.recessions;
      Object.assign(S, b, { fetchedAt: Date.now(), error: null, failed });
      ctx.writeJSON("board-cache.json", { series: S.series, recessions: S.recessions, fetchedAt: S.fetchedAt, failed });
    } catch (e) {
      S.error = String(e.message || e);
    } finally {
      S.refreshing = false;
      ctx.send("board:update", snap());
    }
  }

  const c = ctx.readJSON("board-cache.json", null);
  if (c?.series) Object.assign(S, { series: c.series, recessions: c.recessions || [], fetchedAt: c.fetchedAt || 0, failed: c.failed || [] });
  // the first request (the board being opened) starts the download if the copy is missing or old
  ctx.ipcMain.handle("board:get", () => { refresh(); return snap(); });
  ctx.ipcMain.handle("board:refresh", () => { refresh(true); return true; });
}

module.exports = { register, build };
