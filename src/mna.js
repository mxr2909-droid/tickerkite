// M&A page: main-process side. main.js calls register(ctx) once at startup; IPC channels start with "mna:".
// Everything comes from SEC EDGAR (public domain, no key):
//  - Deals: the filings a US-listed target must make when it is being bought. A tender offer (SC TO-T), a merger
//    proxy (PREM14A, then DEFM14A) or a going-private statement (SC 13E3), found with EDGAR full-text search.
//    Filings about the same target are folded into one deal.
//  - Deal size: the "Transaction Valuation" in the filing's fee exhibit (the SEC charges a fee on the deal's value),
//    read from www.sec.gov, which needs the contact email the Company page already asks for.
//  - Closings: how many 8-Ks each month report Item 2.01, "Completion of Acquisition or Disposition of Assets".
//  - Spending: cash paid for acquisitions by every SEC filer, by year, from the XBRL "frames" API.
// Deals between private companies file nothing with the SEC and are not here.
const http = require("./data/http");
const alertsMod = require("./mna-alerts");
const SIC = require("./data/sic.json");
const yahoo = require("./data/yahoo");

const DAY = 864e5;
const YEARS = 3;
const FORMS = ["SC TO-T", "PREM14A", "DEFM14A", "SC 13E3"];
const KIND = { "SC TO-T": "tender", PREM14A: "merger", DEFM14A: "merger", "SC 13E3": "private" };
const EFTS = "https://efts.sec.gov/LATEST/search-index";
const FRAMES = "https://data.sec.gov/api/xbrl/frames/us-gaap/PaymentsToAcquireBusinessesNetOfCashAcquired/USD";
const SPEND_FROM = 2010;
const DEAL_GAP_DAYS = 270; // filings about one target further apart than this are separate deals
const ACTIVE_DAYS = 90;    // a deal with a filing this recent is still in progress

// ---------- sectors (pure) ----------
// First match wins. Sub-sector is the SEC's own industry title for the code (src/data/sic.json).
const SECTOR_RULES = [
  [6770, 6770, "SPACs & shells"],
  [2833, 2836, "Health care"], [3841, 3851, "Health care"], [8000, 8099, "Health care"], [8731, 8734, "Health care"], [5047, 5047, "Health care"], [5122, 5122, "Health care"], [5912, 5912, "Health care"], [6324, 6324, "Health care"], [3826, 3826, "Health care"],
  [3570, 3579, "Technology"], [3661, 3679, "Technology"], [7370, 7379, "Technology"], [5045, 5045, "Technology"], [3695, 3695, "Technology"],
  [4812, 4899, "Communication & media"], [2711, 2741, "Communication & media"], [7310, 7319, "Communication & media"], [7812, 7841, "Communication & media"],
  [6500, 6599, "Real estate"], [6798, 6798, "Real estate"],
  [6000, 6499, "Financials"], [6700, 6799, "Financials"],
  [1200, 1389, "Energy"], [2900, 2999, "Energy"], [3533, 3533, "Energy"], [4600, 4619, "Energy"], [4922, 4925, "Energy"], [5171, 5172, "Energy"],
  [4900, 4999, "Utilities"],
  [1000, 1099, "Materials"], [1400, 1499, "Materials"], [2400, 2499, "Materials"], [2600, 2699, "Materials"], [2800, 2899, "Materials"], [3080, 3089, "Materials"], [3200, 3399, "Materials"],
  [1500, 1799, "Industrials"], [3400, 3569, "Industrials"], [3580, 3629, "Industrials"], [3640, 3649, "Industrials"], [3690, 3694, "Industrials"], [3710, 3829, "Industrials"], [4000, 4799, "Industrials"], [7320, 7389, "Industrials"], [8700, 8749, "Industrials"],
  [100, 999, "Consumer"], [2000, 2399, "Consumer"], [2500, 2599, "Consumer"], [2750, 2799, "Consumer"], [3000, 3199, "Consumer"], [3630, 3659, "Consumer"], [3860, 3873, "Consumer"], [3900, 3999, "Consumer"], [8900, 8999, "Consumer"], [5000, 5999, "Consumer"], [7000, 7299, "Consumer"], [7500, 7999, "Consumer"], [8100, 8699, "Consumer"]
];
const SECTORS = ["Technology", "Health care", "Financials", "Real estate", "Industrials", "Consumer", "Energy", "Materials", "Communication & media", "Utilities", "SPACs & shells", "Other"];

