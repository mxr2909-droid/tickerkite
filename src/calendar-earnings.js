// Earnings for the Calendar page, for three company lists: the world's 100 largest by market cap, the
// largest US companies by revenue (Fortune-style, ranked by the screener from SEC filings) and the user's own list.
// The ranking comes from companiesmarketcap.com's free CSV (refreshed daily, a checked snapshot below
// when it can't be reached); dates, EPS consensus and actuals from Nasdaq's free earnings calendar
// (api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD, no key). Nasdaq only lists US-traded shares, so
// companies with no US listing or ADR (Aramco, Samsung, Chinese A-shares…) can't show up.

const TOP_URL = "https://companiesmarketcap.com/?download=csv";
const TOP_N = 100;

// Snapshot of the top 100 (symbol|name|country) for when the ranking can't be downloaded.
const TOP_CHECKED = "2026-10-27";
const TOP_FALLBACK = [
  "NVDA|NVIDIA|United States", "AAPL|Apple|United States", "MSFT|Microsoft|United States", "GOOG|Alphabet (Google)|United States",
  "AMZN|Amazon|United States", "TSM|TSMC|Taiwan", "SPCX|SpaceX|United States", "2222.SR|Saudi Aramco|Saudi Arabia", "AVGO|Broadcom|United States",
  "TSLA|Tesla|United States", "META|Meta Platforms (Facebook)|United States", "BRK-B|Berkshire Hathaway|United States", "LLY|Eli Lilly|United States",
  "005930.KS|Samsung|South Korea", "MU|Micron Technology|United States", "WMT|Walmart|United States", "AMD|AMD|United States",
  "JPM|JPMorgan Chase|United States", "V|Visa|United States", "XOM|Exxon Mobil|United States", "000660.KS|SK Hynix|South Korea",
  "JNJ|Johnson & Johnson|United States", "ASML|ASML|Netherlands", "MA|Mastercard|United States", "ABBV|AbbVie|United States",
  "INTC|Intel|United States", "PLTR|Palantir|United States", "601939.SS|China Construction Bank|China", "688825.SS|CXMT|China",
  "CVX|Chevron|United States", "TCEHY|Tencent|China", "COST|Costco|United States", "CSCO|Cisco|United States", "ORCL|Oracle|United States",
  "KO|Coca-Cola|United States", "RO.SW|Roche|Switzerland", "601288.SS|Agricultural Bank of China|China", "PG|Procter & Gamble|United States",
  "UNH|UnitedHealth|United States", "BAC|Bank of America|United States", "MRK|Merck|United States", "1398.HK|ICBC|China",
  "601988.SS|Bank of China|China", "PANW|Palo Alto Networks|United States", "CAT|Caterpillar|United States", "DELL|Dell|United States",
  "HD|Home Depot|United States", "PM|Philip Morris International|United States", "AMAT|Applied Materials|United States",
  "GE|General Electric|United States", "LRCX|Lam Research|United States", "NVS|Novartis|Switzerland", "SHEL|Shell|United Kingdom",
  "HSBC|HSBC|United Kingdom", "MS|Morgan Stanley|United States", "TXN|Texas Instruments|United States", "RY|Royal Bank Of Canada|Canada",
  "CRWD|CrowdStrike|United States", "SAP|SAP|Germany", "GS|Goldman Sachs|United States", "AZN|AstraZeneca|United Kingdom", "RTX|RTX|United States",
  "NFLX|Netflix|United States", "NESN.SW|Nestlé|Switzerland", "OR.PA|L'Oréal|France", "TMO|Thermo Fisher Scientific|United States",
  "600519.SS|Kweichow Moutai|China", "BABA|Alibaba|China", "WFC|Wells Fargo|United States", "AMGN|Amgen|United States",
  "ARM|Arm Holdings|United Kingdom", "MUFG|Mitsubishi UFJ Financial|Japan", "GEV|GE Vernova|United States", "IBM|IBM|United States",
  "ANET|Arista Networks|United States", "0857.HK|PetroChina|China", "LIN|Linde|United Kingdom", "TM|Toyota|Japan", "SIE.DE|Siemens|Germany",
  "MRVL|Marvell Technology|United States", "0941.HK|China Mobile|China", "MC.PA|LVMH|France", "SHOP|Shopify|Canada", "BHP|BHP Group|Australia",
  "AXP|American Express|United States", "IHC.AE|International Holding Company|United Arab Emirates", "ADI|Analog Devices|United States",
  "TD|Toronto Dominion Bank|Canada", "TTE|TotalEnergies|France", "C|Citigroup|United States", "KLAC|KLA|United States", "ITX.MC|Inditex|Spain",
  "CRM|Salesforce|United States", "GILD|Gilead Sciences|United States", "QCOM|QUALCOMM|United States", "2454.TW|MediaTek|Taiwan",
  "APH|Amphenol|United States", "DIS|Walt Disney|United States", "CBA.AX|Commonwealth Bank|Australia", "SNDK|Sandisk|United States"
];

