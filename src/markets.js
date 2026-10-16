// Market heatmap: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, Notification, showStory, showPage }
//  - IPC channels must start with "markets:" (the preload only forwards those for this page)
// One year of daily bars per symbol from Yahoo's free chart endpoint; every period is computed locally.
const { fetchText } = require("./news/fetcher");

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
const PERIODS = ["1D", "1W", "1M", "3M", "YTD"];

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

/** Returns for every period, 52-week high and the distance from it, from ascending daily bars. */
function summarize(bars) {
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
  const ret = {};
  for (const p of PERIODS) ret[p] = ref[p] ? (last.close / ref[p] - 1) * 100 : null;
  const yearAgo = back(0, 12);
  const high = Math.max(...bars.filter((b) => ymd(new Date(b.t)) > yearAgo).map((b) => Math.max(b.high, b.close)));
  return { last: last.close, asOf: last.t, ret, high52: high, fromHigh: (last.close / high - 1) * 100 };
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
async function fetchOne(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`;
  const parsed = barsFromChart(JSON.parse(await fetchText(url, 10000)));
  const s = parsed && summarize(parsed.bars);
  if (!s) throw new Error("no data");
  return { ...s, currency: parsed.currency };
}

function register(ctx) {
  const { ipcMain, send, readJSON, writeJSON } = ctx;
  let state = readJSON("markets-cache.json", null) || { data: {}, errors: {}, fetchedAt: 0 };
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
          try { data[s] = await fetchOne(s); } catch (e) { errors[s] = String(e.message || e); }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      state = { data, errors, fetchedAt: Date.now() };
      writeJSON("markets-cache.json", state);
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
  ipcMain.handle("markets:refresh", async () => { await refresh(); return snapshot(); });
}

module.exports = { register, GROUPS, PERIODS, symbols, barsFromChart, summarize, closeOnOrBefore, usMarketOpen };
