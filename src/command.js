// Command bar (⌘K): main-process side. main.js calls register(ctx) once at startup.
//  - IPC channels must start with "cmd:" (the preload only forwards those)
// The renderer matches pages, commands, your tickers and headlines locally; this adds every other listed
// symbol through Yahoo's search (stocks, ETFs, funds, indexes, futures, crypto), cached per query for 10 minutes.
const { fetchText } = require("./news/fetcher");

const KINDS = { EQUITY: "Stock", ETF: "ETF", MUTUALFUND: "Fund", INDEX: "Index", FUTURE: "Future", CRYPTOCURRENCY: "Crypto", CURRENCY: "Currency" };

/** Yahoo search JSON → [{ sym, name, kind, exch }], symbols only (no news), US listings first. */
function parseSearch(j) {
  const qs = (j?.quotes || []).filter((q) => q.symbol && KINDS[q.quoteType]);
  const us = (q) => !/\./.test(q.symbol) || /=|\^/.test(q.symbol) ? 0 : 1;
  return qs.map((q, i) => ({ q, i })).sort((a, b) => us(a.q) - us(b.q) || a.i - b.i).map(({ q }) => ({
    sym: q.symbol, name: q.shortname || q.longname || q.symbol, kind: KINDS[q.quoteType], exch: q.exchDisp || ""
  }));
}

function register(ctx) {
  const cache = new Map();
  ctx.ipcMain.handle("cmd:search", async (_e, q) => {
    q = String(q || "").trim().slice(0, 40);
    if (!q) return [];
    const hit = cache.get(q.toLowerCase());
    if (hit && Date.now() - hit.at < 10 * 60e3) return hit.list;
    try {
      const j = JSON.parse(await fetchText(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`, 6000));
      const list = parseSearch(j);
      cache.set(q.toLowerCase(), { at: Date.now(), list });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      return list;
    } catch { return []; }
  });
}

module.exports = { register, parseSearch };
