/* M&A page arithmetic shared by the page, its charts and the tests (plain functions, no DOM).
   In the app it is window.TkMnaStats; under Node it is module.exports.
   A deal is one record from src/mna.js buildDeals(): { id, target, acquirers, sector, industry, type, stage, date (first filing,
   yyyy-mm-dd), lastDate, active, value (USD or null), price, state, filings }. */
(() => {
  const DAY = 864e5;
  const RANGES = { "3M": 91, "6M": 182, "1Y": 365, "2Y": 730, "3Y": 1096 };
  // [key, label, from, to)
  const SIZES = [["u100", "Under $100M", 0, 1e8], ["100m", "$100M – $1B", 1e8, 1e9], ["1b", "$1B – $10B", 1e9, 1e10], ["10b", "$10B and up", 1e10, Infinity], ["na", "Size not disclosed", null, null]];
  // finer steps for the size histogram
  const HIST = [["< $50M", 0, 5e7], ["$50–250M", 5e7, 2.5e8], ["$250M–1B", 2.5e8, 1e9], ["$1–5B", 1e9, 5e9], ["$5–20B", 5e9, 2e10], ["$20B+", 2e10, Infinity]];
  const TYPES = ["Merger", "Tender offer", "Going private", "SPAC merger"];
  const iso = (t) => new Date(t).toISOString().slice(0, 10);

  /** The filters with nothing chosen: the last year, every sector and size, SPAC mergers left out. */
  const defaults = () => ({ range: "1Y", from: "", to: "", sector: "", industry: "", size: "", type: "", status: "", q: "", spacs: false });

  /** The date window the filters ask for, and the window of the same length just before it. */
  function span(F, now = Date.now()) {
    let from, to;
    if (F.range === "custom" && F.from) { from = F.from; to = F.to || iso(now); }
    else { to = iso(now); from = iso(now - (RANGES[F.range] || RANGES["1Y"]) * DAY); }
    const len = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / DAY));
    return { from, to, days: len, prevFrom: iso(Date.parse(from) - len * DAY), prevTo: iso(Date.parse(from) - DAY) };
  }

  const inSize = (d, key) => {
    if (!key) return true;
    if (key === "na") return d.value == null;
    const s = SIZES.find((x) => x[0] === key);
    return !!s && d.value != null && d.value >= s[2] && d.value < s[3];
  };
  /** Everything except the date window. */
  function matches(d, F) {
    if (!F.spacs && d.type === "SPAC merger" && F.type !== "SPAC merger") return false;
    if (F.sector && d.sector !== F.sector) return false;
    if (F.industry && d.industry !== F.industry) return false;
    if (F.type && d.type !== F.type) return false;
    if (F.status === "active" && !d.active) return false;
    if (F.status === "past" && d.active) return false;
    if (!inSize(d, F.size)) return false;
    if (F.q) {
      const q = F.q.trim().toLowerCase();
      if (q && !`${d.target.name} ${d.target.tickers.join(" ")} ${d.acquirers.map((a) => a.name + " " + a.tickers.join(" ")).join(" ")} ${d.industry}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }
  /** Deals that pass the filters inside the chosen window. */
  function filter(deals, F, now = Date.now()) {
    const { from, to } = span(F, now);
    return deals.filter((d) => d.date >= from && d.date <= to && matches(d, F));
  }
  /** The same filters over the window just before, for "against the period before" comparisons. */
  function previous(deals, F, now = Date.now()) {
    const { prevFrom, prevTo } = span(F, now);
    return deals.filter((d) => d.date >= prevFrom && d.date <= prevTo && matches(d, F));
  }
  /** Deals that pass every filter but the date window (the charts that show the whole three years use this). */
  const allTime = (deals, F) => deals.filter((d) => matches(d, F));

  const median = (xs) => { const a = xs.filter((v) => v != null).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
  const sum = (xs) => xs.reduce((s, v) => s + (v || 0), 0);
  const chg = (a, b) => (b ? ((a - b) / b) * 100 : null);

  /** The headline numbers for a set of deals against the set before it. */
  function summary(cur, prev) {
    const one = (ds) => {
      const vals = ds.map((d) => d.value).filter((v) => v != null);
      return { n: ds.length, value: sum(vals), known: vals.length, median: median(vals), big: vals.filter((v) => v >= 1e9).length, mega: vals.filter((v) => v >= 1e10).length,
        tender: ds.filter((d) => d.type === "Tender offer").length, priv: ds.filter((d) => d.type === "Going private").length };
    };
    const a = one(cur), b = one(prev);
    const bySector = {};
    for (const d of cur) bySector[d.sector] = (bySector[d.sector] || 0) + 1;
    const top = Object.entries(bySector).sort((x, y) => y[1] - x[1])[0] || null;
    const largest = [...cur].filter((d) => d.value != null).sort((x, y) => y.value - x.value)[0] || null;
    return { cur: a, prev: b, nChg: chg(a.n, b.n), valueChg: chg(a.value, b.value), medianChg: a.median != null && b.median != null ? chg(a.median, b.median) : null, bigChg: a.big - b.big,
      topSector: top ? { name: top[0], n: top[1], share: (top[1] / cur.length) * 100 } : null, largest };
  }

  /** Per month ("2026-11" keys, oldest first): new deals, by type, their known value, and how many were $1bn+. */
  function monthly(deals, months) {
    const idx = new Map(months.map((m, i) => [m, i]));
    const out = months.map((m) => ({ m, n: 0, value: 0, big: 0, byType: {} }));
    for (const d of deals) {
      const o = out[idx.get(d.date.slice(0, 7))];
      if (!o) continue;
      o.n++; o.byType[d.type] = (o.byType[d.type] || 0) + 1;
      if (d.value != null) { o.value += d.value; if (d.value >= 1e9) o.big++; }
    }
    return out;
  }
  /** Trailing average of `key` over `n` points (null until there are n). */
  const trailing = (rows, key, n = 3) => rows.map((_, i) => (i < n - 1 ? null : sum(rows.slice(i - n + 1, i + 1).map((r) => r[key])) / n));

  /** How many deals fall in each size step. */
  const sizeHist = (deals) => HIST.map(([label, lo, hi]) => ({ label, n: deals.filter((d) => d.value != null && d.value >= lo && d.value < hi).length }));

  const quarterOf = (date) => `${date.slice(0, 4)} Q${Math.floor((+date.slice(5, 7) - 1) / 3) + 1}`;
  /** The last n calendar quarters ending at `now`, oldest first, e.g. "2026 Q4". */
  function quarterKeys(n, now = Date.now()) {
    const d = new Date(now), out = [];
    let y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3) + 1;
    for (let i = 0; i < n; i++) { out.unshift(`${y} Q${q}`); if (--q < 1) { q = 4; y--; } }
    return out;
  }
  /** Sector × quarter grid: deal counts and known value, sectors with the most deals first. */
  function sectorQuarters(deals, quarters) {
    const idx = new Map(quarters.map((q, i) => [q, i])), rows = new Map();
    for (const d of deals) {
      const i = idx.get(quarterOf(d.date));
      if (i == null) continue;
      const r = rows.get(d.sector) || rows.set(d.sector, { sector: d.sector, n: quarters.map(() => 0), value: quarters.map(() => 0), total: 0 }).get(d.sector);
      r.n[i]++; r.total++; if (d.value != null) r.value[i] += d.value;
    }
    return [...rows.values()].sort((a, b) => b.total - a.total);
  }

  /** Sub-sectors present in a set of deals, most deals first: [[industry, count]]. */
  function industries(deals) {
    const c = {};
    for (const d of deals) c[d.industry] = (c[d.industry] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  /** $6.6B, $265M, $840K; "—" when unknown. */
  function money(v, d = 1) {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `$${(v / 1e9).toFixed(a >= 1e11 ? 0 : d)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e8 ? 0 : d)}M`;
    return `$${Math.round(v / 1e3)}K`;
  }

  const api = { RANGES, SIZES, HIST, TYPES, defaults, span, matches, filter, previous, allTime, median, summary, monthly, trailing, sizeHist, quarterOf, quarterKeys, sectorQuarters, industries, money };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.TkMnaStats = api;
})();