function sectorOf(sic) {
  const n = +sic;
  if (!(n > 0)) return "Other";
  for (const [lo, hi, s] of SECTOR_RULES) if (n >= lo && n <= hi) return s;
  return "Other";
}
const industryOf = (sic) => SIC[String(+sic || "")] || (sic ? `SIC ${sic}` : "Not classified");

// ---------- names (pure) ----------
const SMALL = new Set(["of", "and", "the", "for", "de", "la", "du"]);
const KEEP = /^(LLC|LP|LLP|PLC|SA|SE|NV|AG|AB|ASA|USA|US|II|III|IV|REIT|ETF|AI|IT|BV|SAS|AS|KK|ADR|HCA|IBM|AT&T|N\.V\.|S\.A\.|L\.P\.)$/;
/** "ULTRALIFE CORP" → "Ultralife Corp"; names already in mixed case are left alone. */
function tidyName(s) {
  let n = String(s || "").replace(/\\[A-Z]{2}\\/g, "").replace(/\/[A-Z]{2}\/?$/g, "").replace(/\s+/g, " ").trim();
  if (n && n === n.toUpperCase()) {
    n = n.split(" ").map((w, i) => (KEEP.test(w) || (w.length <= 4 && /^[A-Z&]+$/.test(w) && !/[AEIOUY]/.test(w)) ? w : i && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase())).join(" ");
  }
  return n;
}
/** EDGAR display name "Pacira BioSciences, Inc.  (PCRX)  (CIK 0001396814)" → { name, tickers, cik }. */
function parseEntity(display) {
  const s = String(display || "");
  const cik = (/\(CIK (\d+)\)/.exec(s) || [])[1] || "";
  const rest = s.replace(/\(CIK \d+\)/, "").trim();
  const t = /\(([A-Z0-9.,\- ]+)\)\s*$/.exec(rest);
  return { name: tidyName(t ? rest.slice(0, t.index) : rest), tickers: t ? t[1].split(",").map((x) => x.trim()).filter(Boolean) : [], cik: cik.replace(/^0+/, "") };
}

// ---------- filings → deals (pure) ----------
/** One EDGAR full-text-search hit → a compact filing record, or null when it isn't one of our forms. */
function filingFromHit(hit) {
  const s = hit?._source;
  if (!s?.adsh || !s.file_date) return null;
  const root = (s.root_forms && s.root_forms[0]) || String(s.form || "").replace(/\/A$/, "");
  if (!KIND[root]) return null;
  return { a: s.adsh, f: s.form || root, r: root, d: s.file_date, n: s.display_names || [], s: s.sics || [], st: s.biz_states || [], doc: String(hit._id || "").split(":")[1] || "" };
}

const filingUrl = (cik, adsh, doc) => `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}/${doc || adsh + "-index.htm"}`;
const isShell = (name) => /\b(merger sub|acquisition sub|merger corp|acquisition corp|purchaser|merger subsidiary|holdco|bidco|parent,? (inc|llc|l\.p\.))\b/i.test(name);

/**
 * Fold filings into deals. A deal is every filing about one target with no gap longer than DEAL_GAP_DAYS.
 * sizes: { adsh: { v, px } } from the fee exhibits. Returns deals newest first.
 */
