// Data-release alerts: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, readJSON, writeJSON, bus, Notification, showPage, expose, prefs() }
//  - IPC channels must start with "releases:" (the preload only forwards those)
//  - publishes ctx.expose.releases() (the log, newest first) for the Brief and the Calendar
//
// calendar.js re-reads today's Nasdaq rows every minute while an important release is due, and puts every row
// whose actual has just appeared on the bus as "release" (one event per batch). This module:
//  1. alerts right away with the number against the forecast ("CPI 0.4% vs 0.3% expected"), and
//  2. measures how markets moved in the first five minutes from Yahoo's 1-minute bars, then alerts with that too.
// Yahoo's futures bars run about 10 minutes behind, so the reaction is read ~16 minutes after the release.
// Everything is logged in userData/releases.json so the Brief and the Calendar can show it later.
const yahoo = require("./data/yahoo");
const NQ = require("./calendar-nasdaq");

const WINDOW_MIN = 5;
const FIRST_LOOK_MS = 16 * 60e3;
const RETRY_MS = 3 * 60e3;
const MAX_TRIES = 6;
const MAX_LOG = 150;

// [Yahoo symbol, label, "pct" (percent change) or "bp" (yield change in basis points)]
const SPX = ["ES=F", "S&P futures", "pct"], DXY = ["DX-Y.NYB", "Dollar", "pct"];
const BASKETS = {
  US: [SPX, ["10Y=F", "10Y yield", "bp"], DXY, ["GC=F", "Gold", "pct"]],
  EZ: [["EURUSD=X", "EUR/USD", "pct"], ["^STOXX50E", "Euro Stoxx", "pct"], SPX],
  GB: [["GBPUSD=X", "GBP/USD", "pct"], ["^FTSE", "FTSE 100", "pct"]],
  JP: [["JPY=X", "USD/JPY", "pct"], ["^N225", "Nikkei", "pct"]],
  CA: [["CAD=X", "USD/CAD", "pct"], SPX],
  AU: [["AUDUSD=X", "AUD/USD", "pct"]],
  NZ: [["NZDUSD=X", "NZD/USD", "pct"]],
  CH: [["CHF=X", "USD/CHF", "pct"]],
  CN: [["CNY=X", "USD/CNY", "pct"], ["^HSI", "Hang Seng", "pct"]]
};
const EURO = new Set(["EZ", "DE", "FR", "IT", "ES", "NL", "BE", "AT", "IE", "PT", "GR", "FI"]);
const basketFor = (code) => BASKETS[code] || (EURO.has(code) ? BASKETS.EZ : [SPX, DXY]);

/** Which newly printed rows deserve an alert: every high-importance US release, plus the big ones elsewhere in the G10. */
const BIG_ABROAD = /\b(cpi|hicp|gdp|interest rate decision|unemployment rate|employment change)\b/i;
function worthAlert(r) {
  return !!r && !!r.actual && r.rel >= 3 && (r.code === "US" || (r.g10 && BIG_ABROAD.test(r.name)));
}

/** One printed row → { name, actual, survey, prior, surprise ("+0.1%" or ""), dir (1 above / -1 below / 0) }. */
function item(r) {
  const s = NQ.surprise(r.actual, r.survey);
  return { name: r.name, actual: r.actual, survey: r.survey || "", prior: r.previous || r.prior || "", surprise: s ? NQ.fmtNum(s, true) : "", dir: s ? Math.sign(s.v) : 0 };
}

/** Rows released together (same country, same minute) become one alert. */
function group(rows) {
  const by = new Map();
  for (const r of rows.filter(worthAlert)) {
    const id = `${r.code}:${r.t}`;
    if (!by.has(id)) by.set(id, { id, t: r.t, code: r.code, flag: r.flag, country: r.country, keys: [], items: [], reaction: null, status: "pending", tries: 0 });
    const g = by.get(id);
    g.keys.push(r.key); g.items.push(item(r));
  }
  return [...by.values()];
}

const signed = (v, d) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
function fmtMove(m) { return m.unit === "bp" ? `${signed(m.v, 0)}bp` : `${signed(m.v, 2)}%`; }

/** "CPI 0.4% vs 0.3% expected" lines for a notification. */
function itemLine(i) {
  if (!i.survey) return `${i.name} ${i.actual}${i.prior ? ` (prior ${i.prior})` : ""}`;
  const word = i.dir > 0 ? "above" : i.dir < 0 ? "below" : "in line with";
  return i.dir ? `${i.name} ${i.actual} vs ${i.survey} expected (${word})` : `${i.name} ${i.actual}, in line with ${i.survey} expected`;
}
const reactionLine = (moves) => moves.map((m) => `${m.label} ${fmtMove(m)}`).join(" · ");

