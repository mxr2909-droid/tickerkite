// Finnhub (finnhub.io), used only when you paste your own API key in Settings. The free plan covers
// real-time quotes for US stocks and ETFs; WIRE uses it for watchlist prices and falls back to Yahoo
// for anything Finnhub doesn't answer (indices, futures, FX, non-US listings).
const { getJSON } = require("./http");

const BASE = "https://finnhub.io/api/v1";

/** Symbols Finnhub's US quote endpoint takes: plain US tickers, with BRK-B written BRK.B. */
function finnhubSymbol(sym) {
  const s = String(sym || "").toUpperCase();
  return /^[A-Z]{1,5}(-[A-Z])?$/.test(s) ? s.replace("-", ".") : null;
}

/** { last, prev, time } for one US ticker, or null when Finnhub has no price for it. Throws "invalid key" on 401/403. */
async function quote(sym, key, timeoutMs = 8000) {
  const s = finnhubSymbol(sym);
  if (!s || !key) return null;
  let j;
  try { j = await getJSON(`${BASE}/quote?symbol=${encodeURIComponent(s)}`, { timeoutMs, headers: { "X-Finnhub-Token": key } }); }
  catch (e) { if (e.status === 401 || e.status === 403) throw new Error("invalid key"); throw e; }
  return parseQuote(j);
}

/** Finnhub /quote JSON → { last, prev, time }; it answers an unknown symbol with zeros. */
function parseQuote(j) {
  if (!j || !(j.c > 0) || !(j.pc > 0)) return null;
  return { last: j.c, prev: j.pc, time: (j.t || 0) * 1000 };
}

/** Check a key with one AAPL quote: { ok } or { ok: false, error }. */
async function testKey(key) {
  try { return (await quote("AAPL", key)) ? { ok: true } : { ok: false, error: "Finnhub answered without a price. Try again in a minute." }; }
  catch (e) { return { ok: false, error: /invalid key/.test(e.message) ? "Finnhub didn't accept that key." : `Couldn't reach Finnhub (${e.message}).` }; }
}

module.exports = { quote, parseQuote, finnhubSymbol, testKey };
