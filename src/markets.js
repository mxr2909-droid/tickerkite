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
  { id: "assets", title: "Across assets", items: [
    ["TLT", "Long Treasuries", "Bonds"], ["HYG", "High-yield credit", "Credit"], ["GLD", "Gold", "Metals"], ["USO", "Crude oil", "Energy"],
    ["DBC", "Commodities", "Broad basket"], ["UUP", "US dollar", "vs majors"], ["BTC-USD", "Bitcoin", "Crypto"], ["VNQ", "Real estate", "REITs"]] },
  // style pairs: [a, b] legs; the spread is a − b
  { id: "style", title: "Style", pairs: [
    { name: "Growth vs Value", a: ["IWF", "Growth"], b: ["IWD", "Value"] },
    { name: "Large vs Small", a: ["IWB", "Large caps"], b: ["IWM", "Small caps"] },
    { name: "Equal vs Cap weight", a: ["RSP", "Equal-wt S&P"], b: ["SPY", "Cap-wt S&P"] }] }
];
const PERIODS = ["1D", "1W", "1M", "3M", "YTD", "1Y", "3Y", "5Y", "10Y"];
const ANNUAL_YEARS = { "3Y": 3, "5Y": 5, "10Y": 10 };
const LONG_TTL = 24 * 3600 * 1000;
const ROTATION_BENCH = "SPY";
// correlation matrix: two sets of US-listed funds (same trading hours, so daily moves line up), and the look-back windows in trading days
const CORR_SETS = {
  assets: [["SPY", "US stocks"], ["IWM", "Small caps"], ["EEM", "Emerging mkts"], ["TLT", "Treasuries"], ["HYG", "High yield"], ["GLD", "Gold"],
    ["USO", "Oil"], ["DBC", "Commodities"], ["UUP", "Dollar"], ["BTC-USD", "Bitcoin"], ["VNQ", "Real estate"]],
  sectors: null // filled from GROUPS[0] below
};
const CORR_WINDOWS = { "1M": 21, "3M": 63, "1Y": 252 };
const CORR_CALENDAR = "SPY";

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

/** Average of the last n values ending at index i, or null when any is missing. */
function sma(a, n, i) {
  if (i < n - 1) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) { if (a[k] == null) return null; s += a[k]; }
  return s / n;
}
// weeks are matched by number (Monday-based), because a week still in progress is stamped with its latest trade
const weekNo = (t) => Math.floor((t / 86400000 + 3) / 7);

/** Relative rotation of one series against a benchmark, from weekly bars [{ t, close }] (ascending).
 *  The relative line is series ÷ benchmark. Strength = 100 × its `fast`-week average ÷ its `slow`-week average
 *  (above 100: beating the benchmark lately). Momentum = 100 × strength ÷ its own `mom`-week average
 *  (above 100: strength is rising). Returns the last `tail` weeks as [[t, strength, momentum]]. */
function rotation(series, bench, { fast = 4, slow = 26, mom = 8, tail = 12 } = {}) {
  const mine = new Map((series || []).map((b) => [weekNo(b.t), b.close]));
  const t = [], r = [];
  for (const b of bench || []) { const c = mine.get(weekNo(b.t)); if (c > 0 && b.close > 0) { t.push(b.t); r.push(c / b.close); } }
  const x = r.map((_, i) => { const f = sma(r, fast, i), s = sma(r, slow, i); return f != null && s ? (100 * f) / s : null; });
  const y = x.map((v, i) => { const m = sma(x, mom, i); return v != null && m ? (100 * v) / m : null; });
  const out = [];
  for (let i = Math.max(0, t.length - tail); i < t.length; i++) if (x[i] != null && y[i] != null) out.push([t[i], +x[i].toFixed(3), +y[i].toFixed(3)]);
  return out;
}
/** Which quarter of the rotation chart a point is in. */
const quadrant = (x, y) => (x >= 100 ? (y >= 100 ? "leading" : "weakening") : y >= 100 ? "improving" : "lagging");

/** Daily returns of every symbol on one shared calendar (the `calendar` symbol's trading days), so a fund that also
 *  trades at weekends (bitcoin) is compared over the same days as the rest. bySym: { sym: [{ t, close }] } ascending.
 *  Returns { t: [day stamps], r: { sym: [return or null per day] } }; r[sym][i] is the move from day i−1 to day i. */
