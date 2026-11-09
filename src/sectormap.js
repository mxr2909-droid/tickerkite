// Sector map: main-process side. main.js calls register(ctx) once at startup.
//  - IPC channels start with "map:" (the preload only forwards those for this page)
//  - One request to Nasdaq's stock screener returns every US-listed stock with its sector, industry,
//    market cap, last price and day change. The map keeps the TOP largest companies of each sector.
//    That list is re-read twice a day; its prices can be a session old, so it only decides who is on the map.
//  - Prices come from Yahoo's batch chart endpoint, 20 symbols a request: the latest price and prior close on
//    every refresh, and closes a week … a year back once per New York day (map-refs-cache.json).
//  - Nothing is fetched until the page is first opened; the last result is kept in map-cache.json.
const nasdaq = require("./data/nasdaq");
const yahoo = require("./data/yahoo");
const { barsFromChart, closeOnOrBefore, usMarketOpen } = require("./markets");

const PERIODS = ["1D", "1W", "1M", "3M", "YTD", "1Y"];
const TOP = 40;
const BATCH = 20;
const UNIVERSE_TTL = 12 * 3600 * 1000;
// Nasdaq leaves a few large companies without a sector, and "Miscellaneous" is too small to read
const SECTOR_FIX = { "BRK/A": "Finance", "BRK/B": "Finance" };
const SKIP = new Set(["", "Miscellaneous"]);

// ---------- pure helpers (tested) ----------
const num = (s) => { const v = parseFloat(String(s ?? "").replace(/[$,%\s]/g, "")); return Number.isFinite(v) ? v : null; };

/** Is this listing a company's ordinary shares (or its ADR), not a preferred, note, unit, warrant or right? */
function isCommon(symbol, name) {
  if (!symbol || /\^/.test(symbol)) return false;
  return !/\bNotes?\b|Debentures?|ZONES|Preferred|Warrants?\b|\bUnits?\b|\bRights?\b|\d%|Subordinated|(?<!American )Depositar?y Shares/i.test(name || "");
}

/** "Alphabet Inc. Class A Common Stock" → "Alphabet Inc.": the issuer without the share-class wording. */
function baseName(name) {
  const s = String(name || "").replace(/\s+/g, " ").trim();
  const cut = s.search(/\s+(Class [A-Z]\b|Common|Ordinary|Capital Stock|American Deposit|Sponsored|New York Registry|Depositar?y|Limited Voting|Subordinate Voting|Shares\b|ADS\b|ADR\b|\()/i);
  return (cut > 0 ? s.slice(0, cut) : s).replace(/[\s,]+$/, "");
}

/** Nasdaq writes share classes as BRK/B or GEF.B; Yahoo as BRK-B. */
const yahooSymbol = (sym) => String(sym).replace(/[/.]/g, "-");

/** Screener rows → [{ id, name, firms: [{ sym, name, industry, country, cap, price, d1 }] }], sectors and firms largest first.
 *  Two share classes of one company (GOOGL / GOOG) count once: the more traded listing stays. */
function buildSectors(rows, top = TOP) {
  const byIssuer = new Map();
  for (const r of rows || []) {
    const symbol = String(r.symbol || "").trim(), cap = num(r.marketCap), price = num(r.lastsale);
    const sector = SECTOR_FIX[symbol] ?? String(r.sector || "").trim();
    if (!(cap > 0) || !(price > 0) || SKIP.has(sector) || !isCommon(symbol, r.name)) continue;
    const name = baseName(r.name);
    const f = { sym: yahooSymbol(symbol), name, sector, industry: String(r.industry || "").trim(), country: String(r.country || "").trim(), cap, price, d1: num(r.pctchange), vol: num(r.volume) || 0 };
    const key = name.toLowerCase(), old = byIssuer.get(key);
    if (!old) byIssuer.set(key, f);
    else if (f.vol > old.vol) byIssuer.set(key, { ...f, cap: Math.max(f.cap, old.cap), d1: f.d1 ?? old.d1 });
    else { old.cap = Math.max(f.cap, old.cap); old.d1 ??= f.d1; }
  }
  const groups = new Map();
  for (const f of byIssuer.values()) { if (!groups.has(f.sector)) groups.set(f.sector, []); groups.get(f.sector).push(f); }
  const capOf = (fs) => fs.reduce((a, f) => a + f.cap, 0);
  return [...groups].map(([name, fs]) => ({ id: name, name, firms: fs.sort((a, b) => b.cap - a.cap).slice(0, top).map(({ vol, sector, ...f }) => f) }))
    .sort((a, b) => capOf(b.firms) - capOf(a.firms));
}

/** yyyymmdd number for "now" in New York. */
function nyYmd(now = new Date()) {
  return +new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).replace(/-/g, "");
}

