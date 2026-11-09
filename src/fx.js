// Currencies page (FX): main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, readJSON, writeJSON }
//  - IPC channels must start with "fx:" (the preload only forwards those)
// Data: Yahoo Finance's free chart endpoint (via ./data/yahoo): two years of daily closes plus the full weekly history for each
// currency against the US dollar, cached in fx-cache.json (refetched when 30+ minutes old while the page is open).
// Every series is stored as "USD per one unit of the currency", so a rising line always means that currency got stronger,
// and any cross rate A/B is simply usdPer(A) / usdPer(B).
const yahoo = require("./data/yahoo");
const { barsFromChart, summarize } = require("./markets");

// [code, name, Yahoo symbol, quoted as units-per-USD (true) or USD-per-unit (false), bloc]
const CURRENCIES = [
  ["EUR", "Euro", "EURUSD=X", false, "Developed"], ["JPY", "Japanese yen", "JPY=X", true, "Developed"],
  ["GBP", "British pound", "GBPUSD=X", false, "Developed"], ["CHF", "Swiss franc", "CHF=X", true, "Developed"],
  ["CAD", "Canadian dollar", "CAD=X", true, "Developed"], ["AUD", "Australian dollar", "AUDUSD=X", false, "Developed"],
  ["NZD", "New Zealand dollar", "NZDUSD=X", false, "Developed"], ["SEK", "Swedish krona", "SEK=X", true, "Developed"],
  ["NOK", "Norwegian krone", "NOK=X", true, "Developed"], ["SGD", "Singapore dollar", "SGD=X", true, "Asia"],
  ["CNY", "Chinese yuan", "CNY=X", true, "Asia"], ["INR", "Indian rupee", "INR=X", true, "Asia"],
  ["KRW", "South Korean won", "KRW=X", true, "Asia"], ["MXN", "Mexican peso", "MXN=X", true, "Emerging"],
  ["BRL", "Brazilian real", "BRL=X", true, "Emerging"], ["ZAR", "South African rand", "ZAR=X", true, "Emerging"],
  ["TRY", "Turkish lira", "TRY=X", true, "Emerging"]
];
const DXY = { sym: "DX-Y.NYB", name: "US Dollar Index (DXY)" };
const USD = ["USD", "US dollar"];
const TTL = 30 * 60e3;
const PERIODS = ["1D", "1W", "1M", "3M", "YTD", "1Y", "3Y", "5Y", "10Y"];
const RANGES = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "3Y": 3 * 366, "5Y": 5 * 366, "10Y": 10 * 366, MAX: Infinity };
const DAILY_RANGES = new Set(["1M", "3M", "6M", "1Y"]);
const sig = (x) => Number(x.toPrecision(7));

/** Bars from Yahoo's chart JSON → [[t, USD per unit]] ascending. `inv`: the quote is units per USD, so flip it. */
function usdSeries(bars, inv) {
  return (bars || []).filter((b) => b.close > 0).map((b) => [b.t, sig(inv ? 1 / b.close : b.close)]);
}

/** Series as the {t, close, high} bars summarize() takes. */
const asBars = (s) => s.map(([t, c]) => ({ t, close: c, high: c }));

/** Last value at or before t in an ascending [[t, v]] series, moving a shared cursor forward (null before the first point). */
function follower(series) {
  let i = -1;
  return (t) => { while (i + 1 < series.length && series[i + 1][0] <= t) i++; return i >= 0 ? series[i][1] : null; };
}

/** Cross rate A/B (units of B per one A) on A's dates (or B's when A is USD), with both legs rebased to 100 for the overlay.
 *  a, b: ascending [[t, usdPer]] or null for USD. */
function cross(a, b) {
  if (!a && !b) return { pts: [], idx: [] };
  const grid = (a || b).map((p) => p[0]);
  // the two legs' newest bars rarely share a timestamp: end on whichever is later so the last point uses both latest values
  const lastT = Math.max(a ? a[a.length - 1][0] : 0, b ? b[b.length - 1][0] : 0);
  if (lastT > grid[grid.length - 1]) grid.push(lastT);
  const fa = a ? follower(a) : () => 1, fb = b ? follower(b) : () => 1;
  const pts = [], idx = [];
  let a0 = null, b0 = null;
  for (const t of grid) {
    const va = fa(t), vb = fb(t);
    if (va == null || vb == null) continue;
    pts.push([t, va / vb]);
    a0 ??= va; b0 ??= vb;
    idx.push([t, (va / a0) * 100, (vb / b0) * 100]);
  }
  return { pts, idx };
}

/** Where `v` sits among `vals`, 0..100 (share of values below it). */
function percentile(vals, v) {
  if (!vals.length) return null;
  let below = 0;
  for (const x of vals) if (x < v) below++;
  return (below / vals.length) * 100;
}

