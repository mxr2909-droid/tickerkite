// Market heatmap: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, Notification, showStory, showPage }
//  - IPC channels must start with "markets:" (the preload only forwards those for this page)
// One year of daily bars per symbol from Yahoo's free chart endpoint, plus the full weekly history (fetched once a day,
// cached in markets-history-cache.json) for the 3Y/5Y/10Y periods and the long chart; every period is computed locally.
const yahoo = require("./data/yahoo");

const GROUPS = [
  { id: "sectors", title: "US sectors", items: [
    ["XLK", "Technology"], ["XLC", "Communication"], ["XLY", "Cons. Discretionary"], ["XLF", "Financials"],
    ["XLI", "Industrials"], ["XLV", "Health Care"], ["XLP", "Cons. Staples"], ["XLE", "Energy"],
    ["XLB", "Materials"], ["XLU", "Utilities"], ["XLRE", "Real Estate"]] },
  { id: "global", title: "Global markets", items: [
    ["^GSPC", "S&P 500", "US"], ["^IXIC", "Nasdaq", "US"], ["^RUT", "Russell 2000", "US"],
    ["^STOXX50E", "Euro Stoxx 50", "Europe"], ["^FTSE", "FTSE 100", "Europe"], ["^GDAXI", "DAX", "Europe"],
    ["^N225", "Nikkei 225", "Asia"], ["^HSI", "Hang Seng", "Asia"], ["000001.SS", "Shanghai", "Asia"], ["^BSESN", "Sensex", "Asia"],
    ["EEM", "Emerging Mkts", "EM"]] },
  // style pairs: [a, b] legs; the spread is a − b
  { id: "style", title: "Style", pairs: [
    { name: "Growth vs Value", a: ["IWF", "Growth"], b: ["IWD", "Value"] },
    { name: "Large vs Small", a: ["IWB", "Large caps"], b: ["IWM", "Small caps"] },
    { name: "Equal vs Cap weight", a: ["RSP", "Equal-wt S&P"], b: ["SPY", "Cap-wt S&P"] }] }
];
const PERIODS = ["1D", "1W", "1M", "3M", "YTD", "1Y", "3Y", "5Y", "10Y"];
const ANNUAL_YEARS = { "3Y": 3, "5Y": 5, "10Y": 10 };
const LONG_TTL = 24 * 3600 * 1000;

function symbols() {
  const out = [];
  for (const g of GROUPS) {
    for (const it of g.items || []) out.push(it[0]);
    for (const p of g.pairs || []) out.push(p.a[0], p.b[0]);
  }
  return out;
}

// ---------- pure math (tested) ----------
const ymd = (d) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

/** Clean bars from a Yahoo chart JSON: [{ t (ms, exchange-local as UTC), close, high }] ascending, nulls dropped. */
function barsFromChart(json) {
  const r = json?.chart?.result?.[0];
  if (!r || !r.timestamp) return null;
  const off = (r.meta?.gmtoffset || 0) * 1000;
  const q = r.indicators?.quote?.[0] || {};
  const bars = [];
  r.timestamp.forEach((ts, i) => {
    const c = q.close?.[i];
    if (c == null || !isFinite(c)) return;
    bars.push({ t: ts * 1000 + off, close: c, high: q.high?.[i] ?? c });
  });
  const live = r.meta?.regularMarketPrice;
  if (bars.length && live && isFinite(live)) bars[bars.length - 1].close = live;
  return { bars, name: r.meta?.shortName || r.meta?.symbol, currency: r.meta?.currency };
}

/** Last bar on or before a calendar date (yyyymmdd number), else null. */
function closeOnOrBefore(bars, target) {
  for (let i = bars.length - 1; i >= 0; i--) if (ymd(new Date(bars[i].t)) <= target) return bars[i].close;
  return null;
}

/** Same for weekly bars (stamped on the week's first day, closing ~4 days later): the last week that had ended by `target`. */
function weeklyCloseBefore(weekly, target) {
  for (let i = weekly.length - 1; i >= 0; i--) if (ymd(new Date(weekly[i].t + 4 * 86400000)) <= target) return weekly[i].close;
  return null;
}

/** Close at `target`: from daily bars when they reach back that far, else from the weekly history, else null. */
function refClose(daily, weekly, target) {
  if (ymd(new Date(daily[0].t)) <= target) return closeOnOrBefore(daily, target);
  return weekly?.length ? weeklyCloseBefore(weekly, target) : null;
}

/** Annualized return (%) from a total return (%) over `years`. */
function annualize(totalPct, years) {
  if (totalPct == null || !(years > 0) || totalPct <= -100) return null;
  return ((1 + totalPct / 100) ** (1 / years) - 1) * 100;
}

/** Returns for every period, annualized for 3Y+, the 52-week high (with date) and the distance from it.
 *  `daily` is ascending daily bars (about a year); `weekly` optional longer history ([{t, close}] ascending). */
