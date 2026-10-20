// Company page: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, readJSON, writeJSON, get, prefs }
//  - IPC channels start with "company:" (company:get / company:contact belong to the watchlist panel in main.js)
// For any US-listed stock: profile and filing list (SEC submissions), full statements and valuation (SEC company
// facts + Yahoo price), insider trades (Form 4 XML), institutional holders (Nasdaq, built from 13F filings) and
// WIRE's own headlines about it. www.sec.gov wants a contact email in the User-Agent; without one the page asks.
const company = require("./company");
const SEC = require("./sec");
const WL = require("./watchlist");

const DAY = 864e5;
const TTL = 24 * 3600e3;
const MAX_CACHED = 40;
const nasdaq = require("./data/nasdaq");
const http = require("./data/http");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const getText = (url, headers, timeoutMs = 15000) => http.getText(url, { headers, timeoutMs });

function register(ctx) {
  const contact = () => ctx.prefs().secContact || "";
  const secHeaders = () => ({ "User-Agent": contact() ? `${company.UA_BASE} ${contact()}` : company.UA_BASE, Accept: "application/json" });
  const pages = ctx.readJSON("company-page-cache.json", {});
  const insiders = ctx.readJSON("insider-cache.json", {}); // accession → parsed Form 4 (filings never change)
  const holders = {}; // sym → { at, data }
  let savePending = null;
  const saveSoon = () => { clearTimeout(savePending); savePending = setTimeout(() => {
    const keys = Object.keys(pages).sort((a, b) => pages[b].at - pages[a].at).slice(MAX_CACHED);
    for (const k of keys) delete pages[k];
    const acc = Object.keys(insiders);
    for (const k of acc.slice(0, Math.max(0, acc.length - 3000))) delete insiders[k];
    ctx.writeJSON("company-page-cache.json", pages); ctx.writeJSON("insider-cache.json", insiders);
  }, 2000); };

  async function cikOf(sym) {
    let tick = ctx.readJSON("sec-tickers.json", null);
    if (!tick || Date.now() - tick.at > TTL) {
      const j = await company.getJSON("https://www.sec.gov/files/company_tickers.json", secHeaders());
      tick = { at: Date.now(), map: Object.fromEntries(Object.values(j).map((r) => [String(r.ticker).toUpperCase(), r.cik_str])) };
      ctx.writeJSON("sec-tickers.json", tick);
    }
    return tick.map[sym] ?? tick.map[sym.replace(/-/g, ".")] ?? null;
  }

  async function page(sym, force) {
    sym = WL.normalizeSymbol(sym);
    if (!sym) return { ok: false, error: "No symbol." };
    let y;
    try { y = await company.yahoo(sym); } catch (e) { return { ok: false, sym, error: /404/.test(e.message) ? `No market data for "${sym}".` : `Couldn't reach Yahoo Finance (${e.message}).` }; }
    const quote = { price: y.price, currency: y.currency, type: y.type, closes: y.closes.slice(-60) };
    const base = { ok: true, sym, quote, watch: ctx.get().watch.some((w) => w.sym === sym), held: (ctx.expose.holdings?.() || []).some((h) => h.sym === sym) };
    if (y.type !== "EQUITY") return { ...base, sec: false, reason: `${sym} is ${({ ETF: "an ETF", MUTUALFUND: "a mutual fund", CRYPTOCURRENCY: "a cryptocurrency", FUTURE: "a futures contract", INDEX: "an index", CURRENCY: "a currency" })[y.type] || "not a company stock"}, so it has no company filings.` };

    let hit = pages[sym];
    if (force || !hit || Date.now() - hit.at > TTL) {
      try {
        const cik = await cikOf(sym);
        if (cik == null) return { ...base, sec: false, reason: `${sym} isn't in the SEC's list of filers. Foreign companies listed abroad don't file with the SEC.` };
        const pad = String(cik).padStart(10, "0");
        const [cf, sub] = await Promise.all([
          company.getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad}.json`, secHeaders(), 30000).catch((e) => (e.status === 404 ? null : Promise.reject(e))),
          company.getJSON(`https://data.sec.gov/submissions/CIK${pad}.json`, secHeaders(), 20000)
        ]);
        const s = SEC.parseSubmissions(sub);
        const summary = cf ? company.summarize(cf, { splits: y.splits }) : null;
        const statements = cf ? company.statements(cf, { splits: y.splits }) : { annual: [], quarterly: [] };
        const earnings = summary ? ((await company.nasdaqEarnings(sym)) || company.estimateNextReport(summary.filings)) : null;
        hit = { at: Date.now(), cik: String(cik), profile: s.profile, filings: s.filings, form4: s.form4, summary, statements, earnings };
        pages[sym] = hit; saveSoon();
      } catch (e) {
        if (e.status === 403) return { ...base, sec: true, needContact: true };
        if (!hit) return { ...base, sec: true, error: `Couldn't reach SEC EDGAR (${e.message}).` };
      }
    }
    let earnings = hit.earnings;
    if (earnings && Date.parse(earnings.date) < Date.now() - DAY && hit.summary) earnings = company.estimateNextReport(hit.summary.filings);
    return {
      ...base, sec: true, fetchedAt: hit.at, cik: hit.cik, profile: hit.profile, filings: hit.filings,
      summary: hit.summary, statements: hit.statements, earnings,
      valuation: hit.summary ? company.valuation(hit.summary, y.price, y.closes.slice(-66)) : null,
      insiderCount: hit.form4.length
    };
  }

  // Form 4s, newest first: a year's worth, at most 40, fetched a few per second (the SEC allows 10)
  async function insiderTrades(sym) {
    sym = WL.normalizeSymbol(sym);
    const hit = pages[sym];
    if (!hit) return { ok: false, error: "Open the company first." };
    if (!contact()) return { ok: true, needContact: true };
    const since = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
    const list = hit.form4.filter((f) => f.date >= since).slice(0, 40);
    const out = [];
    for (const f of list) {
      if (!insiders[f.accn]) {
        try { insiders[f.accn] = SEC.parseForm4(await getText(f.xml, secHeaders())); await wait(150); }
        catch (e) { if (e.status === 403) return { ok: true, needContact: true }; continue; }
      }
      out.push({ ...insiders[f.accn], filed: f.date, url: f.url });
    }
    saveSoon();
    return { ok: true, filings: out, summary: SEC.insiderSummary(out), checked: list.length };
  }

  async function holdersOf(sym) {
    sym = WL.normalizeSymbol(sym);
    if (holders[sym] && Date.now() - holders[sym].at < TTL) return holders[sym].data;
    try {
      const j = await nasdaq.holdings(sym, 15000);
      const data = { ok: true, ...(SEC.parseHolders(j) || { empty: true }) };
      holders[sym] = { at: Date.now(), data };
      return data;
    } catch (e) { return { ok: false, error: `Couldn't load holders (${e.message}).` }; }
  }

  function news(sym, name) {
    const entry = { sym, name, terms: WL.defaultTerms(sym, name || sym) };
    return WL.tagStories(ctx.get().stories, [entry]).filter((s) => s.watch?.length).sort((a, b) => b.updated - a.updated).slice(0, 25)
      .map((s) => ({ id: s.id, title: s.title, code: s.code, sev: s.sev, updated: s.updated, link: s.link }));
  }

  ctx.ipcMain.handle("company:page", (_e, sym, force) => page(String(sym || ""), !!force));
  ctx.ipcMain.handle("company:insiders", (_e, sym) => insiderTrades(String(sym || "")));
  ctx.ipcMain.handle("company:holders", (_e, sym) => holdersOf(String(sym || "")));
  ctx.ipcMain.handle("company:news", (_e, sym, name) => news(WL.normalizeSymbol(sym), String(name || "")));
}

module.exports = { register };
