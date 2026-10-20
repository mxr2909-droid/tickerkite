// Company fundamentals for watchlist stocks: SEC EDGAR XBRL "company facts" (free, no key),
// valuation from the live Yahoo price, and the next earnings date (Nasdaq, else estimated).
// The parsing functions are pure so they can be tested on a fixture; fetchCompany does the networking.

const DAY = 864e5;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// Tag variants, in order of preference. Companies switch tags over the years, so each
// period takes the first tag that has a value for it.
const TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
  grossProfit: ["GrossProfit"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  opIncome: ["OperatingIncomeLoss"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"],
  dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"]
};
// Debt is the sum of whichever of these the company reports on its latest balance sheet.
// LongTermDebt (when present) already includes the current portion.
const DEBT_LT = ["LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"];
const DEBT_PARTS = [["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligationsNoncurrent"], ["LongTermDebtCurrent", "DebtCurrent"]];
const DEBT_SHORT = ["ShortTermBorrowings", "CommercialPaper"];

const isFiling = (f) => /^10-[QK]/.test(f.form || "");

/** Split ratio to apply to a fact filed on `filed`: product of splits that happened after it. */
function splitFactor(splits, filed) {
  let k = 1;
  for (const s of splits || []) if (s.date > filed) k *= s.ratio;
  return k;
}

/** Raw facts for one tag, from 10-Q/10-K filings, split-adjusted (per-share values ÷, share counts ×). */
function factsFor(cf, tag, { splits, per } = {}) {
  const units = cf?.facts?.["us-gaap"]?.[tag]?.units || cf?.facts?.dei?.[tag]?.units;
  if (!units) return [];
  const list = units.USD || units["USD/shares"] || units.shares || Object.values(units)[0] || [];
  return list.filter(isFiling).map((f) => {
    const k = splitFactor(splits, f.filed);
    return { ...f, val: per === "share" ? f.val / k : per === "count" ? f.val * k : f.val };
  });
}

/** Latest-filed value for each (start, end) period, so restatements win. */
function dedupe(facts) {
  const m = new Map();
  for (const f of facts) {
    const key = `${f.start || ""}|${f.end}`;
    const prev = m.get(key);
    if (!prev || f.filed > prev.filed) m.set(key, f);
  }
  return [...m.values()];
}

/**
 * Quarterly values for a flow item (revenue, income, EPS). 10-Qs carry quarters directly;
 * Q4 usually only exists inside the 10-K's annual figure, so it's the annual value minus the
 * nine-month year-to-date value (or minus the three quarters, when no YTD figure exists).
 */
function quarterly(facts) {
  const fs = dedupe(facts.filter((f) => f.start));
  const q = new Map(), ytd9 = [], annual = [];
  for (const f of fs) {
    const d = days(f.start, f.end);
    if (d >= 80 && d <= 100) q.set(f.end, { start: f.start, end: f.end, val: f.val, filed: f.filed, form: f.form });
    else if (d >= 260 && d <= 285) ytd9.push(f);
    else if (d >= 350 && d <= 380) annual.push(f);
  }
  for (const y of annual) {
    if ([...q.keys()].some((e) => Math.abs(days(e, y.end)) <= 5)) continue;
    const nine = ytd9.find((f) => Math.abs(days(f.start, y.start)) <= 5 && days(f.end, y.end) > 80);
    let rest = null, from = null;
    if (nine) { rest = nine.val; from = nine.end; }
    else {
      const inside = [...q.values()].filter((x) => days(y.start, x.start) >= -5 && days(x.end, y.end) > 60);
      if (inside.length === 3) { rest = inside.reduce((s, x) => s + x.val, 0); from = inside.map((x) => x.end).sort().pop(); }
    }
    if (rest == null) continue;
    q.set(y.end, { start: iso(Date.parse(from) + DAY), end: y.end, val: y.val - rest, filed: y.filed, form: y.form, derived: true });
  }
  return [...q.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/** Merge quarterly series from several tags: per quarter end, the first tag that has it. */
function mergedQuarterly(cf, tags, opts) {
  const m = new Map();
  for (const tag of tags) for (const x of quarterly(factsFor(cf, tag, opts))) if (!m.has(x.end)) m.set(x.end, x);
  return [...m.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/** Sum of the last four quarters ending at index i, only if they are back to back. */
function ttmAt(qs, i = qs.length - 1) {
  if (i < 3) return null;
  const four = qs.slice(i - 3, i + 1);
  for (let k = 1; k < 4; k++) if (Math.abs(days(four[k - 1].end, four[k].start)) > 10) return null;
  return four.reduce((s, x) => s + x.val, 0);
}

/** Point-in-time values (balance sheet): value at a given date, latest filing wins. */
function instants(cf, tag, opts) {
  return dedupe(factsFor(cf, tag, opts).filter((f) => !f.start)).sort((a, b) => a.end.localeCompare(b.end));
}
function valueAt(cf, tags, end) {
  for (const t of tags) { const f = instants(cf, t).find((x) => x.end === end); if (f) return f.val; }
  return null;
}

function totalDebt(cf, end) {
  const lt = valueAt(cf, DEBT_LT, end);
  const parts = DEBT_PARTS.map((p) => valueAt(cf, p, end));
  const short = DEBT_SHORT.map((t) => valueAt(cf, [t], end));
  const vals = [lt != null ? lt : null, ...(lt != null ? [] : parts), ...short].filter((v) => v != null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
}

/** Shares outstanding from the cover page (summed across share classes), else diluted weighted average. */
function sharesOutstanding(cf, opts) {
  const cover = factsFor(cf, "EntityCommonStockSharesOutstanding", { ...opts, per: "count" }).filter((f) => !f.start);
  if (cover.length) {
    const last = cover.reduce((a, b) => (b.end > a.end || (b.end === a.end && b.filed > a.filed) ? b : a));
    const same = cover.filter((f) => f.accn === last.accn && f.end === last.end);
    return { val: same.reduce((s, f) => s + f.val, 0), end: last.end };
  }
  const q = mergedQuarterly(cf, TAGS.dilutedShares, { ...opts, per: "count" }).pop();
  return q ? { val: q.val, end: q.end } : null;
}

/** Filing dates of the periodic reports: [{ end, filed, form }], one per report. */
function filings(cf) {
  const m = new Map();
  for (const t of [...TAGS.revenue, ...TAGS.netIncome]) for (const f of factsFor(cf, t)) {
    if (!m.has(f.accn)) m.set(f.accn, { end: f.end, filed: f.filed, form: f.form });
    else if (f.end > m.get(f.accn).end) m.get(f.accn).end = f.end;
  }
  return [...m.values()].filter((f) => !/\/A$/.test(f.form)).sort((a, b) => a.end.localeCompare(b.end));
}

/**
 * Next report date from the filing cadence: the quarter after the last one, plus the lag the
 * company took for the same quarter a year earlier (or its median lag). Filings usually land on
 * or a few days after the earnings release, so this is a rough estimate.
 */
function estimateNextReport(fl, now = Date.now()) {
  if (fl.length < 2) return null;
  const last = fl[fl.length - 1];
  const nextEnd = Date.parse(last.end) + 91 * DAY;
  const yearAgo = fl.find((f) => Math.abs(Date.parse(f.end) - (nextEnd - 365 * DAY)) <= 12 * DAY);
  const lags = fl.slice(-8).map((f) => days(f.end, f.filed)).sort((a, b) => a - b);
  const lag = yearAgo ? days(yearAgo.end, yearAgo.filed) : lags[lags.length >> 1];
  let t = nextEnd + lag * DAY;
  if (t < now - 3 * DAY) t = Date.parse(last.filed) + 91 * DAY; // overdue: fall back to a quarter after the last filing
  return { date: iso(t), estimated: true, source: "filing cadence" };
}

/** Parse Nasdaq's earnings-date endpoint. Returns null when it has no usable future date. */
function parseNasdaqEarnings(j, now = Date.now()) {
  const d = j?.data;
  const m = String(d?.announcement || "").match(/:\s*([A-Z][a-z]{2} \d{1,2}, \d{4})/);
  if (!m) return null;
  const t = Date.parse(m[1] + " 12:00 UTC");
  if (!isFinite(t) || t < now - DAY) return null;
  const estimated = /estimated/i.test(d.reportText || "");
  return { date: iso(t), estimated, source: estimated ? "Zacks estimate via Nasdaq" : "Nasdaq" };
}

/** Everything the panel needs from one companyfacts document. `splits`: [{ date, ratio }]. */
function summarize(cf, { splits = [] } = {}) {
  const opts = { splits };
  const rev = mergedQuarterly(cf, TAGS.revenue, opts);
  const ni = mergedQuarterly(cf, TAGS.netIncome, opts);
  const eps = mergedQuarterly(cf, TAGS.eps, { ...opts, per: "share" });
  const gp = mergedQuarterly(cf, TAGS.grossProfit, opts);
  const cogs = mergedQuarterly(cf, TAGS.costOfRevenue, opts);
  const op = mergedQuarterly(cf, TAGS.opIncome, opts);
  const at = (series, end) => series.find((x) => x.end === end)?.val ?? null;

  const ends = (rev.length ? rev : ni).map((x) => x.end).slice(-8);
  const quarters = ends.map((end) => {
    const r = at(rev, end);
    const g = at(gp, end) ?? (r != null && at(cogs, end) != null ? r - at(cogs, end) : null);
    const o = at(op, end);
    return {
      end, revenue: r, netIncome: at(ni, end), eps: at(eps, end),
      grossMargin: r && g != null ? g / r : null, opMargin: r && o != null ? o / r : null,
      derived: !!(rev.find((x) => x.end === end)?.derived)
    };
  });
  const ttmRev = ttmAt(rev), ttmNi = ttmAt(ni), ttmEps = ttmAt(eps);
  const ttmGp = gp.length ? ttmAt(gp) : (cogs.length && ttmRev != null && ttmAt(cogs) != null ? ttmRev - ttmAt(cogs) : null);
  const ttmOp = ttmAt(op);

  const cashFacts = TAGS.cash.map((t) => instants(cf, t)).find((l) => l.length) || [];
  const bsEnd = cashFacts.length ? cashFacts[cashFacts.length - 1].end : null;
  // TTM EPS at each quarter end, for the P/E history
  const epsTtm = eps.map((x, i) => ({ end: x.end, val: ttmAt(eps, i) })).filter((x) => x.val != null);

  return {
    name: cf.entityName, cik: cf.cik,
    quarters,
    ttm: {
      revenue: ttmRev, netIncome: ttmNi, eps: ttmEps,
      grossMargin: ttmRev && ttmGp != null ? ttmGp / ttmRev : null,
      opMargin: ttmRev && ttmOp != null ? ttmOp / ttmRev : null
    },
    balance: { end: bsEnd, cash: bsEnd ? valueAt(cf, TAGS.cash, bsEnd) : null, debt: bsEnd ? totalDebt(cf, bsEnd) : null },
    shares: sharesOutstanding(cf, opts),
    epsTtm,
    filings: filings(cf).slice(-12)
  };
}

/** P/E and P/S from a live price, and where today's P/E sits in its own history. */
function valuation(sum, price, closes = []) {
  if (!sum || price == null) return null;
  const pe = sum.ttm.eps > 0 ? price / sum.ttm.eps : null;
  const mcap = sum.shares ? price * sum.shares.val : null;
  const ps = mcap && sum.ttm.revenue > 0 ? mcap / sum.ttm.revenue : null;
  // historical P/E at each quarter end over ~5 years: monthly close on or before the quarter end
  const since = Date.now() - 5.2 * 365 * DAY;
  const hist = [];
  for (const e of sum.epsTtm) {
    const t = Date.parse(e.end);
    if (t < since || e.val <= 0) continue;
    const c = closes.filter((p) => p.t <= t + 3 * DAY).pop();
    if (c) hist.push(c.c / e.val);
  }
  let range = null;
  if (pe != null && hist.length >= 6) {
    const s = [...hist].sort((a, b) => a - b);
    range = { min: s[0], max: s[s.length - 1], median: s[s.length >> 1], pct: s.filter((v) => v < pe).length / s.length, n: s.length };
  }
  return { price, pe, ps, mcap, peRange: range };
}

// ---------------------------------------------------------------- full statements (Company page)
const STMT = {
  rnd: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements"],
  dividends: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  assets: ["Assets"],
  liabilities: ["Liabilities"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]
};

/** Fiscal-year values for a flow item: 10-K facts covering about a year, latest filing wins, one per year end. */
function annual(facts) {
  const m = new Map();
  for (const f of dedupe(facts.filter((x) => x.start && /^10-K/.test(x.form)))) {
    const d = days(f.start, f.end);
    if (d < 350 || d > 380) continue;
    const prev = m.get(f.end);
    if (!prev || f.filed > prev.filed) m.set(f.end, { start: f.start, end: f.end, val: f.val, filed: f.filed });
  }
  return [...m.values()].sort((a, b) => a.end.localeCompare(b.end));
}
function mergedAnnual(cf, tags, opts) {
  const m = new Map();
  for (const tag of tags) for (const x of annual(factsFor(cf, tag, opts))) if (!m.has(x.end)) m.set(x.end, x);
  return [...m.values()].sort((a, b) => a.end.localeCompare(b.end));
}
/** Balance-sheet value at (or within 5 days of) a period end, first tag that has one. */
function instantNear(cf, tags, end, opts) {
  for (const t of tags) {
    const f = instants(cf, t, opts).find((x) => Math.abs(days(x.end, end)) <= 5);
    if (f) return f.val;
  }
  return null;
}

/**
 * Income statement, cash flow and balance sheet by fiscal year (up to 10) and by quarter (up to 12).
 * Cash-flow items come annual only: 10-Qs report them year-to-date, not per quarter.
 */
function statements(cf, { splits = [] } = {}) {
  const opts = { splits };
  const flowA = (tags, o = opts) => mergedAnnual(cf, tags, o);
  const flowQ = (tags, o = opts) => mergedQuarterly(cf, tags, o);
  const A = {
    revenue: flowA(TAGS.revenue), grossProfit: flowA(TAGS.grossProfit), cogs: flowA(TAGS.costOfRevenue), opIncome: flowA(TAGS.opIncome),
    netIncome: flowA(TAGS.netIncome), eps: flowA(TAGS.eps, { ...opts, per: "share" }), rnd: flowA(STMT.rnd),
    ocf: flowA(STMT.ocf), capex: flowA(STMT.capex), dividends: flowA(STMT.dividends), buybacks: flowA(STMT.buybacks)
  };
  const Q = {
    revenue: flowQ(TAGS.revenue), grossProfit: flowQ(TAGS.grossProfit), cogs: flowQ(TAGS.costOfRevenue), opIncome: flowQ(TAGS.opIncome),
    netIncome: flowQ(TAGS.netIncome), eps: flowQ(TAGS.eps, { ...opts, per: "share" }), rnd: flowQ(STMT.rnd)
  };
  const at = (s, end) => s.find((x) => Math.abs(days(x.end, end)) <= 5)?.val ?? null;
  function row(S, end, withCash) {
    const revenue = at(S.revenue, end);
    const gp = at(S.grossProfit, end) ?? (revenue != null && at(S.cogs, end) != null ? revenue - at(S.cogs, end) : null);
    const r = {
      end, revenue, grossProfit: gp, opIncome: at(S.opIncome, end), netIncome: at(S.netIncome, end), eps: at(S.eps, end), rnd: at(S.rnd, end),
      cash: instantNear(cf, TAGS.cash, end), debt: totalDebt(cf, end) ?? null,
      assets: instantNear(cf, STMT.assets, end), liabilities: instantNear(cf, STMT.liabilities, end), equity: instantNear(cf, STMT.equity, end)
    };
    if (withCash) {
      r.ocf = at(S.ocf, end); r.capex = at(S.capex, end);
      r.fcf = r.ocf != null ? r.ocf - (r.capex || 0) : null;
      r.dividends = at(S.dividends, end); r.buybacks = at(S.buybacks, end);
    }
    return r;
  }
  const yEnds = (A.revenue.length ? A.revenue : A.netIncome).map((x) => x.end).slice(-10);
  const qEnds = (Q.revenue.length ? Q.revenue : Q.netIncome).map((x) => x.end).slice(-12);
  return { annual: yEnds.map((e) => row(A, e, true)), quarterly: qEnds.map((e) => row(Q, e, false)) };
}

// ---------------------------------------------------------------- networking
const TTL = 24 * 3600e3;
const KIND = { ETF: "ETF", MUTUALFUND: "fund", CRYPTOCURRENCY: "crypto", FUTURE: "future", INDEX: "index", CURRENCY: "currency" };
const http = require("./data/http");
const Y = require("./data/yahoo");
const nasdaq = require("./data/nasdaq");
const UA_BASE = http.UA; // the SEC wants "app contact@email"; the contact is appended per request

const getJSON = (url, headers, timeoutMs = 15000) => http.getJSON(url, { headers, timeoutMs });

/** Yahoo monthly closes, splits, price and instrument type in one call. */
async function yahoo(sym) {
  const j = await Y.chart(sym, { range: "10y", interval: "1mo", events: "split" }, 10000);
  const r = j.chart.result[0];
  const close = r.indicators?.quote?.[0]?.close || [];
  const closes = (r.timestamp || []).map((t, i) => ({ t: t * 1000, c: close[i] })).filter((p) => p.c != null);
  const splits = Object.values(r.events?.splits || {}).map((s) => ({ date: iso(s.date * 1000), ratio: s.numerator / s.denominator })).filter((s) => s.ratio > 0 && s.ratio !== 1);
  return { type: r.meta.instrumentType || "", price: r.meta.regularMarketPrice, currency: r.meta.currency, closes, splits };
}

async function nasdaqEarnings(sym) {
  try {
    const j = await nasdaq.earningsDate(sym, 8000);
    return parseNasdaqEarnings(j);
  } catch { return null; }
}

/**
 * Company panel data for one symbol. `store` = { read(name, fallback), write(name, data) } for the
 * 24-hour cache in userData; `contact` = the contact the SEC asks for in the User-Agent.
 */
async function fetchCompany(sym, { store, contact, force = false } = {}) {
  const y = await yahoo(sym);
  if (y.type !== "EQUITY") return { sec: false, reason: `No SEC filings for this symbol${y.type ? ` (${KIND[y.type] || y.type.toLowerCase()})` : ""}` };

  const cache = store.read("company-cache.json", {});
  let hit = cache[sym];
  if (force || !hit || Date.now() - hit.at > TTL) {
    const headers = { "User-Agent": contact ? `${UA_BASE} ${contact}` : UA_BASE, Accept: "application/json" };
    let tick = store.read("sec-tickers.json", null);
    try {
      if (!tick || Date.now() - tick.at > TTL) {
        const j = await getJSON("https://www.sec.gov/files/company_tickers.json", headers);
        tick = { at: Date.now(), map: Object.fromEntries(Object.values(j).map((r) => [String(r.ticker).toUpperCase(), r.cik_str])) };
        store.write("sec-tickers.json", tick);
      }
      const cik = tick.map[sym.toUpperCase()] ?? tick.map[sym.toUpperCase().replace(/-/g, ".")];
      if (cik == null) {
        hit = { at: Date.now(), data: null };
      } else {
        const cf = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, headers, 25000);
        const data = summarize(cf, { splits: y.splits });
        data.earnings = (await nasdaqEarnings(sym)) || estimateNextReport(data.filings);
        hit = { at: Date.now(), data };
      }
      cache[sym] = hit;
      store.write("company-cache.json", cache);
    } catch (e) {
      if (e.status === 403) return { sec: true, needContact: true, error: "The SEC blocked the request: it asks apps to include a contact email." };
      if (!hit) return { sec: true, error: `Couldn't reach SEC EDGAR (${e.message})` };
      // stale cache is better than nothing
    }
  }
  if (!hit.data) return { sec: false, reason: "No SEC filings for this symbol" };
  if (!hit.data.quarters.length) return { sec: false, reason: "No 10-Q/10-K financials for this symbol (foreign filers use 20-F)" };
  // a confirmed/estimated date that has passed since caching: re-estimate from the cadence
  let earnings = hit.data.earnings;
  if (earnings && Date.parse(earnings.date) < Date.now() - DAY) earnings = estimateNextReport(hit.data.filings);
  return { sec: true, ...hit.data, earnings, fetchedAt: hit.at, valuation: valuation(hit.data, y.price, y.closes.slice(-66)), currency: y.currency };
}

module.exports = { fetchCompany, nasdaqEarnings, yahoo, getJSON, UA_BASE, statements, annual, summarize, valuation, quarterly, mergedQuarterly, ttmAt, estimateNextReport, parseNasdaqEarnings, splitFactor, TAGS };