function summarize(bars, weekly) {
  if (!bars || bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const d = new Date(last.t);
  const back = (days, months) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate() - days));
    // a month-end overflow (e.g. May 31 − 3 months) rolls forward; clamp to the last day of the target month
    if (months && x.getUTCMonth() !== ((d.getUTCMonth() - months) % 12 + 12) % 12) x.setUTCDate(0);
    return ymd(x);
  };
  const ref = {
    "1D": bars[bars.length - 2].close,
    "1W": closeOnOrBefore(bars, back(7, 0)),
    "1M": closeOnOrBefore(bars, back(0, 1)),
    "3M": closeOnOrBefore(bars, back(0, 3)),
    YTD: closeOnOrBefore(bars, d.getUTCFullYear() * 10000 + 101 - 1)
  };
  for (const [p, m] of [["1Y", 12], ["3Y", 36], ["5Y", 60], ["10Y", 120]]) ref[p] = refClose(bars, weekly, back(0, m));
  const ret = {}, ann = {};
  for (const p of PERIODS) ret[p] = ref[p] ? (last.close / ref[p] - 1) * 100 : null;
  for (const p in ANNUAL_YEARS) ann[p] = annualize(ret[p], ANNUAL_YEARS[p]);
  const yearAgo = back(0, 12);
  let hi = null;
  for (const b of bars) if (ymd(new Date(b.t)) > yearAgo) { const v = Math.max(b.high, b.close); if (!hi || v > hi.v) hi = { v, t: b.t }; }
  const firstT = Math.min(bars[0].t, weekly?.[0]?.t ?? Infinity);
  return { last: last.close, asOf: last.t, ret, ann, high52: hi.v, high52At: hi.t, fromHigh: (last.close / hi.v - 1) * 100, historyFrom: firstT };
}

/** Bars [[t, close]] for the price chart: daily for 1Y, weekly beyond, last point at the live price. */
function chartBars(daily, weekly, range, live) {
  const lastT = daily[daily.length - 1].t;
  const years = { "1Y": 1, "3Y": 3, "5Y": 5, "10Y": 10 }[range];
  let src;
  if (range === "MAX" || (years > 1 && weekly?.length)) src = weekly?.length ? weekly : daily;
  else src = daily;
  let from = 0;
  if (years) {
    const x = new Date(lastT); x.setUTCFullYear(x.getUTCFullYear() - years);
    from = x.getTime();
  }
  const out = src.filter((b) => b.t >= from && b.t < lastT).map((b) => [b.t, b.close]);
  // weekly history already covers recent weeks; end on the daily series' last bar at the live price
  out.push([lastT, live ?? daily[daily.length - 1].close]);
  return out;
}

/** Is the US cash session open right now (Mon–Fri 9:30–16:00 New York; holidays ignored)? */
function usMarketOpen(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const m = +p.hour * 60 + +p.minute;
  return m >= 570 && m < 960;
}

// ---------- fetching ----------
async function fetchDaily(sym) {
  const parsed = barsFromChart(await yahoo.chart(sym, "range=1y&interval=1d&includePrePost=false", 10000));
  if (!parsed || parsed.bars.length < 2) throw new Error("no data");
  return parsed;
}
/** Whole weekly history as compact [{t, close}] (no live-price override). */
async function fetchWeekly(sym) {
  const parsed = barsFromChart(await yahoo.chart(sym, "range=max&interval=1wk&includePrePost=false", 20000));
  return parsed ? parsed.bars.map((b) => ({ t: b.t, close: +b.close.toFixed(4) })) : null;
}

function register(ctx) {
  const { ipcMain, send, readJSON, writeJSON } = ctx;
  let state = readJSON("markets-cache.json", null) || { data: {}, errors: {}, fetchedAt: 0 };
  // history: { weekly: {sym: {at, bars}}, daily: {sym: bars} }, persisted so the long chart opens instantly
  let hist = readJSON("markets-history-cache.json", null) || { weekly: {}, daily: {} };
  let inflight = null, timer = null;

  const snapshot = () => ({ groups: GROUPS, periods: PERIODS, ...state, open: usMarketOpen() });
  const interval = () => (usMarketOpen() ? 5 : 30) * 60000;

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      const syms = symbols(), data = { ...state.data }, errors = {};
      let i = 0;
      const worker = async () => {
        while (i < syms.length) {
          const s = syms[i++];
          try {
            const parsed = await fetchDaily(s);
            const w = hist.weekly[s];
            if (!w || Date.now() - w.at > LONG_TTL) {
              try { const bars = await fetchWeekly(s); if (bars?.length) hist.weekly[s] = { at: Date.now(), bars }; } catch {}
            }
            hist.daily[s] = parsed.bars.map((b) => ({ t: b.t, close: b.close }));
            data[s] = { ...summarize(parsed.bars, hist.weekly[s]?.bars), currency: parsed.currency };
          } catch (e) { errors[s] = String(e.message || e); }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      state = { data, errors, fetchedAt: Date.now() };
      writeJSON("markets-cache.json", state);
      writeJSON("markets-history-cache.json", hist);
      send("markets:update", snapshot());
    })().finally(() => { inflight = null; schedule(); });
    return inflight;
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, Math.max(5000, state.fetchedAt + interval() - Date.now()));
  }

  // lazy: nothing is fetched until the page is first opened
  ipcMain.handle("markets:get", () => {
    if (Date.now() - state.fetchedAt > interval()) refresh(); else if (!timer) schedule();
    return snapshot();
  });
  ipcMain.handle("markets:history", (_e, sym, range) => {
    const daily = hist.daily[sym];
    if (!daily?.length || !symbols().includes(sym)) return null;
    return chartBars(daily, hist.weekly[sym]?.bars, range, state.data[sym]?.last);
  });
  ipcMain.handle("markets:refresh", async () => { await refresh(); return snapshot(); });
}

module.exports = { register, GROUPS, PERIODS, symbols, barsFromChart, summarize, chartBars, annualize, closeOnOrBefore, usMarketOpen };