// Ranking symbol → the US tickers Nasdaq files its earnings under (share classes, OTC ADRs)
const ALIASES = {
  GOOG: ["GOOG", "GOOGL"], "BRK-B": ["BRK.B", "BRK.A"], "RO.SW": ["RHHBY"], "NESN.SW": ["NSRGY"], "OR.PA": ["LRLCY"],
  "MC.PA": ["LVMUY"], "SIE.DE": ["SIEGY"], "005930.KS": ["SSNLF"], "1398.HK": ["IDCBY"], "601939.SS": ["CICHY"],
  "601288.SS": ["ACGBY"], "601988.SS": ["BACHY"], "0857.HK": ["PTR"], "0941.HK": ["CHLKF"], "ITX.MC": ["IDEXY"], "CBA.AX": ["CMWAY"], "2454.TW": ["MDTKF"]
};
const MIN_CAP = 1e9; // smaller companies are only cached when they're on one of the lists
const CACHE_V = 2;   // cached days from before the Fortune and own lists kept only $20B+ companies
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** companiesmarketcap CSV → [{ rank, name, sym, cap, country }] for the top n. */
function parseTop(csv, n = TOP_N) {
  const out = [];
  for (const line of String(csv).trim().split(/\r?\n/).slice(1)) {
    let cells;
    try { cells = JSON.parse(`[${line}]`); } catch { continue; }
    const [rank, name, sym, cap, , country] = cells;
    if (!sym || !+rank) continue;
    out.push({ rank: +rank, name, sym, cap: +cap || 0, country });
    if (out.length >= n) break;
  }
  return out;
}
const fallbackTop = () => TOP_FALLBACK.map((s, i) => { const [sym, name, country] = s.split("|"); return { rank: i + 1, name, sym, cap: 0, country }; });

/** normalized US ticker → ranking entry */
function symbolMap(top) {
  const m = new Map();
  for (const c of top) for (const s of [c.sym, ...(ALIASES[c.sym] || [])]) m.set(norm(s), c);
  return m;
}

const money = (s) => { const x = parseFloat(String(s || "").replace(/[$,()]/g, "")); return isFinite(x) ? (/\(/.test(s) ? -x : x) : null; };

/** One Nasdaq earnings day → the rows worth keeping: market cap ≥ $1B, or a symbol in `keep` (normalized). */
function parseDay(json, keep = new Set()) {
  return (json?.data?.rows || []).filter((r) => r?.symbol && ((money(r.marketCap) || 0) >= MIN_CAP || keep.has(norm(r.symbol)))).map((r) => ({
    sym: String(r.symbol).trim(), name: String(r.name || "").trim(),
    when: /pre-market/.test(r.time) ? "pre" : /after-hours/.test(r.time) ? "post" : "",
    qtr: r.fiscalQuarterEnding || "", est: r.epsForecast || "", eps: r.eps || "", yago: r.lastYearEPS || "", n: +r.noOfEsts || 0
  }));
}

/**
 * One entry per company across the lists, by normalized US ticker. `lists` = { top, fortune, mine } or just
 * the top list. top: ranking entries; fortune: [{ ticker, name, rank }] by revenue; mine: [{ sym, name }].
 */
function universe(lists) {
  const { top = [], fortune = [], mine = [] } = Array.isArray(lists) ? { top: lists } : lists || {};
  const ent = new Map(), byCompany = new Map(); // share classes and ADR aliases point at one entry
  for (const [k, c] of symbolMap(top)) {
    if (!byCompany.has(c)) byCompany.set(c, { key: c.sym, name: c.name, country: c.country, rank: c.rank, cap: c.cap });
    ent.set(k, byCompany.get(c));
  }
  const add = (sym, info) => { const k = norm(sym); if (!k) return; const e = ent.get(k); if (e) Object.assign(e, info); else ent.set(k, { key: sym, country: "United States", rank: null, cap: 0, ...info }); };
  for (const f of fortune) add(f.ticker, { frank: f.rank });
  for (const x of mine) add(x.sym, { mine: true });
  return ent;
}

/** Normalized tickers the lists need cached even when the company is under $1B. */
const keepSet = (lists) => new Set(universe(lists).keys());

/**
 * Calendar events for the listed companies among a day's rows. `mk(date, time)` = ET date/time → ms,
 * `country(name)` = { code, flag, region }. One event per company even when two share classes report.
 */
function events(date, rows, lists, mk, country) {
  const map = universe(lists), seen = new Set(), out = [];
  for (const r of rows || []) {
    const c = map.get(norm(r.sym));
    if (!c || seen.has(c.key)) continue;
    seen.add(c.key);
    const name = c.rank ? c.name : r.name.replace(/,? (Inc|Corp|Corporation|Co|Company|Ltd|plc|Holdings|Incorporated)\.?$/i, "") || r.sym;
    const where = country(c.country);
    const when = r.when === "pre" ? "before open" : r.when === "post" ? "after close" : "";
    out.push({
      id: `earn:${c.key}:${date}`, cat: "earnings", key: "earn", sym: r.sym, title: `${name} earnings`,
      ref: [when, r.qtr ? `qtr to ${r.qtr}` : ""].filter(Boolean).join(" · "), when,
      t: mk(date, r.when === "pre" ? "07:00" : r.when === "post" ? "16:05" : "12:00"), timed: false, estimated: false,
      src: "Nasdaq earnings calendar", rank: c.rank || null, frank: c.frank || null, mine: !!c.mine, cap: c.cap || 0, company: name, country: c.country,
      code: where.code, flag: where.flag, region: where.region, g10: true,
      survey: r.est || "", actual: r.eps || "", prior: r.yago || "", ests: r.n
    });
  }
  return out;
}

module.exports = { TOP_URL, TOP_N, TOP_CHECKED, ALIASES, MIN_CAP, CACHE_V, parseTop, fallbackTop, symbolMap, universe, keepSet, parseDay, events, money, norm };