/** Stats for a cross-rate window: change, high and low with dates, and where today sits in the window. */
function windowStats(pts, fullPts) {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1], first = pts[0];
  let hi = pts[0], lo = pts[0];
  for (const p of pts) { if (p[1] > hi[1]) hi = p; if (p[1] < lo[1]) lo = p; }
  return {
    last: last[1], first: first[1], from: first[0], to: last[0], chgPct: (last[1] / first[1] - 1) * 100,
    high: hi[1], highAt: hi[0], low: lo[1], lowAt: lo[0],
    pctInWindow: hi[1] === lo[1] ? 50 : ((last[1] - lo[1]) / (hi[1] - lo[1])) * 100,
    pctOfHistory: fullPts?.length ? percentile(fullPts.map((p) => p[1]), last[1]) : null,
    historyFrom: fullPts?.[0]?.[0] ?? null
  };
}

/** Drop points older than `range` before the last point. */
function sliceRange(pts, range) {
  const days = RANGES[range] ?? RANGES["1Y"];
  if (!pts.length || !isFinite(days)) return pts;
  const from = pts[pts.length - 1][0] - days * 864e5;
  return pts.filter((p) => p[0] >= from);
}

/** Weekly history with the newer daily points appended (daily wins from where the weekly series ends). */
function joinSeries(weekly, daily) {
  if (!weekly?.length) return daily || [];
  if (!daily?.length) return weekly;
  return weekly.filter((p) => p[0] < daily[0][0]).concat(daily);
}

/** The compare view: two currency codes (or USD) over a range. */
function compare(store, A, B, range) {
  const get = (c) => (c === "USD" ? null : store[c]);
  const ok = (c) => c === "USD" || store[c]?.daily?.length;
  if (!ok(A) || !ok(B) || A === B) return null;
  const src = (c) => { const s = get(c); return s ? (DAILY_RANGES.has(range) ? s.daily : joinSeries(s.weekly, s.daily)) : null; };
  const full = (c) => { const s = get(c); return s ? joinSeries(s.weekly, s.daily) : null; };
  const win = (series) => (series ? sliceRange(series, range) : null);
  // slice both legs to the window first, then build the cross on the shared grid
  const x = cross(win(src(A)), win(src(B)));
  const fx = cross(full(A), full(B));
  return { a: A, b: B, range, pts: x.pts, idx: x.idx, stats: windowStats(x.pts, fx.pts) };
}

