// Portfolio: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, expose, ... }
//  - IPC channels must start with "portfolio:" (the preload only forwards those for this page)
//  - publishes ctx.expose.portfolio() (summary for the Brief) and ctx.expose.holdings() (symbols for the Calendar)
//
// Holdings live in userData/portfolio.json: [{ sym, name, shares, cost, cls }]. `cost` is the average price paid
// per share (optional); `cls` is the asset class that maps the holding onto a Scorecards outlook, guessed from
// the symbol when it's added and changeable in the app. Prices are Yahoo's delayed quotes, converted to USD.
const quotes = require("./quotes");
const WL = require("./watchlist");

const CLASSES = [["stocks", "Stocks"], ["bonds", "Bonds"], ["commodities", "Commodities"], ["realestate", "Real Estate"],
  ["crypto", "Crypto"], ["alts", "Gold & silver"], ["cash", "Cash"]];
const CLASS_KEYS = CLASSES.map(([k]) => k);
// Scorecards has no outlook for cash; everything else matches an asset of the same key
const SCORED = new Set(["stocks", "bonds", "commodities", "realestate", "crypto", "alts"]);

// well-known funds whose class a symbol alone doesn't give away
const KNOWN = {
  bonds: "AGG BND TLT IEF IEI SHY TLH EDV ZROZ GOVT VGIT VGLT VGSH BSV BIV BLV BNDX LQD HYG JNK TIP SCHP SCHZ SCHR SPTL SPTI MUB VCIT VCSH IGIB EMB VTEB FBND",
  cash: "BIL SGOV SHV USFR TFLO MINT JPST VMFXX SPAXX FDRXX SWVXX",
  commodities: "USO BNO UNG DBC PDBC GSG DBA CPER COMT CL=F BZ=F NG=F HG=F",
  alts: "GLD IAU GLDM SGOL SLV SIVR PPLT GC=F SI=F",
  realestate: "VNQ VNQI XLRE IYR SCHH RWR REET USRT O PLD AMT SPG EQIX PSA WELL DLR CCI VICI",
  crypto: "IBIT FBTC GBTC BITO ARKB BITB HODL ETHA ETHE FETH"
};
const KNOWN_MAP = new Map(Object.entries(KNOWN).flatMap(([cls, s]) => s.split(" ").map((sym) => [sym, cls])));

/** Best guess at a holding's asset class from its symbol and Yahoo's instrument type. */
function guessClass(sym, type = "") {
  if (KNOWN_MAP.has(sym)) return KNOWN_MAP.get(sym);
  if (/^[A-Z0-9]+-USD$/.test(sym) || /crypto/i.test(type)) return "crypto";
  if (/=X$/.test(sym) || /currency/i.test(type)) return "cash";
  if (/=F$/.test(sym) || /future/i.test(type)) return "commodities";
  return "stocks";
}

const num = (v) => (v === "" || v == null ? NaN : Number(v));

/** Clean up holdings read from disk or sent by the app; drops junk and duplicates. */
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(), out = [];
  for (const h of list) {
    const sym = WL.normalizeSymbol(h?.sym);
    const shares = num(h?.shares), cost = num(h?.cost);
    if (!sym || seen.has(sym) || !(shares > 0) || !isFinite(shares)) continue;
    seen.add(sym);
    out.push({
      sym, name: String(h.name || sym).slice(0, 120), shares,
      cost: cost >= 0 && isFinite(cost) ? cost : null,
      cls: CLASS_KEYS.includes(h.cls) ? h.cls : guessClass(sym)
    });
  }
  return out;
}

/** Yahoo quotes London prices in pence ("GBp"); everything else is in its currency's main unit. */
function unitCurrency(c) {
  if (c === "GBp" || c === "GBX") return ["GBP", 0.01];
  if (c === "ZAc") return ["ZAR", 0.01];
  if (c === "ILA") return ["ILS", 0.01];
  return [c || "USD", 1];
}

/**
 * Positions, totals, asset mix and the portfolio's outlook. Pure, for tests.
 * quotesBy: { sym: { last, prev, currency } }; fx: { CUR: USD per unit }; scores: Scorecards assets ({ stocks: { score }, ... }).
 * Values are in USD. `cost` is in the quote's own unit (what you'd read off the price).
 */
