// Yield curve page: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, readJSON, writeJSON }
//  - IPC channels must start with "curve:" (the preload only forwards those)
// Data: the US Treasury's daily par yield curve and real (TIPS) yield curve CSVs (home.treasury.gov, public
// domain, no key). Three years of nominal curves and two of real ones, cached in curve-cache.json. Treasury
// posts each day's curve after the close, so the cache is re-checked hourly and refetched when 3+ hours old.
const { fetchText } = require("./news/fetcher");

const TTL = 3 * 3600e3;
const NOMINAL = ["1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];
const REAL = ["5Y", "7Y", "10Y", "20Y", "30Y"];
// the 3D surface leaves out the 2- and 4-month bills, which crowd the short end
const SURFACE = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];
// years to maturity, for spacing the chart
const YEARS = { "1M": 1 / 12, "2M": 2 / 12, "3M": 0.25, "4M": 4 / 12, "6M": 0.5, "1Y": 1, "2Y": 2, "3Y": 3, "5Y": 5, "7Y": 7, "10Y": 10, "20Y": 20, "30Y": 30 };
const SPREADS = [["2s10s", "10Y", "2Y", "10-year minus 2-year: the classic recession signal when negative"],
  ["3m10y", "10Y", "3M", "10-year minus 3-month: the Fed's preferred inversion measure"],
  ["5s30s", "30Y", "5Y", "30-year minus 5-year: long-end steepness"]];