function buildDeals(filings, sizes = {}, now = Date.now()) {
  const byTarget = new Map();
  for (const f of filings) {
    const ents = f.n.map(parseEntity), target = ents[0];
    if (!target?.cik) continue;
    (byTarget.get(target.cik) || byTarget.set(target.cik, []).get(target.cik)).push({ f, ents });
  }
  const deals = [];
  for (const [cik, list] of byTarget) {
    list.sort((x, y) => (x.f.d < y.f.d ? -1 : x.f.d > y.f.d ? 1 : 0));
    let cur = null;
    for (const it of list) {
      const t = Date.parse(it.f.d);
      if (!cur || t - cur.lastT > DEAL_GAP_DAYS * DAY) { cur = { cik, items: [], lastT: t }; deals.push(cur); }
      cur.items.push(it); cur.lastT = t;
    }
  }
  return deals.map((g) => {
    const items = g.items, first = items[0], last = items[items.length - 1];
    // the newest filing has the freshest name and ticker
    const target = last.ents[0], sic = last.f.s[0] || first.f.s[0] || "";
    const kinds = new Set(items.map((x) => KIND[x.f.r]));
    const buyers = new Map();
    for (const it of items) if (it.f.r !== "PREM14A" && it.f.r !== "DEFM14A") for (const e of it.ents.slice(1)) if (e.cik && e.cik !== g.cik && !buyers.has(e.cik)) buyers.set(e.cik, e);
    const acquirers = [...buyers.values()].sort((a, b) => isShell(a.name) - isShell(b.name)).map((e) => ({ name: e.name, tickers: e.tickers, cik: e.cik }));
    const sector = sectorOf(sic);
    const type = sector === "SPACs & shells" ? "SPAC merger" : kinds.has("private") ? "Going private" : kinds.has("tender") ? "Tender offer" : "Merger";
    const hasDef = items.some((x) => x.f.r === "DEFM14A");
    const stage = kinds.has("tender") ? "Tender offer filed" : hasDef ? "Vote scheduled" : kinds.has("merger") ? "Preliminary proxy" : "Going-private filing";
    // where to read the size: the first original filing that carries a fee table, tender offers first
    const rank = { "SC TO-T": 0, PREM14A: 1, "SC 13E3": 2, DEFM14A: 3 };
    const src = [...items].sort((x, y) => (/\/A$/.test(x.f.f) - /\/A$/.test(y.f.f)) || rank[x.f.r] - rank[y.f.r] || (x.f.d < y.f.d ? -1 : 1));
    let value = null, price = null;
    for (const it of src) { const z = sizes[it.f.a]; if (z?.v) { value = z.v; price = z.px ?? null; break; } }
    const lastDate = last.f.d;
    return {
      id: `${g.cik}-${first.f.d}`, target: { name: target.name, tickers: target.tickers, cik: g.cik }, acquirers,
      sic, sector, industry: industryOf(sic), state: last.f.st[0] || "", type, stage, kinds: [...kinds],
      date: first.f.d, lastDate, active: now - Date.parse(lastDate) <= ACTIVE_DAYS * DAY,
      value, price, sizeFrom: src.slice(0, 3).map((x) => x.f.a), sized: src.some((x) => sizes[x.f.a]),
      filings: [...items].reverse().map((x) => ({ form: x.f.f, date: x.f.d, adsh: x.f.a, url: filingUrl(g.cik, x.f.a, x.f.doc) }))
    };
  }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.value || 0) - (a.value || 0)));
}

// ---------- fee exhibit (pure) ----------
const num = (s) => { const v = parseFloat(String(s).replace(/[$,\s]/g, "")); return isFinite(v) ? v : null; };
const plain = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ");

