// Fintech page: main-process side. main.js calls register(ctx) once at startup; IPC channels start with "fintech:".
//  - Who is on the page: a fixed list (src/fintech-universe.js). Names and market caps come from Nasdaq's stock
//    screener, re-read at most every 12 hours (its prices can be a session old, so the cap is scaled by Yahoo's price).
//  - Prices: about three years of daily closes for every company and benchmark from Yahoo's batch chart endpoint,
//    20 symbols a request, two requests at a time with short pauses. The full download runs at most once a day after the
//    US close; otherwise only the last 5 days are re-read (for today's price), at most every 10 minutes while the page asks.
//  - One calendar: SPY's trading days. A company that listed later has nulls before its first close.
//  - Nothing is fetched until the page first asks; the last result is kept in fintech-cache.json.
// The arithmetic (returns, indexes, sub-sector tables, deals, news) is in renderer/fintechstats.js.
const nasdaq = require("./data/nasdaq");
const yahoo = require("./data/yahoo");
const { barsFromChart } = require("./markets");
const { baseName, yahooSymbol, firmNow, nyYmd } = require("./sectormap");
const B = require("./breadth");
const U = require("./fintech-universe");
const { periodStart } = require("../renderer/fintechstats");

const BATCH = 20, LANES = 2, PAUSE = 250;
const CAPS_TTL = 12 * 3600e3, QUICK_TTL = 10 * 60e3, RETRY_MS = 60e3;
const CALENDAR = "SPY";
const MARGIN_DAYS = 14; // kept before the 3Y start so the 3Y reference close is always on the calendar

// ---------- pure helpers (tested) ----------
const num = (s) => { const v = parseFloat(String(s ?? "").replace(/[$,%\s]/g, "")); return Number.isFinite(v) ? v : null; };
/** Five significant digits: small enough for the cache and the IPC payload, fine enough for a day's move. */
const sig = (v) => (v == null || !Number.isFinite(+v) || +v <= 0 ? null : +(+v).toPrecision(5));
const isoOf = (n) => `${Math.floor(n / 10000)}-${String(Math.floor(n / 100) % 100).padStart(2, "0")}-${String(n % 100).padStart(2, "0")}`;
const numOf = (iso) => +String(iso).replace(/-/g, "");

/** Nasdaq screener rows → { SYM: { name, cap, price, d1 } } for the symbols asked for. */
function capsFromScreener(rows, syms) {
  const want = new Set(syms), out = {};
  for (const r of rows || []) {
    const sym = yahooSymbol(String(r.symbol || "").trim());
    if (!want.has(sym)) continue;
    const cap = num(r.marketCap), price = num(r.lastsale);
    out[sym] = { name: baseName(r.name), cap: cap > 0 ? cap : null, price: price > 0 ? price : null, d1: num(r.pctchange) };
  }
  return out;
}

/** The first calendar day kept: three years and two weeks before `today` (yyyymmdd). */
const keepFrom = (today) => { const t = Date.parse(periodStart(isoOf(today), "3Y")) - MARGIN_DAYS * 864e5; return numOf(new Date(t).toISOString().slice(0, 10)); };

/** Daily bars by symbol → { dates (yyyymmdd), closes: { SYM: [close|null] } } on the calendar's trading days from `from`
 *  through `to`. Symbols with no close on the calendar are left out. */
function alignHistory(barsBySym, calBars, from, to) {
  const byDay = (bars) => { const m = new Map(); for (const b of bars || []) { const d = B.ymdOf(b.t); if (d >= from && d <= to && b.close > 0) m.set(d, b.close); } return m; };
  const dates = [...byDay(calBars).keys()].sort((a, b) => a - b), closes = {};
  for (const [s, bars] of Object.entries(barsBySym || {})) {
    const m = byDay(bars), row = dates.map((d) => sig(m.get(d)));
    if (row.some((v) => v != null)) closes[s] = row;
  }
  return { dates, closes };
}

/** Fold the last few days of bars into the store: new trading days of the calendar are appended, existing days
 *  overwritten (today's close keeps moving until the close), days before `from` dropped. Returns a new store. */
function mergeRecent(store, barsBySym, calBars, from, to) {
  const dates = [...(store?.dates || [])], closes = {};
  for (const [s, row] of Object.entries(store?.closes || {})) closes[s] = [...row];
  const last = dates[dates.length - 1] || 0;
  for (const b of calBars || []) { const d = B.ymdOf(b.t); if (d > last && d <= to && b.close > 0 && !dates.includes(d)) dates.push(d); }
  dates.sort((a, b) => a - b);
  const at = new Map(dates.map((d, i) => [d, i]));
  for (const s of Object.keys(closes)) while (closes[s].length < dates.length) closes[s].push(null);
  for (const [s, bars] of Object.entries(barsBySym || {})) {
    if (!closes[s]) continue; // a symbol new to the store waits for the next full download
    for (const b of bars || []) { const i = at.get(B.ymdOf(b.t)); if (i != null && b.close > 0) closes[s][i] = sig(b.close); }
  }
  const cut = dates.findIndex((d) => d >= from);
  if (cut > 0) { dates.splice(0, cut); for (const s of Object.keys(closes)) closes[s].splice(0, cut); }
  return { dates, closes };
}

