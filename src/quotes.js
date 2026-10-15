// Free delayed quotes from Yahoo Finance's public chart endpoint (no key).
// It is unofficial and can change; failures show as "—" in the app.
const { fetchText } = require("./news/fetcher");

const SYMBOLS = [
  ["^GSPC", "S&P 500", "idx"], ["^IXIC", "Nasdaq", "idx"], ["^DJI", "Dow", "idx"], ["^RUT", "Russell 2K", "idx"],
  ["^VIX", "VIX", "idx"], ["^TNX", "UST 10Y", "yld"], ["DX-Y.NYB", "Dollar Idx", "idx"], ["EURUSD=X", "EUR/USD", "fx"],
  ["JPY=X", "USD/JPY", "fx"], ["BZ=F", "Brent", "px"], ["CL=F", "WTI", "px"], ["GC=F", "Gold", "px"],
  ["BTC-USD", "Bitcoin", "px"], ["^STOXX50E", "Euro Stoxx", "idx"], ["^N225", "Nikkei", "idx"], ["^HSI", "Hang Seng", "idx"]
];

async function one([sym, label, type]) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=15m`;
  try {
    const j = JSON.parse(await fetchText(url, 8000));
    const r = j.chart.result[0];
    const m = r.meta;
    const last = m.regularMarketPrice;
    const prev = m.chartPreviousClose ?? m.previousClose;
    const closes = (r.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
    return { sym, label, type, last, chg: last - prev, pct: prev ? ((last - prev) / prev) * 100 : 0, spark: closes.slice(-26), time: m.regularMarketTime * 1000 };
  } catch {
    return { sym, label, type, last: null };
  }
}

async function fetchQuotes() {
  return Promise.all(SYMBOLS.map(one));
}

// ---- history for the instrument view ----
const { RANGES, analyze } = require("./analytics");
const histCache = new Map(); // key -> { at, data }

function symInfo(sym) {
  const s = SYMBOLS.find((x) => x[0] === sym);
  return s ? { sym, label: s[1], type: s[2] } : { sym, label: sym, type: "px" };
}

/** Fetch and analyze one symbol over one range. Cached for that range's refresh interval. */
async function fetchHistory(sym, rangeKey, { force = false } = {}) {
  const cfg = RANGES[rangeKey] || RANGES["1M"];
  const key = `${sym}|${rangeKey}`;
  const hit = histCache.get(key);
  if (!force && hit && Date.now() - hit.at < cfg.refreshMs * 0.9) return hit.data;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${cfg.range}&interval=${cfg.interval}&includePrePost=false`;
  const json = JSON.parse(await fetchText(url, 10000));
  const info = symInfo(sym);
  const data = { ...info, ...analyze(json, rangeKey, info.type), fetchedAt: Date.now() };
  histCache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { fetchQuotes, fetchHistory, symInfo, SYMBOLS };