/** The deal's value and per-share price from a filing-fee exhibit (inline XBRL since 2024, plain HTML before). */
function parseFee(html) {
  const h = String(html || "");
  let v = null;
  for (const tag of ["TtlTxValtn", "TxValtn"]) {
    const m = new RegExp(`name="ffd:${tag}"[^>]*>\\s*(?:<[^>]+>\\s*)*\\$?\\s*([\\d,]+(?:\\.\\d+)?)`).exec(h);
    if (m && num(m[1]) > 0) { v = num(m[1]); break; }
  }
  const t = plain(h);
  if (v == null) {
    const m = /Total Transaction Valuation:?\s*\$?\s*([\d,]{6,}(?:\.\d+)?)/i.exec(t)
      || /(?:Transaction Valuation|Proposed Maximum Aggregate Value of Transaction)\*{0,2}(?:\s*\(\d\))?[^$]{0,160}\$\s*([\d,]{6,}(?:\.\d+)?)/i.exec(t);
    if (m) v = num(m[1]);
  }
  const p = /(?:offer price|merger consideration|purchase price|cash consideration|price)\s+of\s+(?:US)?\$\s*([\d,]+(?:\.\d+)?)\s+per\s+(?:share|ADS|unit|common share|ordinary share)/i.exec(t)
    || /\$\s*([\d,]+(?:\.\d+)?)\s+per\s+(?:share|ADS)[^.]{0,40}(?:in cash|net to the seller)/i.exec(t)
    || /\$\s*([\d,]+\.\d{2,4})\s+(?:in cash\s+)?per\s+(?:share|ADS|unit)\b/i.exec(t);
  return { v: v != null && v >= 1e5 && v < 5e12 ? Math.round(v) : null, px: p ? num(p[1]) : null };
}

/** The fee exhibit's file name from a filing's index.json listing, or null. */
function feeDocFromIndex(j) {
  const names = (j?.directory?.item || []).map((i) => String(i.name || ""));
  const htm = names.filter((n) => /\.html?$/i.test(n) && !/index/i.test(n));
  return htm.find((n) => /filing ?fee|ex-?fee|exfee|ex-?107|ex_?107|feetable|fee_?table/i.test(n)) || htm.find((n) => /fee/i.test(n)) || null;
}

// ---------- market statistics (pure) ----------
/** "2026-11" keys for the n months ending at `now`, oldest first. */
function monthKeys(n, now = Date.now()) {
  const d = new Date(now), out = [];
  for (let i = n - 1; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.toISOString().slice(0, 7)); }
  return out;
}

/** One year of acquisition spending from an XBRL frame: total, how many companies, how many spent $1bn+, the top spenders. */
function spendFromFrame(j, year) {
  const rows = (j?.data || []).filter((r) => r.val > 0 && r.val < 2.5e11);
  rows.sort((a, b) => b.val - a.val);
  return {
    year, total: rows.reduce((s, r) => s + r.val, 0), n: rows.length, big: rows.filter((r) => r.val >= 1e9).length,
    top: rows.slice(0, 10).map((r) => ({ name: tidyName(r.entityName), cik: String(r.cik), val: r.val }))
  };
}

// ---------- merger-arbitrage spread (pure) ----------
// The gap between the offer price per share and where the target trades. The same band edges are in
// renderer/mnastats.js (SPREAD_BANDS) so the page and this file agree; change both together.
const SPREAD = { over: -0.5, tight: 2, wide: 8, lo: -40, hi: 80 };
const SPREAD_TEXT = {
  tight: ["Expected to close", "The market expects this to close at the offer."],
  some: ["Some doubt", "Some doubt, or a long wait: the gap is the return for holding until it closes."],
  wide: ["Wide gap", "The market doubts this closes on these terms."],
  over: ["Above the offer", "The stock is above the offer: the market expects a higher bid."]
};
/** (offer − last) ÷ last in percent; null when a price is missing, or when the gap is too large to be real
    (outside −40%…+80%: the parsed offer or the ticker is wrong, e.g. an ADS ratio or a unit ticker). */