/** What fintech:get sends (see renderer/fintechstats.js for the shape). cap = Nasdaq's market cap scaled by the latest
 *  close; price and d1 (today's %) from the last two closes, or Nasdaq's figures when the latest day has no close. */
function snapshot(C, status = {}) {
  const dates = C.dates || [], closes = C.closes || {}, caps = C.caps || {}, end = dates.length - 1;
  const lastOf = (row) => { for (let i = row.length - 1; i >= 0; i--) if (row[i] > 0) return row[i]; return null; };
  const companies = [], missing = [];
  for (const c of U.COMPANIES) {
    const row = closes[c.sym], n = caps[c.sym];
    if (!row && !n) { missing.push(c.sym); continue; }
    const live = row && row[end] > 0 && row[end - 1] > 0 ? { price: row[end], prev: row[end - 1] } : null;
    let cap = null, price = row ? lastOf(row) : null, d1 = null;
    if (n?.cap > 0 && n.price > 0) { const f = firmNow({ cap: n.cap, price: n.price, d1: n.d1 }, null, live); cap = f.cap; price = f.price; d1 = f.ret["1D"]; }
    else { price ??= n?.price ?? null; d1 = live ? (live.price / live.prev - 1) * 100 : n?.d1 ?? null; }
    if (!row) missing.push(c.sym);
    companies.push({ sym: c.sym, sub: c.sub, name: n?.name || c.name, cap: cap > 0 ? Math.round(cap) : null, price, d1: d1 != null && Number.isFinite(d1) ? +d1.toFixed(3) : null });
  }
  const benchmarks = U.BENCHMARKS.filter((b) => closes[b.sym]).map((b) => ({ sym: b.sym, name: b.name }));
  const keep = new Set([...companies.map((c) => c.sym), ...benchmarks.map((b) => b.sym)]), out = {};
  for (const s of keep) if (closes[s]) out[s] = closes[s];
  return {
    subsectors: U.SUBSECTORS, companies, benchmarks, dates: dates.map(isoOf), closes: out, missing,
    fetchedAt: C.fetchedAt || 0, loading: !!status.loading, progress: status.progress ?? null, error: status.error || null
  };
}

// ---------- fetching ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn(batch, bars by symbol) over `syms`, 20 per Yahoo request, two requests at a time with a short pause
 *  between one lane's requests (the same pacing as the sector map's history). Returns how many batches failed. */
async function batches(syms, params, fn) {
  const list = [];
  for (let i = 0; i < syms.length; i += BATCH) list.push(syms.slice(i, i + BATCH));
  let next = 0, failed = 0;
  await Promise.all(Array.from({ length: LANES }, async () => {
    while (next < list.length) {
      const batch = list[next++];
      if (next > LANES) await sleep(PAUSE);
      let got = null;
      for (let attempt = 0; attempt < 2 && !got; attempt++) {
        try { got = await yahoo.spark(batch, params); } catch { await sleep(800); }
      }
      if (!got) { failed++; fn(batch, {}); continue; }
      const bars = {};
      for (const s of batch) { const b = got[s] ? barsFromChart({ chart: { result: [got[s]] } })?.bars : null; if (b?.length) bars[s] = b; }
      fn(batch, bars);
    }
  }));
  return failed;
}

/** Names and market caps from Nasdaq for the universe. */
async function loadCaps(syms = U.COMPANIES.map((c) => c.sym)) {
  const caps = capsFromScreener((await nasdaq.screener())?.data?.rows, syms);
  if (!Object.keys(caps).length) throw new Error("Nasdaq returned none of the fintech companies");
  return caps;
}

/** Three years of daily closes for every symbol. onProgress(0..1) after each request. */
async function loadHistory(onProgress, now = new Date()) {
  const all = U.symbols(), bars = {}, total = Math.ceil(all.length / BATCH);
  let done = 0;
  const failed = await batches(all, { range: "5y", interval: "1d" }, (batch, got) => { Object.assign(bars, got); onProgress?.(++done / total); });
  const cal = bars[CALENDAR];
  if (!cal?.length) throw new Error("Yahoo returned no prices for SPY");
  const today = nyYmd(now);
  return { ...alignHistory(bars, cal, keepFrom(today), today), failed };
}