/** Reference closes for each period, counted back from `today` (yyyymmdd): { "1W", "1M", "3M", YTD, "1Y", last }.
 *  `bars` are ascending daily bars [{ t, close }] reaching back more than a year. */
function periodRefs(bars, today) {
  if (!bars?.length) return null;
  const y = Math.floor(today / 10000), m = Math.floor(today / 100) % 100 - 1, d = today % 100;
  const back = (days, months) => {
    const x = new Date(Date.UTC(y, m - months, d - days));
    // a month-end overflow (May 31 − 3 months) rolls forward; clamp to the last day of the target month
    if (months && x.getUTCMonth() !== ((m - months) % 12 + 12) % 12) x.setUTCDate(0);
    return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
  };
  return {
    "1W": closeOnOrBefore(bars, back(7, 0)), "1M": closeOnOrBefore(bars, back(0, 1)), "3M": closeOnOrBefore(bars, back(0, 3)),
    YTD: closeOnOrBefore(bars, y * 10000 + 100), "1Y": closeOnOrBefore(bars, back(0, 12)), last: bars[bars.length - 1].close
  };
}

/** Latest price and the close before it from a few daily bars: { price, prev }, or null. */
function liveQuote(bars) {
  if (!bars || bars.length < 2) return null;
  const price = bars[bars.length - 1].close, prev = bars[bars.length - 2].close;
  return price > 0 && prev > 0 ? { price, prev } : null;
}

/** A firm with today's numbers: { ...firm, price, cap, ret: { period: % } }.
 *  `live` ({ price, prev } from Yahoo) replaces Nasdaq's price, which can be a session old, and scales the market cap
 *  with it; without it the Nasdaq figures stand. Longer periods are price ÷ the reference close in `refs`. When the
 *  two sources disagree by half or more (a split, a different share ratio) the price isn't trusted across them. */
function firmNow(firm, refs, live) {
  const agree = (a, b) => a > 0 && b > 0 && Math.abs(a / b - 1) < 0.5;
  const price = live?.price ?? firm.price;
  const cap = live && agree(live.price, firm.price) ? firm.cap * (live.price / firm.price) : firm.cap;
  const ret = { "1D": live ? (live.price / live.prev - 1) * 100 : firm.d1 ?? null };
  const ok = refs && (live || agree(price, refs.last));
  for (const p of PERIODS.slice(1)) ret[p] = ok && refs[p] > 0 ? (price / refs[p] - 1) * 100 : null;
  const { d1, ...rest } = firm;
  return { ...rest, price, cap, ret };
}

/** Cap-weighted return (%) of a group: today's total value ÷ its value at the start of the period.
 *  rows: [{ cap, ret }]; rows without a return are left out. Null when none has one. */
function groupReturn(rows) {
  let now = 0, then = 0;
  for (const r of rows) if (r.ret != null && r.ret > -100) { now += r.cap; then += r.cap / (1 + r.ret / 100); }
  return then > 0 ? (now / then - 1) * 100 : null;
}

/** What the page draws: sectors with their size and return per period (largest first), each firm with its returns. */
function view(sectors, refs, live) {
  return (sectors || []).map((s) => {
    const firms = s.firms.map((f) => firmNow(f, refs?.[f.sym], live?.[f.sym])).sort((a, b) => b.cap - a.cap);
    const ret = {};
    for (const p of PERIODS) ret[p] = groupReturn(firms.map((f) => ({ cap: f.cap, ret: f.ret[p] })));
    return { id: s.id, name: s.name, cap: firms.reduce((a, f) => a + f.cap, 0), ret, firms };
  }).sort((a, b) => b.cap - a.cap);
}