function summarize(holdings, quotesBy, fx = {}, scores = {}) {
  const rows = holdings.map((h) => {
    const q = quotesBy[h.sym] || {};
    const [cur, mult] = unitCurrency(q.currency);
    const rate = cur === "USD" ? 1 : fx[cur] ?? null;
    const ok = q.last != null && rate != null;
    const k = ok ? mult * rate : null;
    const value = ok ? h.shares * q.last * k : null;
    const dayPnl = ok && q.prev ? h.shares * (q.last - q.prev) * k : null;
    const basis = ok && h.cost != null ? h.shares * h.cost * k : null;
    const gain = basis != null ? value - basis : null;
    return {
      ...h, last: q.last ?? null, prev: q.prev ?? null, currency: q.currency || null,
      pct: q.last != null && q.prev ? ((q.last - q.prev) / q.prev) * 100 : null,
      value, dayPnl, basis, gain, gainPct: basis ? (gain / basis) * 100 : null, weight: null
    };
  });
  const sum = (xs) => xs.reduce((a, x) => a + (x || 0), 0);
  const value = sum(rows.map((r) => r.value));
  const dayPnl = sum(rows.map((r) => r.dayPnl));
  const priced = rows.filter((r) => r.basis != null);
  const basis = sum(priced.map((r) => r.basis));
  const gain = priced.length ? sum(priced.map((r) => r.gain)) : null;
  for (const r of rows) r.weight = value && r.value != null ? (r.value / value) * 100 : null;

  const mix = CLASSES.map(([cls, label]) => {
    const v = sum(rows.filter((r) => r.cls === cls).map((r) => r.value));
    const s = SCORED.has(cls) ? scores?.[cls]?.score ?? null : null;
    return { cls, label, value: v, weight: value ? (v / value) * 100 : 0, score: s };
  }).filter((m) => m.value > 0);
  // the outlook: the Scorecards scores weighted by how much of the (scored, non-cash) portfolio sits in each class
  const scored = mix.filter((m) => m.score != null);
  const sv = sum(scored.map((m) => m.value));
  const outlook = sv ? Math.round(scored.reduce((a, m) => a + m.score * m.value, 0) / sv) : null;
  const cash = mix.find((m) => m.cls === "cash")?.weight || 0;

  return {
    rows,
    total: { value, dayPnl, dayPct: value - dayPnl ? (dayPnl / (value - dayPnl)) * 100 : null, basis: priced.length ? basis : null, gain, gainPct: basis ? (gain / basis) * 100 : null, partialCost: priced.length > 0 && priced.length < rows.length },
    mix, outlook, cash, missing: rows.filter((r) => r.value == null).map((r) => r.sym)
  };
}

/** Recent stories that mention a holding, newest first, each with the symbols it mentions. */
function newsFor(stories, holdings, hours = 72, max = 30) {
  if (!holdings.length) return [];
  const list = holdings.map((h) => ({ sym: h.sym, name: h.name, terms: WL.defaultTerms(h.sym, h.name) }));
  const cut = Date.now() - hours * 3600e3;
  const recent = (stories || []).filter((s) => s.updated >= cut);
  return WL.tagStories(recent, list).filter((s) => s.watch?.length).sort((a, b) => b.updated - a.updated).slice(0, max)
    .map((s) => ({ id: s.id, title: s.title, code: s.code, sev: s.sev, updated: s.updated, syms: s.watch, link: s.link }));
}