/** 200-day moving average of the last 200 daily closes (null with fewer than 150 days). */
function ma200(daily) {
  const v = daily.slice(-200).map((p) => p[1]);
  return v.length >= 150 ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/** One row of the strength table from a currency's stored series. */
function rowFor(meta, s) {
  const sum = summarize(asBars(s.daily), s.weekly ? asBars(s.weekly) : null);
  if (!sum) return null;
  const all = joinSeries(s.weekly, s.daily).map((p) => p[1]);
  const m = ma200(s.daily);
  return {
    code: meta.code, name: meta.name, bloc: meta.bloc, quote: meta.quote, last: sum.last, quoteLast: meta.inv ? 1 / sum.last : sum.last,
    ret: sum.ret, ann: sum.ann, asOf: sum.asOf, ma200: m, vsMa200: m ? (sum.last / m - 1) * 100 : null,
    histPct: percentile(all, sum.last), historyFrom: sum.historyFrom,
    spark: joinSeries(s.weekly, s.daily).slice(-260).filter((_, i, a) => i % Math.ceil(a.length / 60) === 0 || i === a.length - 1).map((p) => p[1])
  };
}

const f1 = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
const yr = (t) => new Date(t).getUTCFullYear();

/** Plain-language megatrend cards from the table rows and the dollar index row. */
function megatrends(rows, dxy) {
  const out = [];
  if (dxy) {
    const dir = dxy.ann?.["5Y"] > 1 ? "strengthened" : dxy.ann?.["5Y"] < -1 ? "weakened" : "gone sideways";
    out.push({
      title: "The dollar's cycle", tone: dxy.vsMa200 > 0 ? "up" : "dn",
      text: `The dollar index is ${dxy.last.toFixed(1)}, ${Math.round(dxy.histPct)}% of the way up its range since ${yr(dxy.historyFrom)} (0% is the lowest reading, 100% the highest). It has ${dir} over five years (${f1(dxy.ann["5Y"] ?? 0)}% a year) and sits ${f1(dxy.vsMa200 ?? 0)}% ${dxy.vsMa200 >= 0 ? "above" : "below"} its 200-day average.`
    });
  }
  const trend = rows.filter((r) => r.vsMa200 != null);
  if (trend.length) {
    const up = trend.filter((r) => r.vsMa200 > 0).length;
    out.push({
      title: "Breadth against the dollar", tone: up > trend.length / 2 ? "up" : "dn",
      text: `${up} of ${trend.length} currencies trade above their 200-day average against the dollar. ${up >= trend.length * 0.7 ? "That is a broad dollar-weakness phase." : up <= trend.length * 0.3 ? "That is a broad dollar-strength phase." : "The picture is mixed: the dollar is not moving everything the same way."}`
    });
  }
  const five = rows.filter((r) => r.ann?.["5Y"] != null).sort((a, b) => b.ann["5Y"] - a.ann["5Y"]);
  if (five.length >= 6) {
    const t = (r) => `${r.code} ${f1(r.ann["5Y"])}%`;
    out.push({
      title: "Five-year winners and losers", tone: "",
      text: `Best against the dollar over five years, per year: ${five.slice(0, 3).map(t).join(", ")}. Worst: ${five.slice(-3).reverse().map(t).join(", ")}. Persistent losers are usually the high-inflation economies; persistent winners the ones with strong current accounts or rising rates.`
    });
  }
  const low = rows.filter((r) => r.histPct != null && r.histPct <= 10), high = rows.filter((r) => r.histPct != null && r.histPct >= 90);
  if (low.length || high.length) {
    const nm = (r) => `${r.code} (${Math.round(r.histPct)}%)`;
    out.push({
      title: "Stretched against the dollar", tone: "",
      text: `${low.length ? `Near the bottom of their range since ${yr(low[0].historyFrom)}: ${low.map(nm).join(", ")}. ` : ""}${high.length ? `Near the top: ${high.map(nm).join(", ")}. ` : ""}The percentage is where each sits in its own range (0% lowest, 100% highest). Extremes can last years; they say how far the move has gone, not when it turns.`
    });
  }
  return out;
}

/** Everything the page shows, from the store { CODE: { daily, weekly }, DXY: {...} }. */
function payload(cache) {
  const store = cache?.store || {};
  const rows = CURRENCIES.map(([code, name, , inv, bloc]) => store[code] ? rowFor({ code, name, bloc, inv, quote: inv ? `USD/${code}` : `${code}/USD` }, store[code]) : null).filter(Boolean);
  if (!rows.length) return { at: cache?.at || 0, error: cache?.error || null, empty: true };
  const dxy = store.DXY ? rowFor({ code: "DXY", name: DXY.name, bloc: "Index", inv: false, quote: "DXY" }, store.DXY) : null;
  return {
    at: cache.at, error: cache.error || null, periods: PERIODS, rows, dxy, megatrends: megatrends(rows, dxy),
    currencies: [[USD[0], USD[1]], ...CURRENCIES.map(([c, n]) => [c, n])]
  };
}

async function fetchOne(sym, inv) {
  const [daily, weekly] = await Promise.all([
    yahoo.chart(sym, "range=2y&interval=1d&includePrePost=false", 15000),
    yahoo.chart(sym, "range=max&interval=1wk&includePrePost=false", 25000)
  ]);
  const d = barsFromChart(daily), w = barsFromChart(weekly);
  if (!d || d.bars.length < 20) throw new Error("no data");
  return { daily: usdSeries(d.bars, inv), weekly: w ? usdSeries(w.bars, inv) : [] };
}

function register(ctx) {
  const stored = ctx.readJSON("fx-cache.json", null);
  let cache = stored?.store ? stored : { at: 0, store: {}, error: null }, loading = null;
  const push = () => ctx.send("fx:update", payload(cache));
  async function refresh(force) {
    if (loading) return loading;
    if (!force && cache.at && Date.now() - cache.at < TTL) return;
    loading = (async () => {
      const jobs = [...CURRENCIES.map(([code, , sym, inv]) => [code, sym, inv]), ["DXY", DXY.sym, false]];
      const store = { ...cache.store }, errors = [];
      let i = 0;
      const worker = async () => {
        while (i < jobs.length) {
          const [code, sym, inv] = jobs[i++];
          try { store[code] = await fetchOne(sym, inv); } catch (e) { errors.push(`${code}: ${e.message || e}`); }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      const got = Object.keys(store).length;
      cache = { at: errors.length === jobs.length ? cache.at : Date.now(), store, error: errors.length ? `${errors.length} of ${jobs.length} series failed (${errors[0]})` : null };
      if (!got) cache.error = "Yahoo returned no currency data";
      ctx.writeJSON("fx-cache.json", cache);
      push();
    })().finally(() => { loading = null; });
    return loading;
  }
  ctx.ipcMain.handle("fx:get", () => { refresh(false); return payload(cache); });
  ctx.ipcMain.handle("fx:refresh", async () => { await refresh(true); return payload(cache); });
  ctx.ipcMain.handle("fx:compare", (_e, a, b, range) => compare(cache.store, String(a), String(b), String(range)));
}

module.exports = { register, CURRENCIES, usdSeries, cross, compare, windowStats, percentile, sliceRange, joinSeries, megatrends, rowFor, payload, ma200 };