function alignedReturns(bySym, syms, calendar) {
  const cal = (bySym[calendar] || []).map((b) => ymd(new Date(b.t)));
  const t = (bySym[calendar] || []).map((b) => b.t);
  const r = {};
  for (const s of syms) {
    const m = new Map((bySym[s] || []).map((b) => [ymd(new Date(b.t)), b.close]));
    r[s] = cal.map((d, i) => { const a = i ? m.get(cal[i - 1]) : null, b = m.get(d); return a > 0 && b > 0 ? b / a - 1 : null; });
  }
  return { t, r };
}

/** Pearson correlation of two equal-length arrays over indices [from, to), skipping days either is missing; null under 10 pairs. */
function pearson(a, b, from = 0, to = a.length) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = Math.max(0, from); i < to; i++) {
    const x = a[i], y = b[i];
    if (x == null || y == null) continue;
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  if (n < 10) return null;
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : null;
}

/** Correlation matrix of daily returns over the last `days` trading days: { syms, days, m } with m[i][j] rounded to 3 places (null without data). */
function correlations(aligned, syms, days) {
  const n = aligned.t.length, from = Math.max(1, n - days);
  const m = syms.map((a, i) => syms.map((b, j) => {
    if (i === j) return aligned.r[a]?.some((v) => v != null) ? 1 : null;
    const c = pearson(aligned.r[a] || [], aligned.r[b] || [], from, n);
    return c == null ? null : +c.toFixed(3);
  }));
  return { syms, days: n - from, m };
}

/** One pair in detail: the rolling `win`-day correlation as [[t, r]] and the last `win` days of paired returns (%) as [[a, b]]. */
function pairDetail(aligned, a, b, win = 63) {
  const ra = aligned.r[a], rb = aligned.r[b], n = aligned.t.length;
  if (!ra || !rb) return null;
  const rolling = [];
  for (let i = win; i <= n; i++) { const c = pearson(ra, rb, i - win, i); if (c != null) rolling.push([aligned.t[i - 1], +c.toFixed(3)]); }
  const dots = [];
  for (let i = Math.max(1, n - win); i < n; i++) if (ra[i] != null && rb[i] != null) dots.push([+(ra[i] * 100).toFixed(3), +(rb[i] * 100).toFixed(3)]);
  return { a, b, win, rolling, dots };
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

  // sector rotation against the S&P 500 (SPY), from the weekly history already kept for the long periods
  const rotations = () => {
    const bench = hist.weekly[ROTATION_BENCH]?.bars;
    return { bench: ROTATION_BENCH, sectors: GROUPS[0].items.map(([sym, name]) => ({ sym, name, pts: rotation(hist.weekly[sym]?.bars, bench) })).filter((s) => s.pts.length) };
  };
  // correlation matrices for both sets and every window, from the year of daily bars already kept
  const corrSyms = () => [...new Set(Object.values(CORR_SETS).flat().map((x) => x[0]))];
  const aligned = () => alignedReturns(hist.daily, corrSyms(), CORR_CALENDAR);
  const corr = () => {
    const al = aligned();
    if (al.t.length < 30) return null;
    const out = { windows: Object.keys(CORR_WINDOWS), sets: {} };
    for (const [k, list] of Object.entries(CORR_SETS)) {
      out.sets[k] = { labels: list, by: Object.fromEntries(Object.entries(CORR_WINDOWS).map(([w, d]) => [w, correlations(al, list.map((x) => x[0]), d)])) };
    }
    return out;
  };
  const snapshot = () => ({ groups: GROUPS, periods: PERIODS, ...state, open: usMarketOpen(), rotation: rotations(), corr: corr() });
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
  ipcMain.handle("markets:pair", (_e, a, b) => (corrSyms().includes(a) && corrSyms().includes(b) ? pairDetail(aligned(), a, b) : null));
  ipcMain.handle("markets:refresh", async () => { await refresh(); return snapshot(); });
}

CORR_SETS.sectors = GROUPS[0].items.map(([sym, name]) => [sym, name]);

module.exports = { register, alignedReturns, pearson, correlations, pairDetail, CORR_SETS, GROUPS, PERIODS, symbols, barsFromChart, summarize, chartBars, annualize, closeOnOrBefore, usMarketOpen, rotation, quadrant };
