// Delayed quotes from Yahoo Finance's public chart endpoint (no key), through src/data/yahoo.js.
// It is unofficial and can change; failures show as "—" in the app. With a Finnhub key (Settings),
// prices for US stocks and ETFs (watchlist, portfolio) come from Finnhub instead; Yahoo still draws the sparkline.
const yahoo = require("./data/yahoo");
const finnhub = require("./data/finnhub");

const SYMBOLS = [
  ["^GSPC", "S&P 500", "idx"], ["^IXIC", "Nasdaq", "idx"], ["^DJI", "Dow", "idx"], ["^RUT", "Russell 2K", "idx"],
  ["^VIX", "VIX", "idx"], ["^TNX", "UST 10Y", "yld"], ["DX-Y.NYB", "Dollar Idx", "idx"], ["EURUSD=X", "EUR/USD", "fx"],
  ["JPY=X", "USD/JPY", "fx"], ["BZ=F", "Brent", "px"], ["CL=F", "WTI", "px"], ["GC=F", "Gold", "px"],
  ["BTC-USD", "Bitcoin", "px"], ["^STOXX50E", "Euro Stoxx", "idx"], ["^N225", "Nikkei", "idx"], ["^HSI", "Hang Seng", "idx"]
];

// watchlist tickers, set by main.js: sym -> { label, name }
let WATCH = new Map();
function setWatch(list) {
  WATCH = new Map((list || []).map((e) => [e.sym, { label: e.sym, name: e.name }]));
}

// API keys, set by main.js from prefs
let KEYS = {};
function setKeys(k) { KEYS = { ...(k || {}) }; }

async function one([sym, label, type, extra = {}]) {
  if (KEYS.finnhub && finnhub.finnhubSymbol(sym)) { // US stocks and ETFs: watchlist and portfolio
    const [fh, y] = await Promise.all([finnhub.quote(sym, KEYS.finnhub).catch(() => null), yahooOne(sym, label, type, extra)]);
    if (fh) return { ...y, last: fh.last, prev: fh.prev, chg: fh.last - fh.prev, pct: ((fh.last - fh.prev) / fh.prev) * 100, time: fh.time || y.time, src: "Finnhub" };
    return y;
  }
  return yahooOne(sym, label, type, extra);
}

async function yahooOne(sym, label, type, extra) {
  try {
    const j = await yahoo.chart(sym, { range: "1d", interval: "15m" }, 8000);
    const r = j.chart.result[0];
    const m = r.meta;
    const last = m.regularMarketPrice;
    const prev = m.chartPreviousClose ?? m.previousClose;
    const closes = (r.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
    return { sym, label, type, last, prev, chg: last - prev, pct: prev ? ((last - prev) / prev) * 100 : 0, spark: closes.slice(-26), time: m.regularMarketTime * 1000, currency: m.currency, src: "Yahoo", ...extra };
  } catch {
    return { sym, label, type, last: null, ...extra };
  }
}

/** Market quotes plus watchlist quotes. Watchlist rows carry `watch: true` and the company name. */
async function fetchQuotes() {
  const watch = [...WATCH].map(([sym, w]) => [sym, w.label, "px", { watch: true, name: w.name }]);
  return Promise.all([...SYMBOLS, ...watch].map(one));
}

/** Check that a symbol exists on Yahoo and get its display name. Throws if it doesn't. */
async function lookupSymbol(sym) {
  let j;
  try { j = await yahoo.chart(sym, { range: "1d", interval: "1d" }, 8000); }
  catch (e) { throw new Error(/HTTP 404/.test(e.message) ? `No market data for "${sym}"` : `Couldn't reach Yahoo Finance (${e.message})`); }
  const m = j?.chart?.result?.[0]?.meta;
  if (!m || m.regularMarketPrice == null) throw new Error(`No market data for "${sym}"`);
  return { sym: m.symbol || sym, name: m.shortName || m.longName || sym, type: m.instrumentType || "" };
}

// ---- history for the instrument view ----
const { RANGES, analyze } = require("./analytics");
const histCache = new Map(); // key -> { at, data }

function symInfo(sym) {
  const s = SYMBOLS.find((x) => x[0] === sym);
  if (s) return { sym, label: s[1], type: s[2] };
  const w = WATCH.get(sym);
  return { sym, label: w ? w.name : sym, type: "px" };
}

/** Fetch and analyze one symbol over one range. Cached for that range's refresh interval. */
async function fetchHistory(sym, rangeKey, { force = false } = {}) {
  const cfg = RANGES[rangeKey] || RANGES["1M"];
  const key = `${sym}|${rangeKey}`;
  const hit = histCache.get(key);
  if (!force && hit && Date.now() - hit.at < cfg.refreshMs * 0.9) return hit.data;
  const json = await yahoo.chart(sym, { range: cfg.range, interval: cfg.interval, includePrePost: false }, 10000);
  const info = symInfo(sym);
  const data = { ...info, ...analyze(json, rangeKey, info.type), fetchedAt: Date.now() };
  histCache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { fetchQuotes, fetchHistory, symInfo, lookupSymbol, setWatch, setKeys, SYMBOLS, quoteOne: one };