/** 1-minute bars [{ t (bar start, ms), c }] → move over the first `min` minutes after t, or null if the bars don't cover it.
 *  Thin markets skip minutes with no trades, and Yahoo stamps some bars a second late, so bars are floored to the minute,
 *  "before" is the last close before t, "after" the last close inside the window, and the window counts as covered
 *  once any bar reaches its final minute. */
function reaction(bars, t, min = WINDOW_MIN, unit = "pct") {
  const start = (b) => Math.floor(b.t / 60e3) * 60e3, stop = t + min * 60e3;
  const before = [...bars].reverse().find((b) => start(b) < t && t - start(b) <= 45 * 60e3);
  const after = [...bars].reverse().find((b) => start(b) >= t && start(b) < stop);
  if (!before || !after || !bars.some((b) => start(b) >= stop - 60e3)) return null;
  const v = unit === "bp" ? (after.c - before.c) * 100 : (after.c / before.c - 1) * 100;
  return { v: +v.toFixed(unit === "bp" ? 1 : 3), unit, from: before.c, to: after.c };
}

/** Yahoo chart JSON → [{ t, c }] (timestamps are UTC epoch seconds there). */
function barsFrom(json) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp || [], c = r?.indicators?.quote?.[0]?.close || [];
  return ts.map((s, i) => ({ t: s * 1000, c: c[i] })).filter((b) => b.c != null && isFinite(b.c));
}

async function measure(alert) {
  const p1 = Math.floor((alert.t - 50 * 60e3) / 1000), p2 = Math.floor((alert.t + 40 * 60e3) / 1000);
  const moves = [];
  let covered = 0;
  const basket = basketFor(alert.code);
  await Promise.all(basket.map(async ([sym, label, unit]) => {
    try {
      const json = await yahoo.chart(sym, { period1: p1, period2: p2, interval: "1m", includePrePost: true }, 10000);
      const m = reaction(barsFrom(json), alert.t, WINDOW_MIN, unit);
      if (m) { moves.push({ sym, label, ...m }); covered++; }
    } catch {}
  }));
  return { moves: basket.map(([sym]) => moves.find((m) => m.sym === sym)).filter(Boolean), covered, of: basket.length };
}

// ---------- wiring ----------
function register(ctx) {
  let log = ctx.readJSON("releases.json", []);
  if (!Array.isArray(log)) log = [];
  const save = () => { if (log.length > MAX_LOG) log = log.slice(-MAX_LOG); ctx.writeJSON("releases.json", log); };
  const list = () => [...log].sort((a, b) => b.t - a.t);
  const push = () => ctx.send("releases:update", list());
  const enabled = () => ctx.prefs().releaseAlerts !== false;

  function notify(title, body) {
    if (!enabled() || !ctx.Notification?.isSupported?.()) return;
    const n = new ctx.Notification({ title, body, silent: false, tk: { kind: "release", page: "calendar" } });
    n.on("click", () => ctx.showPage("calendar"));
    n.show();
  }
  const titleOf = (a) => `${a.flag || ""} ${a.items.map((i) => i.name.replace(/ \(\d\)$/, "")).filter((x, i, xs) => xs.indexOf(x) === i).slice(0, 3).join(", ")}`.trim();

  function schedule(a) {
    const wait = Math.max(5e3, a.t + FIRST_LOOK_MS - Date.now()) + (a.tries ? RETRY_MS : 0);
    setTimeout(() => check(a.id), wait);
  }
  async function check(id) {
    const a = log.find((x) => x.id === id);
    if (!a || a.status !== "pending") return;
    a.tries++;
    const r = await measure(a);
    if (r.covered === r.of || (r.covered && a.tries >= 2) || a.tries >= MAX_TRIES) {
      a.reaction = r.moves; a.status = r.moves.length ? "done" : "none"; a.measuredAt = Date.now();
      save(); push();
      if (r.moves.length) notify(`${titleOf(a)}: market reaction`, `${reactionLine(r.moves)} in the first ${WINDOW_MIN} min`);
    } else { save(); schedule(a); }
  }

  ctx.bus.on("release", (rows) => {
    for (const a of group(rows || [])) {
      if (log.some((x) => x.id === a.id)) continue;
      a.at = Date.now();
      log.push(a);
      notify(titleOf(a), a.items.slice(0, 3).map(itemLine).join("\n"));
      schedule(a);
    }
    save(); push();
  });

  // reactions still owed from before a quit: Yahoo keeps 1-minute bars for days, so finish them
  for (const a of log) if (a.status === "pending" && Date.now() - a.t < 5 * 864e5) setTimeout(() => check(a.id), 20e3);

  ctx.ipcMain.handle("releases:list", () => list());
  ctx.expose.releases = list;
}

module.exports = { register, group, item, itemLine, reaction, reactionLine, barsFrom, basketFor, worthAlert, fmtMove, measure };
