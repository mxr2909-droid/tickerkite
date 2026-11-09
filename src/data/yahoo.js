// Yahoo Finance's public chart and search endpoints (no key). They're unofficial and can change or
// rate-limit without notice; every Yahoo call in Tickerkite goes through here so a replacement lands in one file.
const { getText } = require("./http");

const BASE = "https://query1.finance.yahoo.com";

const qs = (params) => typeof params === "string" ? params : new URLSearchParams(params).toString();
const chartUrl = (sym, params) => `${BASE}/v8/finance/chart/${encodeURIComponent(sym)}?${qs(params)}`;

/** Raw chart JSON for one symbol, e.g. chart("^GSPC", { range: "1d", interval: "15m" }). */
async function chart(sym, params, timeoutMs = 10000) {
  return JSON.parse(await getText(chartUrl(sym, params), { timeoutMs, headers: { Accept: "application/json" } }));
}

/** Daily closes [[ms, close]] from period1 (Unix seconds) to now. */
async function dailyCloses(sym, period1, timeoutMs = 30000) {
  const r = (await chart(sym, { period1, period2: Math.floor(Date.now() / 1000), interval: "1d" }, timeoutMs)).chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`no Yahoo data for ${sym}`);
  const close = r.indicators.quote[0].close, out = [];
  r.timestamp.forEach((t, i) => { if (close[i] != null) out.push([t * 1000, close[i]]); });
  if (!out.length) throw new Error(`no Yahoo data for ${sym}`);
  return { meta: r.meta || {}, points: out };
}

/** Symbol search JSON (quotes only). */
async function search(q, timeoutMs = 6000) {
  return JSON.parse(await getText(`${BASE}/v1/finance/search?${qs({ q, quotesCount: 8, newsCount: 0, listsCount: 0 })}`, { timeoutMs, headers: { Accept: "application/json" } }));
}

/** Batch chart: up to 20 symbols in one request. Returns { SYM: chart-result-shaped object } (same shape as chart().chart.result[0]). */
async function spark(symbols, params, timeoutMs = 20000) {
  const j = JSON.parse(await getText(`${BASE}/v7/finance/spark?symbols=${symbols.map(encodeURIComponent).join(",")}&${qs(params)}`, { timeoutMs, headers: { Accept: "application/json" } }));
  const out = {};
  for (const r of j?.spark?.result || []) if (r?.response?.[0]) out[r.symbol] = r.response[0];
  return out;
}

module.exports = { chart, chartUrl, dailyCloses, search, spark };
