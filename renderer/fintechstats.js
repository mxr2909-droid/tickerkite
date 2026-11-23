/* Fintech page arithmetic shared by the page and the tests (plain functions, no DOM).
   In the app it is window.TkFintechStats (load ../src/fintech-universe.js first); under Node it is module.exports.

   The snapshot comes from src/fintech.js:
     { subsectors: [{ id, name, blurb }], companies: [{ sym, sub, name, cap, price, d1 }], benchmarks: [{ sym, name }],
       dates: ["yyyy-mm-dd", …] (SPY's trading days, ascending), closes: { SYM: [close|null, …] aligned to dates }, … }
   A company that listed recently has nulls before its first close; it joins the indexes on its second day (its first
   daily move), so a late listing never reaches back in time. Returns are in percent. */
(() => {
  const NODE = typeof module === "object" && !!module.exports;
  const U = NODE ? require("../src/fintech-universe") : window.TkFintechUniverse;

  const PERIODS = ["1D", "1W", "1M", "3M", "YTD", "1Y", "3Y"];
  const DAY = 864e5;
  const CARRY = 5; // a missing close is bridged from the last one up to this many trading days back

  // ---------- dates and returns ----------
  const ymd = (d) => d.toISOString().slice(0, 10);
  /** The calendar date a period starts on, counted back from `t` (yyyy-mm-dd). Month steps that overflow
   *  (May 31 − 3 months) land on the last day of the target month. */
  function periodStart(t, period) {
    const y = +t.slice(0, 4), m = +t.slice(5, 7) - 1, d = +t.slice(8, 10);
    if (period === "YTD") return `${y - 1}-12-31`;
    if (period === "1W") return ymd(new Date(Date.UTC(y, m, d - 7)));
    const months = { "1M": 1, "3M": 3, "1Y": 12, "3Y": 36 }[period];
    if (!months) return t;
    const x = new Date(Date.UTC(y, m - months, d));
    if (x.getUTCMonth() !== (((m - months) % 12) + 12) % 12) x.setUTCDate(0);
    return ymd(x);
  }
  /** Index of the last date on or before `day` (yyyy-mm-dd), or −1. */
  function indexOnOrBefore(dates, day) {
    let lo = 0, hi = dates.length - 1, out = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= day) { out = mid; lo = mid + 1; } else hi = mid - 1; }
    return out;
  }
  /** Index of the period's reference close: the last trading day on or before the period's start. 1D is the
   *  trading day before the last one. `today` (yyyy-mm-dd) defaults to the last date. When the history doesn't reach
   *  back far enough the first date is used; −1 for no dates. */
  function startIndex(dates, period, today) {
    if (!dates?.length) return -1;
    const end = today ? Math.max(0, indexOnOrBefore(dates, today)) : dates.length - 1;
    if (period === "1D") return Math.max(0, end - 1);
    return Math.max(0, indexOnOrBefore(dates, periodStart(today || dates[end], period)));
  }
  /** % change from closes[i0] to closes[i1]; null if either is missing. */
  const ret = (closes, i0, i1) => {
    const a = closes?.[i0], b = closes?.[i1];
    return a > 0 && b > 0 ? (b / a - 1) * 100 : null;
  };
  /** The last close at or before i, looking back at most `carry` trading days, or null. */
  function closeAt(c, i, carry = CARRY) {
    for (let k = i; k >= 0 && k >= i - carry; k--) if (c?.[k] > 0) return c[k];
    return null;
  }
  const lastClose = (c) => { for (let k = (c?.length || 0) - 1; k >= 0; k--) if (c[k] > 0) return c[k]; return null; };

  /** Map sym → { period: % | null } for every company and benchmark. The end is the last date (a company that
   *  didn't trade on it is measured to its last close within a week); the start must be a real close. */
  function companyReturns(snap) {
    const out = new Map(), dates = snap?.dates || [], end = dates.length - 1;
    const starts = Object.fromEntries(PERIODS.map((p) => [p, startIndex(dates, p)]));
    for (const c of [...(snap?.companies || []), ...(snap?.benchmarks || [])]) {
      const cl = snap.closes?.[c.sym], r = {};
      for (const p of PERIODS) {
        const a = cl?.[starts[p]], b = p === "1D" ? cl?.[end] : closeAt(cl, end);
        r[p] = end > 0 && a > 0 && b > 0 ? (b / a - 1) * 100 : null;
      }
      if (r["1D"] == null && c.d1 != null && Number.isFinite(c.d1)) r["1D"] = c.d1;
      out.set(c.sym, r);
    }
    return out;
  }

  // ---------- indexes ----------
  /** A fintech index over the period, rebased to 100 at its start: { dates, values }.
   *  opts.weight "cap" (default): each company weighted by its market value the day before (today's value scaled back
   *  by its price); "equal": the average daily move. opts.sub limits it to one sub-sector. Chain-linked daily: a day's
   *  move counts the companies with a close that day and the day before, so a new listing joins from its first move. */
  function indexSeries(snap, period, opts = {}) {
    const dates = snap?.dates || [], end = dates.length - 1, i0 = startIndex(dates, period);
    if (i0 < 0) return { dates: [], values: [] };
    const cap = opts.weight !== "equal";
    const rows = (snap.companies || []).filter((c) => !opts.sub || c.sub === opts.sub).map((c) => {
      const cl = snap.closes?.[c.sym] || [], last = lastClose(cl);
      return { cl, w: cap ? (c.cap > 0 && last > 0 ? c.cap / last : 0) : 1 };
    }).filter((r) => r.w > 0);
    const values = [100];
    let level = 100;
    for (let i = i0 + 1; i <= end; i++) {
      let num = 0, den = 0;
      for (const r of rows) {
        const cur = r.cl[i];
        if (!(cur > 0)) continue;
        const prev = closeAt(r.cl, i - 1);
        if (!(prev > 0)) continue;
        const w = cap ? r.w * prev : 1;
        num += w * (cur / prev - 1); den += w;
      }
      if (den > 0) level *= 1 + num / den;
      values.push(level);
    }
    return { dates: dates.slice(i0, end + 1), values };
  }
  /** A benchmark's closes over the period rebased to 100 at the start (null on days without a close), or null. */
  function benchSeries(snap, sym, period) {
    const dates = snap?.dates || [], end = dates.length - 1, i0 = startIndex(dates, period), cl = snap?.closes?.[sym];
    if (i0 < 0 || !cl) return null;
    let base = null;
    for (let i = i0; i <= end && base == null; i++) if (cl[i] > 0) base = cl[i];
    if (base == null) return null;
    return { dates: dates.slice(i0, end + 1), values: cl.slice(i0, end + 1).map((v) => (v > 0 ? (v / base) * 100 : null)) };
  }
  /** % change of an index series from start to end. */
  const seriesReturn = (s) => (s?.values?.length ? (s.values[s.values.length - 1] / s.values[0] - 1) * 100 : null);

  const median = (xs) => {
    const a = xs.filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y);
    return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null;
  };

  /** Per sub-sector, in the snapshot's order: { id, name, n, cap, share (% of the universe's value), ret (the
   *  cap-weighted index's return, as on the chart), eqRet (median company return), best, worst ({ sym, ret }) }.
   *  `R` (companyReturns(snap)) can be passed in when the caller already has it. */
  function subStats(snap, period, R = companyReturns(snap)) {
    const subs = snap?.subsectors?.length ? snap.subsectors : U.SUBSECTORS, cos = snap?.companies || [];
    const total = cos.reduce((s, c) => s + (c.cap > 0 ? c.cap : 0), 0);
    return subs.map((s) => {
      const members = cos.filter((c) => c.sub === s.id);
      const cap = members.reduce((a, c) => a + (c.cap > 0 ? c.cap : 0), 0);
      const rs = members.map((c) => ({ sym: c.sym, ret: R.get(c.sym)?.[period] ?? null })).filter((x) => x.ret != null).sort((a, b) => b.ret - a.ret);
      return {
        id: s.id, name: s.name, n: members.length, cap, share: total > 0 ? (cap / total) * 100 : 0,
        ret: members.length ? seriesReturn(indexSeries(snap, period, { weight: "cap", sub: s.id })) : null,
        eqRet: median(rs.map((x) => x.ret)), best: rs[0] || null, worst: rs.length ? rs[rs.length - 1] : null
      };
    });
  }

  /** The n biggest risers and fallers over the period: { up, down } of { sym, name, sub, ret }. Only companies that
   *  actually rose are in `up` and only fallers in `down`, so either can be shorter than n. */
  function leaders(snap, period, n = 5, R = companyReturns(snap)) {
    const rows = (snap?.companies || []).map((c) => ({ sym: c.sym, name: c.name, sub: c.sub, ret: R.get(c.sym)?.[period] ?? null })).filter((x) => x.ret != null);
    return { up: rows.filter((x) => x.ret > 0).sort((a, b) => b.ret - a.ret).slice(0, n), down: rows.filter((x) => x.ret < 0).sort((a, b) => a.ret - b.ret).slice(0, n) };
  }

  // ---------- M&A ----------
  // A fintech word in a company's name (or its SEC industry title). Tells a payments or banking-software company apart
  // from the other software firms, banks and insurers, and a fintech SPAC from the rest.
  const FINTECH_RE = /\b(?:fin-?tech\w*|financial technolog\w*|insur-?tech\w*|wealth-?tech\w*|neo-?bank\w*|(?:digital|online|mobile|challenger) bank\w*|pay\w*|\w+pay|bnpl|lend\w*|crypto\w*|bitcoin|blockchain|digital assets?|stablecoins?|tokeni[sz]\w*|remit\w*|money transfer|robo-?advis\w*|brokerage|trading platform)\b/i;
  const CRYPTO_RE = /crypto|bitcoin|blockchain|digital asset|stablecoin/i;
  // SEC industry codes that are fintech on their own, and those that are only with a fintech name
  const SIC_SUB = { 6099: "pay", 6141: "lend", 6153: "lend", 6159: "lend", 6162: "lend", 6163: "lend", 6211: "brok", 6282: "brok", 6200: "infra", 6231: "infra" };
  const SIC_GATED = { 7374: "pay", 7371: "soft", 7372: "soft", 7373: "soft", 6331: "ins", 6411: "ins", 6021: "bank", 6022: "bank", 6035: "bank", 6036: "bank" };
  // a fintech SPAC's sub-sector, from the words in its name (first match; financial software otherwise)
  const NAME_SUB = [[/insur/i, "ins"], [/bank/i, "bank"], [/lend|loan|credit|bnpl|pay later/i, "lend"], [/broker|wealth|robo|invest|trading/i, "brok"], [/exchange|clearing|market data/i, "infra"], [/pay|remit|money transfer/i, "pay"]];

  const normSym = (t) => String(t || "").trim().toUpperCase().replace(/[./]/g, "-");
  const symMaps = new WeakMap();
  function subBySym(universe) {
    const list = universe || U.COMPANIES;
    let m = symMaps.get(list);
    if (!m) { m = new Map(list.map((c) => [normSym(c.sym), c.sub])); symMaps.set(list, m); }
    return m;
  }

  /** Is this M&A deal (src/mna.js) a fintech deal? { sub, why } or null. `universe` is [{ sym, sub }] (the
   *  snapshot's companies; the full list by default). In order: SPAC mergers are left out unless the SPAC has a fintech
   *  name; a target or buyer on the fintech list; a crypto name; the target's SEC industry code (some only with a
   *  fintech name). */
  function fintechDeal(deal, universe) {
    if (!deal?.target) return null;
    const name = String(deal.target.name || ""), M = subBySym(universe);
    const spac = deal.type === "SPAC merger";
    if (spac && !FINTECH_RE.test(name)) return null;
    for (const t of deal.target.tickers || []) { const s = M.get(normSym(t)); if (s) return { sub: s, why: "target in universe" }; }
    for (const a of deal.acquirers || []) for (const t of a.tickers || []) { const s = M.get(normSym(t)); if (s) return { sub: s, why: "buyer in universe" }; }
    if (CRYPTO_RE.test(name)) return { sub: "cryp", why: "crypto name" };
    const sic = +deal.sic || 0;
    if (SIC_SUB[sic]) return { sub: SIC_SUB[sic], why: `SIC ${sic}` };
    if (SIC_GATED[sic] && FINTECH_RE.test(`${name} ${deal.industry || ""}`)) return { sub: SIC_GATED[sic], why: `SIC ${sic} + fintech name` };
    if (spac) return { sub: (NAME_SUB.find(([re]) => re.test(name)) || [null, "soft"])[1], why: "fintech SPAC" };
    return null;
  }

  /** "2025Q3" for a yyyy-mm-dd date. */
  const quarterKey = (date) => `${String(date).slice(0, 4)}Q${Math.floor((+String(date).slice(5, 7) - 1) / 3) + 1}`;
  /** The last n quarter keys ending with `now`'s, oldest first. */
  function quarterKeys(n, now = Date.now()) {
    const d = new Date(now), out = [];
    let y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3) + 1;
    for (let i = 0; i < n; i++) { out.unshift(`${y}Q${q}`); if (--q < 1) { q = 4; y--; } }
    return out;
  }

  /** Fintech deals (already classified: each has .sub) summed up: { byQuarter: [{ q, n, value, bySub: { id: n } }] for
   *  the last 12 quarters, bySub: [{ id, n, value }] in sub-sector order, total, disclosed (how many have a size),
   *  largest (the deal, or null) }. value sums the disclosed sizes; bySub, total and largest count every deal given. */
  function dealStats(deals, now = Date.now()) {
    const keys = quarterKeys(12, now), idx = new Map(keys.map((k, i) => [k, i]));
    const byQuarter = keys.map((q) => ({ q, n: 0, value: 0, bySub: {} }));
    const subs = new Map(U.SUBSECTORS.map((s) => [s.id, { id: s.id, n: 0, value: 0 }]));
    let disclosed = 0, largest = null;
    for (const d of deals || []) {
      const v = d.value > 0 ? d.value : null;
      if (v != null) { disclosed++; if (!largest || v > largest.value) largest = d; }
      const s = subs.get(d.sub); if (s) { s.n++; s.value += v || 0; }
      const o = byQuarter[idx.get(quarterKey(d.date))];
      if (o) { o.n++; o.value += v || 0; o.bySub[d.sub] = (o.bySub[d.sub] || 0) + 1; }
    }
    return { byQuarter, bySub: [...subs.values()], total: (deals || []).length, disclosed, largest };
  }

  // ---------- news ----------
  // core themes are fintech on their own; the others (AI, deals) tag a story only once it is fintech for another reason
  const THEMES = [
    { id: "stable", name: "Stablecoins", core: true, re: /\b(?:stablecoins?|USDC|tether|USDT|GENIUS Act)\b/i },
    { id: "crypto", name: "Crypto", core: true, re: /\b(?:crypto\w*|bitcoin|ether(?:eum)?|blockchain|digital assets?|tokeni[sz]\w*|DeFi)\b/i },
    { id: "bnpl", name: "BNPL & consumer credit", core: true, re: /\b(?:BNPL|buy now,? pay later|consumer credit|credit cards?|personal loans?|subprime|delinquenc\w*|charge-?offs?)\b/i },
    { id: "pay", name: "Payments", core: true, re: /\b(?:payments? (?:company|companies|firm|giant|network|networks|processor|processing|platform|app|startup|volume)|digital payments?|card networks?|interchange|swipe fees?|real-time payments|FedNow|stripe|adyen|zelle|apple pay)\b/i },
    { id: "bank", name: "Digital banks", core: true, re: /\b(?:neo-?banks?|digital banks?|online banks?|challenger banks?|fintech (?:bank|charter)|bank charters?|Revolut|Monzo|Varo)\b/i },
    { id: "reg", name: "Open banking & regulation", core: true, re: /\b(?:CFPB|Consumer Financial Protection|GENIUS Act|CLARITY Act|open banking|(?:section|rule) 1033|1033 rule|fintech charter|market structure bill)\b/i },
    { id: "ai", name: "AI in finance", core: false, re: /\b(?:AI|artificial intelligence|machine learning|agentic|chatbots?|LLMs?)\b/ },
    { id: "deals", name: "IPOs & deals", core: false, re: /\b(?:IPOs?|initial public offering|go(?:es|ing)? public|listing|debut\w*|mergers?|acquisitions?|acquires?|acquired|takeover|buyout|to buy|funding round|raises \$)\b/i }
  ];
  // words that make a story fintech news by themselves, beyond the themes and the companies
  const NEWS_RE = /\b(?:fin-?tech\w*|insur-?tech\w*|wealth-?tech\w*|robo-?advis\w*|neobrokers?|payments? (?:company|firm|giant|startup))\b/i;
  const TICKER_RES = [/\$([A-Z]{1,5})\b/g, /\((?:(?:NYSE|NASDAQ|Nasdaq|NYSE American|NYSE Arca|Cboe)\s*:\s*)?([A-Z]{1,5})\)/g];

  const aliasCache = new WeakMap();
  function matchers(universe) {
    const list = universe || U.COMPANIES;
    let m = aliasCache.get(list);
    if (!m) {
      const known = Object.fromEntries(U.COMPANIES.map((c) => [c.sym, c.alias]));
      m = { syms: new Set(list.map((c) => c.sym)), alias: list.map((c) => [c.sym, c.alias || known[c.sym]]).filter((x) => x[1]).map(([sym, a]) => [sym, new RegExp(a)]) };
      aliasCache.set(list, m);
    }
    return m;
  }
  const textOf = (s) => `${s?.title || ""} ${s?.summary || ""}`;
  /** Theme ids a text touches. */
  const themesOf = (text) => THEMES.filter((t) => t.re.test(text)).map((t) => t.id);
  /** Fintech companies a text names, by $TICKER, "(NASDAQ: TICKER)" or company name. */
  function tickersIn(text, universe) {
    const m = matchers(universe), out = new Set();
    for (const re of TICKER_RES) for (const x of text.matchAll(re)) if (m.syms.has(x[1])) out.add(x[1]);
    for (const [sym, re] of m.alias) if (re.test(text)) out.add(sym);
    return [...out];
  }
  /** The stories (src/news/rank.js shape: { id, title, summary, link, updated, … }) that are fintech news, in the
   *  same order, each copied with `tickers` (fintech companies named) and `themes` (theme ids). A story counts when it
   *  names a company on the list, touches a core theme or uses a fintech word. */
  function newsFilter(stories, universe) {
    const out = [];
    for (const s of stories || []) {
      const text = textOf(s), tickers = tickersIn(text, universe), themes = themesOf(text);
      const core = themes.some((id) => THEMES.find((t) => t.id === id).core);
      if (tickers.length || core || NEWS_RE.test(text)) out.push({ ...s, tickers, themes });
    }
    return out;
  }
  /** How many stories touch each theme in the last 24 hours and 7 days: [{ id, name, n24h, n7d }] in THEMES order. */
  function themeCounts(stories, now = Date.now()) {
    const rows = THEMES.map((t) => ({ id: t.id, name: t.name, n24h: 0, n7d: 0 })), by = new Map(rows.map((r) => [r.id, r]));
    for (const s of stories || []) {
      const age = now - (s.updated || s.ts || 0);
      if (!(age <= 7 * DAY)) continue;
      for (const id of s.themes || themesOf(textOf(s))) { const r = by.get(id); if (!r) continue; r.n7d++; if (age <= DAY) r.n24h++; }
    }
    return rows;
  }

  const api = { PERIODS, FINTECH_RE, CRYPTO_RE, NEWS_RE, THEMES, SIC_SUB, SIC_GATED, periodStart, startIndex, ret, companyReturns, indexSeries, benchSeries, seriesReturn, median, subStats, leaders,
    fintechDeal, quarterKey, quarterKeys, dealStats, themesOf, tickersIn, newsFilter, themeCounts };
  if (NODE) module.exports = api; else window.TkFintechStats = api;
})();