/** The last 5 days for every symbol, folded into `store`. */
async function loadRecent(store, now = new Date()) {
  const bars = {};
  const failed = await batches(U.symbols(), { range: "5d", interval: "1d" }, (batch, got) => Object.assign(bars, got));
  if (!bars[CALENDAR]?.length) throw new Error("Yahoo returned no prices for SPY");
  const today = nyYmd(now);
  return { ...mergeRecent(store, bars, bars[CALENDAR], keepFrom(today), today), failed };
}

function register(ctx) {
  const { ipcMain, send, readJSON, writeJSON } = ctx;
  // C: { caps: { SYM: { name, cap, price, d1 } }, capsAt, dates: [yyyymmdd], closes: { SYM: [close|null] },
  //      fullAsOf (the last close the full download covered), fullAt, quickAt, fetchedAt }
  let C = { caps: {}, capsAt: 0, dates: [], closes: {}, fullAsOf: 0, fullAt: 0, quickAt: 0, fetchedAt: 0, ...(readJSON("fintech-cache.json", null) || {}) };
  let inflight = null, status = { loading: false, progress: null, error: null }, failAt = 0;

  const snap = () => snapshot(C, status);
  const push = () => send("fintech:update", snap());
  const report = (level, detail) => ctx.reportHealth?.("fintech", { label: "Fintech (Nasdaq + Yahoo)", at: C.fetchedAt, level, detail });
  const capsDue = () => !Object.keys(C.caps || {}).length || Date.now() - C.capsAt > CAPS_TTL;
  const fullDue = () => !C.dates?.length || !(C.fullAsOf >= B.lastCloseYmd());
  const quickDue = () => Date.now() - (C.quickAt || 0) > QUICK_TTL;

  function refresh(force) {
    if (inflight) return inflight;
    inflight = (async () => {
      status = { loading: true, progress: null, error: null };
      push();
      const notes = [];
      try {
        if (force || capsDue()) {
          try { C = { ...C, caps: await loadCaps(), capsAt: Date.now() }; }
          catch (e) { notes.push(`Nasdaq market caps failed (${String(e.message || e)})`); }
        }
        let failed = 0;
        if (fullDue()) {
          status.progress = 0; push();
          const h = await loadHistory((p) => { status.progress = p; push(); });
          const had = Object.keys(C.closes || {}).length, have = Object.keys(h.closes).length;
          // keep the last good copy if this download came back mostly empty
          if (had && h.failed && have < had * 0.8) throw new Error(`only ${have} of ${had} symbols answered`);
          C = { ...C, dates: h.dates, closes: h.closes, fullAsOf: B.lastCloseYmd(), fullAt: Date.now(), quickAt: Date.now() };
          failed = h.failed;
        } else if (force || quickDue()) {
          const r = await loadRecent(C);
          C = { ...C, dates: r.dates, closes: r.closes, quickAt: Date.now() };
          failed = r.failed;
        }
        C.fetchedAt = Date.now();
        writeJSON("fintech-cache.json", C);
        const s = snapshot(C), total = U.COMPANIES.length, withPx = total - s.missing.length;
        if (failed) notes.push(`${failed} Yahoo request${failed === 1 ? "" : "s"} failed`);
        report(withPx >= total * 0.9 && !notes.length ? "ok" : "warn",
          `${withPx} of ${total} companies with prices · ${s.benchmarks.length} benchmarks${s.missing.length ? ` · missing: ${s.missing.slice(0, 8).join(", ")}` : ""}${notes.length ? ` · ${notes.join(" · ")}` : ""}`);
        status = { loading: false, progress: null, error: null };
      } catch (e) {
        failAt = Date.now();
        const msg = String(e.message || e);
        status = { loading: false, progress: null, error: C.dates?.length ? `Couldn't update prices (${msg}). Showing the last good copy.` : `Couldn't load prices (${msg}).` };
        report(C.dates?.length ? "warn" : "bad", `refresh failed: ${msg}${C.dates?.length ? " · showing the last good copy" : ""}`);
      }
    })().finally(() => { inflight = null; status.loading = false; status.progress = null; push(); });
    return inflight;
  }

  // lazy: nothing is fetched until the page first asks; a failed load is retried on the next ask, no sooner than a minute later
  ipcMain.handle("fintech:get", () => {
    if (!inflight && (capsDue() || fullDue() || quickDue()) && (!status.error || Date.now() - failAt > RETRY_MS)) refresh(false);
    return snap();
  });
  ipcMain.handle("fintech:refresh", async () => { await refresh(true); return snap(); });
}

module.exports = { register, capsFromScreener, alignHistory, mergeRecent, snapshot, keepFrom, sig, isoOf, numOf, loadCaps, loadHistory, loadRecent };