function spreadOf(offer, last) {
  if (!(offer > 0) || !(last > 0)) return null;
  const p = ((offer - last) / last) * 100;
  return p < SPREAD.lo || p > SPREAD.hi ? null : p;
}
/** What a gap means in plain English: { key: tight | some | wide | over, label, text }, or null. */
function spreadRead(pct) {
  if (pct == null || !isFinite(pct)) return null;
  const key = pct < SPREAD.over ? "over" : pct < SPREAD.tight ? "tight" : pct <= SPREAD.wide ? "some" : "wide";
  return { key, label: SPREAD_TEXT[key][0], text: SPREAD_TEXT[key][1] };
}
/** { last, prev, at } from one Yahoo chart result (daily bars), or null. */
function quoteFromChart(r, at = Date.now()) {
  const close = (r?.indicators?.quote?.[0]?.close || []).filter((v) => v > 0), m = r?.meta || {};
  const last = m.regularMarketPrice > 0 ? m.regularMarketPrice : close[close.length - 1];
  if (!(last > 0)) return null;
  const prev = close.length >= 2 ? close[close.length - 2] : m.chartPreviousClose > 0 ? m.chartPreviousClose : null;
  return { last, prev, at };
}
/** Deals whose target's price is worth fetching: in progress, with an offer price and a ticker, not a SPAC. */
const quotable = (d) => !!(d.active && d.price > 0 && d.target.tickers[0] && d.type !== "SPAC merger");