/** Header label → tenor key: "1 Mo" → 1M, "10 Yr" / "10 YR" → 10Y. "1.5 Month" (a 2025 addition) is skipped. */
function tenorKey(label) {
  const m = /^(\d+)\s*(mo|month|yr|year)s?$/i.exec(String(label).replace(/"/g, "").trim());
  if (!m) return null;
  return `${m[1]}${/^mo/i.test(m[2]) ? "M" : "Y"}`;
}

/** Treasury rates CSV (nominal or real) → [{ date: "YYYY-MM-DD", y: { "2Y": 4.79, ... } }], newest first. */
function parseCurveCsv(csv) {
  const lines = String(csv || "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const cols = lines[0].split(",").map((h, i) => [i, tenorKey(h)]).filter(([, k]) => k);
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(c[0].trim());
    if (!m) continue;
    const y = {};
    for (const [i, k] of cols) { const v = parseFloat(c[i]); if (Number.isFinite(v)) y[k] = v; }
    if (Object.keys(y).length) out.push({ date: `${m[3]}-${m[1]}-${m[2]}`, y });
  }
  return out;
}

/** Merge yearly files: one row per date (later files don't override), newest first. */
function merge(...lists) {
  const m = new Map();
  for (const l of lists) for (const r of l || []) if (!m.has(r.date)) m.set(r.date, r);
  return [...m.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
/** The row on or before `days` calendar days before the newest row (rows newest first). */
function ago(rows, days) {
  if (!rows?.length) return null;
  const target = addDays(rows[0].date, -days);
  return rows.find((r) => r.date <= target) || null;
}
/** "Yesterday" is the previous published row, not the previous calendar day. */
const prev = (rows) => rows?.[1] || null;

/** Spreads (in basis points) for one row. */
function spreads(row) {
  if (!row) return {};
  const out = {};
  for (const [k, a, b] of SPREADS) if (row.y[a] != null && row.y[b] != null) out[k] = Math.round((row.y[a] - row.y[b]) * 100);
  return out;
}

/** Breakeven inflation (nominal − real) per tenor, for the latest date both curves have. */
function breakevens(nom, real) {
  const r = real?.[0];
  const n = r && nom.find((x) => x.date === r.date);
  if (!n) return null;
  const be = {};
  for (const k of REAL) if (n.y[k] != null && r.y[k] != null) be[k] = +(n.y[k] - r.y[k]).toFixed(2);
  return { date: r.date, be };
}

/** Days the 2s10s or 3m10y has been inverted in a row (as of the latest row), and when it last flipped. */
function inversion(rows, key) {
  const [, a, b] = SPREADS.find((s) => s[0] === key);
  const sp = (r) => (r.y[a] != null && r.y[b] != null ? r.y[a] - r.y[b] : null);
  const first = sp(rows[0]);
  if (first == null) return null;
  const inverted = first < 0;
  let i = 0;
  while (i < rows.length && sp(rows[i]) != null && (sp(rows[i]) < 0) === inverted) i++;
  return { inverted, since: rows[Math.min(i, rows.length) - 1]?.date || null, sessions: i, full: i >= rows.length };
}

/** Curves over time for the 3D surface: every `step`-th session counting back from the newest, oldest first.
 *  { tenors, rows: [[date, ...yields in tenor order]] }; days missing any of the tenors are left out. */
function surface(nom, step = 3, tenors = SURFACE) {
  const rows = [];
  for (let i = 0; i < (nom || []).length; i += step) {
    const r = nom[i], ys = tenors.map((t) => r.y[t]);
    if (ys.every((v) => v != null)) rows.push([r.date, ...ys]);
  }
  return { tenors, rows: rows.reverse() };
}

function payload(cache) {
  const nom = cache?.nominal || [], real = cache?.real || [];
  if (!nom.length) return { at: cache?.at || 0, error: cache?.error || null, empty: true };
  const cmp = { "1D": prev(nom), "1W": ago(nom, 7), "1M": ago(nom, 30), "3M": ago(nom, 91), "1Y": ago(nom, 365) };
  return {
    at: cache.at, error: cache.error || null, tenors: NOMINAL, realTenors: REAL, years: YEARS, spreadDefs: SPREADS,
    now: nom[0], cmp, real: { now: real[0] || null, "1M": ago(real, 30), "1Y": ago(real, 365) }, breakevens: breakevens(nom, real),
    spreads: { now: spreads(nom[0]), ...Object.fromEntries(Object.entries(cmp).map(([k, r]) => [k, spreads(r)])) },
    inversion: { "2s10s": inversion(nom, "2s10s"), "3m10y": inversion(nom, "3m10y") },
    surface: surface(nom),
    // daily history for the spread chart, oldest first: [date, 2s10s, 3m10y, 5s30s, 10Y]
    history: nom.slice().reverse().map((r) => { const s = spreads(r); return [r.date, s["2s10s"] ?? null, s["3m10y"] ?? null, s["5s30s"] ?? null, r.y["10Y"] ?? null]; })
  };
}

const url = (kind, yy) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yy}/all?type=${kind}&field_tdr_date_value=${yy}&page&_format=csv`;

function register(ctx) {
  let cache = ctx.readJSON("curve-cache.json", null), loading = null;
  const push = () => ctx.send("curve:update", payload(cache));
  async function refresh(force) {
    if (loading) return loading;
    if (!force && cache && Date.now() - cache.at < TTL) return;
    const y = new Date().getUTCFullYear();
    loading = (async () => {
      try {
        const [n0, n1, n2, r0, r1] = await Promise.all([
          fetchText(url("daily_treasury_yield_curve", y), 20000), fetchText(url("daily_treasury_yield_curve", y - 1), 20000).catch(() => ""),
          fetchText(url("daily_treasury_yield_curve", y - 2), 20000).catch(() => ""),
          fetchText(url("daily_treasury_real_yield_curve", y), 20000).catch(() => ""), fetchText(url("daily_treasury_real_yield_curve", y - 1), 20000).catch(() => "")
        ]);
        const nominal = merge(parseCurveCsv(n0), parseCurveCsv(n1), parseCurveCsv(n2));
        if (!nominal.length) throw new Error("no curve data in Treasury's file");
        cache = { at: Date.now(), nominal, real: merge(parseCurveCsv(r0), parseCurveCsv(r1)), error: null };
      } catch (e) {
        cache = { ...(cache || {}), at: cache?.at || 0, error: String(e.message || e) };
      }
      ctx.writeJSON("curve-cache.json", cache);
      push();
    })().finally(() => { loading = null; });
    return loading;
  }
  ctx.ipcMain.handle("curve:get", () => { refresh(false); return payload(cache); });
  ctx.ipcMain.handle("curve:refresh", async () => { await refresh(true); return payload(cache); });
  setTimeout(() => refresh(false), 12000);
  setInterval(() => refresh(false), 3600e3);
}

module.exports = { register, parseCurveCsv, tenorKey, merge, ago, spreads, breakevens, inversion, payload, surface, NOMINAL, REAL };