function register(ctx) {
  const { ipcMain, send, readJSON, writeJSON } = ctx;
  // universe: sectors, companies and market caps from Nasdaq (once a day); live: Yahoo prices (every refresh);
  // refs: Yahoo closes a week … a year back (once per New York day)
  let state = readJSON("map-cache.json", null) || { sectors: [], universeAt: 0, live: {}, fetchedAt: 0 };
  let refs = readJSON("map-refs-cache.json", null) || { date: 0, refs: {} };
  let inflight = null, timer = null, error = null;

  const symbols = () => state.sectors.flatMap((s) => s.firms.map((f) => f.sym));
  const refsReady = () => { const all = symbols(); return all.length > 0 && refs.date === nyYmd() && all.every((s) => s in refs.refs); };
  const snapshot = () => ({ periods: PERIODS, top: TOP, sectors: view(state.sectors, refs.date === nyYmd() ? refs.refs : {}, state.live), fetchedAt: state.fetchedAt, open: usMarketOpen(), error, refsReady: refsReady(), busy: !!inflight });
  const interval = () => (usMarketOpen() ? 5 : 30) * 60000;
  const report = (level, detail) => ctx.reportHealth?.("map", { label: "Sector map (Nasdaq + Yahoo)", at: state.fetchedAt, level, detail });

  /** Run fn(batch, bars by symbol) over `syms`, 20 per Yahoo request, 3 requests at a time; returns how many batches failed. */
  async function batches(syms, params, fn) {
    const list = [];
    for (let i = 0; i < syms.length; i += BATCH) list.push(syms.slice(i, i + BATCH));
    let next = 0, failed = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < list.length) {
        const batch = list[next++];
        let got = null;
        for (let attempt = 0; attempt < 2 && !got; attempt++) {
          try { got = await yahoo.spark(batch, params); } catch { await new Promise((r) => setTimeout(r, 800)); }
        }
        if (!got) { failed++; continue; }
        const bars = {};
        for (const s of batch) bars[s] = got[s] ? barsFromChart({ chart: { result: [got[s]] } })?.bars : null;
        fn(batch, bars);
      }
    }));
    return failed;
  }

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        if (!state.sectors.length || Date.now() - state.universeAt > UNIVERSE_TTL) {
          const sectors = buildSectors((await nasdaq.screener())?.data?.rows);
          if (!sectors.length) throw new Error("Nasdaq returned no stocks");
          state = { ...state, sectors, universeAt: Date.now() };
          if (!state.fetchedAt) send("map:update", snapshot()); // first run: show Nasdaq's own figures while Yahoo loads
        }
        const all = symbols(), live = {};
        const failed = await batches(all, { range: "5d", interval: "1d" }, (batch, bars) => { for (const s of batch) { const q = liveQuote(bars[s]); if (q) live[s] = q; } });
        if (!Object.keys(live).length) throw new Error("Yahoo returned no prices");
        state = { ...state, live: { ...(failed ? state.live : {}), ...live }, fetchedAt: Date.now() };
        error = null;
        writeJSON("map-cache.json", state);
        send("map:update", snapshot()); // the day's move shows first; longer periods fill in below

        const today = nyYmd();
        if (refs.date !== today) refs = { date: today, refs: {} };
        const missing = all.filter((s) => !(s in refs.refs));
        if (missing.length) {
          // a symbol Yahoo doesn't answer is stored as null so it isn't asked again today
          await batches(missing, { range: "2y", interval: "1d" }, (batch, bars) => { for (const s of batch) refs.refs[s] = periodRefs(bars[s], today); });
          writeJSON("map-refs-cache.json", refs);
        }
        const have = all.filter((s) => refs.refs[s]).length;
        report(have > all.length * 0.9 && !failed ? "ok" : "warn", `${all.length} companies in ${state.sectors.length} sectors · price history for ${have}`);
      } catch (e) {
        error = String(e.message || e);
        report(state.fetchedAt ? "warn" : "bad", `refresh failed: ${error}${state.fetchedAt ? " · showing the last good copy" : ""}`);
      }
    })().finally(() => { inflight = null; send("map:update", snapshot()); schedule(); });
    return inflight;
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, error ? 60000 : Math.max(5000, state.fetchedAt + interval() - Date.now()));
  }

  // lazy: nothing is fetched until the page is first opened
  ipcMain.handle("map:get", () => {
    if (Date.now() - state.fetchedAt > interval() || !refsReady()) refresh(); else if (!timer) schedule();
    return snapshot();
  });
  ipcMain.handle("map:refresh", async () => { await refresh(); return snapshot(); });
}

module.exports = { register, PERIODS, TOP, isCommon, baseName, yahooSymbol, buildSectors, nyYmd, periodRefs, liveQuote, firmNow, groupReturn, view };