// ---------- wiring ----------
function register(ctx) {
  let holdings = sanitize(ctx.readJSON("portfolio.json", []));
  let quotesBy = {}, fx = {}, fetchedAt = 0, loading = null;

  const save = () => ctx.writeJSON("portfolio.json", holdings);
  function snapshot() {
    const s = summarize(holdings, quotesBy, fx, ctx.get().scores?.assets);
    return { ...s, news: newsFor(ctx.get().stories, holdings), classes: CLASSES, fetchedAt, loading: !!loading };
  }
  const push = () => ctx.send("portfolio:update", snapshot());

  async function refresh() {
    if (loading) return loading;
    if (!holdings.length) { quotesBy = {}; fetchedAt = Date.now(); return; }
    loading = (async () => {
      const qs = await Promise.all(holdings.map((h) => quotes.quoteOne([h.sym, h.sym, "px"])));
      const next = {};
      for (const q of qs) if (q.last != null) next[q.sym] = q;
      quotesBy = { ...quotesBy, ...next };
      const curs = [...new Set(Object.values(quotesBy).map((q) => unitCurrency(q.currency)[0]))].filter((c) => c !== "USD");
      const rates = await Promise.all(curs.map((c) => quotes.quoteOne([`${c}USD=X`, c, "fx"])));
      for (const r of rates) if (r.last != null) fx[r.label] = r.last;
      fetchedAt = Date.now();
    })().catch((e) => console.error("portfolio quotes", e)).finally(() => { loading = null; push(); });
    push();
    return loading;
  }

  async function add(sym, shares, cost) {
    sym = WL.normalizeSymbol(sym);
    if (!sym) return { ok: false, error: "Type a ticker, like AAPL or VOO." };
    if (!(num(shares) > 0)) return { ok: false, error: "Enter how many shares (or units) you own." };
    if (cost !== "" && cost != null && !(num(cost) >= 0)) return { ok: false, error: "Average cost should be a price per share, like 182.50." };
    let info;
    try { info = await quotes.lookupSymbol(sym); } catch (e) { return { ok: false, error: String(e.message || e) }; }
    const s = WL.normalizeSymbol(info.sym);
    const existing = holdings.find((h) => h.sym === s);
    if (existing) return { ok: false, error: `${s} is already in your portfolio. Select it to change the shares.` };
    holdings = sanitize([...holdings, { sym: s, name: info.name, shares, cost, cls: guessClass(s, info.type) }]);
    save(); refresh();
    return { ok: true, sym: s };
  }
  function update(sym, patch = {}) {
    const h = holdings.find((x) => x.sym === sym);
    if (!h) return { ok: false, error: "Not in your portfolio." };
    const next = { ...h };
    if ("shares" in patch) { if (!(num(patch.shares) > 0)) return { ok: false, error: "Shares must be more than 0." }; next.shares = num(patch.shares); }
    if ("cost" in patch) { const c = num(patch.cost); if (patch.cost !== "" && patch.cost != null && !(c >= 0)) return { ok: false, error: "Average cost should be a price, like 182.50." }; next.cost = isNaN(c) ? null : c; }
    if ("cls" in patch && CLASS_KEYS.includes(patch.cls)) next.cls = patch.cls;
    holdings = sanitize(holdings.map((x) => (x.sym === sym ? next : x)));
    save(); push();
    return { ok: true };
  }
  function remove(sym) {
    holdings = holdings.filter((h) => h.sym !== sym);
    delete quotesBy[sym];
    save(); push();
    return { ok: true };
  }

  ctx.ipcMain.handle("portfolio:get", () => { if (Date.now() - fetchedAt > 60e3) refresh(); return snapshot(); });
  ctx.ipcMain.handle("portfolio:refresh", async () => { await refresh(); return snapshot(); });
  ctx.ipcMain.handle("portfolio:add", (_e, sym, shares, cost) => add(String(sym || ""), shares, cost));
  ctx.ipcMain.handle("portfolio:update", (_e, sym, patch) => update(String(sym || ""), patch && typeof patch === "object" ? patch : {}));
  ctx.ipcMain.handle("portfolio:remove", (_e, sym) => remove(String(sym || "")));
  ctx.bus?.on?.("scores", push);
  ctx.bus?.on?.("news", push);
  ctx.expose.portfolio = snapshot;
  ctx.expose.holdings = () => holdings;
  ctx.expose.refreshPortfolio = () => (Date.now() - fetchedAt > 60e3 ? refresh() : null);
  setTimeout(refresh, 5000);
  setInterval(refresh, 2 * 60e3);
}

module.exports = { register, sanitize, summarize, guessClass, newsFor, unitCurrency, CLASSES };