// ---------- fetching ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function register(ctx) {
  const { ipcMain, send, readJSON, writeJSON } = ctx;
  const blank = { filings: {}, sizes: {}, closings: {}, spend: {}, fetchedAt: 0, through: "", closingsAt: 0, spendAt: 0 };
  let C = { ...blank, ...(readJSON("mna-cache.json", null) || {}) };
  if (!C.quotes || typeof C.quotes !== "object") C.quotes = {}; // { TICKER: { last, prev, at } } for the spread to the offer
  let loading = null, sizing = false, error = "", sizeLeft = 0, lastSave = 0;

  const contact = () => ctx.prefs?.().secContact || "";
  const headers = () => ({ "User-Agent": contact() ? `${http.UA} ${contact()}` : http.UA });
  /** EDGAR's search answers 500 now and then under load: try three times before giving up. */
  async function get(kind, url, timeoutMs) {
    for (let k = 0; ; k++) {
      try { return await (kind === "text" ? http.getText : http.getJSON)(url, { headers: headers(), timeoutMs }); }
      catch (e) { if (k >= 2 || (e.status && e.status < 500 && e.status !== 429)) throw e; await sleep(900 * (k + 1)); }
    }
  }
  const save = (force) => { if (force || Date.now() - lastSave > 15000) { lastSave = Date.now(); writeJSON("mna-cache.json", C); } };

  function snapshot() {
    const deals = buildDeals(Object.values(C.filings), C.sizes);
    for (const d of deals) {
      const q = quotable(d) ? C.quotes[d.target.tickers[0]] : null;
      d.last = q?.last ?? null; d.spread = q ? spreadOf(d.price, q.last) : null; d.dayPct = q?.prev > 0 ? (q.last / q.prev - 1) * 100 : null;
    }
    const months = monthKeys(YEARS * 12 + 1);
    return {
      deals, months, closings: months.map((m) => [m, C.closings[m] ?? null]),
      spend: Object.values(C.spend).sort((a, b) => a.year - b.year),
      sectors: SECTORS, years: YEARS, fetchedAt: C.fetchedAt, loading: !!loading, error,
      sizing: { active: sizing, left: sizeLeft, known: deals.filter((d) => d.value).length, total: deals.length },
      needsContact: !contact(), quotesAt: C.quotesAt || 0
    };
  }
  const push = () => send("mna:update", snapshot());
  const alerts = alertsMod.attach(ctx, () => buildDeals(Object.values(C.filings), C.sizes));

  /** Every deal filing from `from` (yyyy-mm-dd) to today, 100 a page. */
  async function fetchFilings(from) {
    const q = `${EFTS}?q=&forms=${FORMS.map(encodeURIComponent).join(",")}&dateRange=custom&startdt=${from}&enddt=${iso(Date.now())}`;
    for (let page = 0; page < 100; page++) {
      const j = await get("json", `${q}&from=${page * 100}`, 20000);
      const hits = j?.hits?.hits || [];
      for (const h of hits) { const f = filingFromHit(h); if (f) C.filings[f.a] = f; }
      if (hits.length < 100) break;
      await sleep(150);
    }
  }

  /** 8-Ks reporting a completed acquisition or sale, counted by month (only the request's total is read). */
  async function fetchClosings() {
    const months = monthKeys(YEARS * 12 + 1), nowKey = months[months.length - 1], prevKey = months[months.length - 2];
    for (const m of months) {
      if (C.closings[m] != null && m !== nowKey && m !== prevKey) continue;
      const [y, mo] = m.split("-").map(Number), end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      try {
        const j = await get("json", `${EFTS}?q=${encodeURIComponent('"Completion of Acquisition or Disposition of Assets"')}&forms=8-K&dateRange=custom&startdt=${m}-01&enddt=${end}`, 20000);
        const v = j?.hits?.total?.value;
        if (typeof v === "number") C.closings[m] = v;
      } catch {}
      await sleep(150);
    }
    for (const k of Object.keys(C.closings)) if (!months.includes(k)) delete C.closings[k];
    C.closingsAt = Date.now();
  }

  /** Acquisition spending by year. Past years are fetched once; the two latest are re-read weekly as late filers report. */
  async function fetchSpend() {
    const last = new Date().getUTCFullYear() - 1, fresh = Date.now() - C.spendAt < 7 * DAY;
    for (let y = SPEND_FROM; y <= last; y++) {
      if (C.spend[y] && (y < last - 1 || fresh)) continue;
      try { C.spend[y] = spendFromFrame(await get("json", `${FRAMES}/CY${y}.json`, 30000), y); } catch {}
      await sleep(150);
    }
    C.spendAt = Date.now();
  }

  /** Read deal sizes from fee exhibits, newest deals first. Needs the SEC contact (www.sec.gov refuses without one). */
  async function sizeDeals() {
    if (sizing || !contact()) return;
    sizing = true;
    try {
      const todo = buildDeals(Object.values(C.filings), C.sizes).filter((d) => !d.value && d.sizeFrom.some((a) => !C.sizes[a]));
      sizeLeft = todo.length;
      let n = 0, next = 0, stop = false;
      // two deals at a time: four made the SEC answer 429 (too many requests)
      const worker = async () => {
        while (!stop && next < todo.length) {
          const d = todo[next++];
          for (const adsh of d.sizeFrom) {
            if (stop) return;
            if (C.sizes[adsh]) continue;
            const base = `https://www.sec.gov/Archives/edgar/data/${d.target.cik}/${adsh.replace(/-/g, "")}`;
            try {
              const doc = feeDocFromIndex(await get("json", `${base}/index.json`, 15000));
              await sleep(100);
              C.sizes[adsh] = doc ? { ...parseFee(await get("text", `${base}/${doc}`, 20000)), at: Date.now() } : { v: null, at: Date.now() };
            } catch (e) {
              if (e.status === 403 || e.status === 429) { stop = true; error = e.status === 403 ? "The SEC refused the request. Check the contact email in Settings." : "The SEC asked Tickerkite to slow down. Deal sizes will continue later."; return; }
              if (e.status === 404) C.sizes[adsh] = { v: null, at: Date.now() };
            }
            await sleep(100);
            if (C.sizes[adsh]?.v) break;
          }
          sizeLeft--;
          if (++n % 30 === 0) { save(); push(); }
        }
      };
      await Promise.all([worker(), worker()]);
      if (stop && /slow down/.test(error)) setTimeout(() => { error = ""; sizeDeals(); }, 10 * 60e3); // pick up again once the SEC has cooled off
    } finally { sizing = false; save(true); push(); try { alerts.check(); } catch {} }
  }

  /** The two slower series behind the charts. They load on their own so a stalled one never holds up the deal list. */
  let extrasBusy = false;
  async function extras(force) {
    if (extrasBusy) return;
    extrasBusy = true;
    try {
      if (force || Date.now() - C.closingsAt > 12 * 3600e3) { await fetchClosings(); save(true); push(); }
      if (force || Date.now() - C.spendAt > 7 * DAY || !Object.keys(C.spend).length) { await fetchSpend(); save(true); push(); }
    } catch {} finally { extrasBusy = false; }
  }

  /** Last prices for the targets of open offers, from Yahoo, 20 a request. Runs in the background and never holds up a
      snapshot; a ticker Yahoo doesn't know is skipped and not asked again for 15 minutes. */
  const QUOTE_TTL = 15 * 60e3, tried = {};
  let quoting = false;
  async function fetchQuotes() {
    if (quoting) return;
    const want = [...new Set(buildDeals(Object.values(C.filings), C.sizes).filter(quotable).map((d) => d.target.tickers[0]))];
    for (const k of Object.keys(C.quotes)) if (!want.includes(k)) delete C.quotes[k];
    const now = Date.now(), todo = want.filter((s) => now - (C.quotes[s]?.at || 0) > QUOTE_TTL && now - (tried[s] || 0) > QUOTE_TTL);
    if (!todo.length) return;
    quoting = true;
    try {
      for (let i = 0; i < todo.length; i += 20) {
        const batch = todo.slice(i, i + 20);
        let got = {};
        try { got = await yahoo.spark(batch, { range: "5d", interval: "1d" }); } catch {}
        for (const s of batch) { tried[s] = Date.now(); const q = quoteFromChart(got[s]); if (q) C.quotes[s] = q; }
      }
      C.quotesAt = Date.now();
      save(true); push();
    } catch {} finally { quoting = false; }
  }

  async function refresh(full) {
    if (loading) return loading;
    loading = (async () => {
      error = "";
      try {
        const start = iso(Date.now() - YEARS * 365.25 * DAY);
        // after the first load only the last few days are re-read (amendments and new deals)
        const from = !full && C.through && Object.keys(C.filings).length ? iso(Date.parse(C.through) - 4 * DAY) : start;
        await fetchFilings(from < start ? start : from);
        for (const [k, f] of Object.entries(C.filings)) if (f.d < start) delete C.filings[k];
        const live = new Set(Object.keys(C.filings));
        for (const k of Object.keys(C.sizes)) if (!live.has(k)) delete C.sizes[k];
        C.through = iso(Date.now()); C.fetchedAt = Date.now();
        save(true); push();
        try { alerts.check(); } catch {}
        sizeDeals(); // sizes are what the filters and charts wait for most: start them while the rest downloads
        await extras(true);
      } catch (e) { error = `SEC EDGAR didn't answer (${String(e.message || e)}).`; }
    })().finally(() => { loading = null; push(); sizeDeals(); fetchQuotes(); });
    push();
    return loading;
  }

  ipcMain.handle("mna:get", () => {
    if (Date.now() - C.fetchedAt > 6 * 3600e3) refresh(false); else { sizeDeals(); extras(false); }
    fetchQuotes();
    return snapshot();
  });
  ipcMain.handle("mna:refresh", async (_e, full) => { fetchQuotes(); await refresh(!!full); return snapshot(); });
  // the Company page saves the contact; start sizing as soon as there is one
  ctx.bus?.on?.("prefs:secContact", () => sizeDeals());
}

module.exports = { register, sectorOf, industryOf, tidyName, parseEntity, filingFromHit, buildDeals, parseFee, feeDocFromIndex, monthKeys, spendFromFrame, spreadOf, spreadRead, quoteFromChart, SPREAD, SECTORS, FORMS, YEARS };
