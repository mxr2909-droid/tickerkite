// Fed path: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, Notification, showStory, showPage }
//  - IPC channels must start with "fed:" (the preload only forwards those for this module)
//  - bus emits "news" (stories), "quotes" (quotes), "scores" (scorecard result) after each refresh
//  - get() returns { stories, quotes, watch, scores } right now
//
// Sources (all free, no keys), cached in userData/fed-cache.json and refreshed every few hours:
//  - 30-day fed funds futures (CBOT ZQ, monthly contracts ZQ<month code><yy>.CBT) from Yahoo's chart API,
//    with ~6 months of daily closes so the path 1 week / 1 month / 3 months ago can be rebuilt (and the fan's ranges).
//    Expired months' closes are carried in the cache ("expired", ~4 months); each day's prices are also kept in
//    userData/fed-history.json (one snapshot per day the app refreshed, 400 days).
//  - FOMC meeting dates from src/calendar.js (its cached live schedule, else its checked list)
//  - Fed dots: the median fed funds row of the latest Summary of Economic Projections table
//    (federalreserve.gov fomcprojtabl<date>.htm, found from the FOMC calendar page); checked fallback below
//  - Treasury daily par yield curve CSV (home.treasury.gov), this year and last
//  - FRED fredgraph.csv (no key): DFF, SOFR, DPRIME, DGS2, DGS10

const { fetchText } = require("./news/fetcher");
const http = require("./data/http");
const yahoo = require("./data/yahoo");
const { parseFredCsv } = require("./macro/data");
const calendar = require("./calendar");

const DAY = 864e5;
const TTL = 4 * 3600e3;
const CODES = "FGHJKMNQUVXZ";
const AHEAD = 16; // contract months fetched from the current month on

// Checked against federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm on SEP_CHECKED
const SEP_CHECKED = "2026-10-20";
const SEP_FALLBACK = {
  asOf: "2026-09-16", live: false, url: "https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm",
  years: ["2026", "2027", "2028", "2029", "Longer run"], median: [4.1, 4.1, 3.9, 3.6, 3.2],
  prior: { label: "June projection", median: [3.8, 3.6, 3.4, null, 3.1] }
};

const STRIP = [
  ["DFF", "Effective fed funds"], ["SOFR", "SOFR"], ["DPRIME", "Prime rate"], ["DGS2", "2-year Treasury"], ["DGS10", "10-year Treasury"]
];
const TENORS = [["1 Mo", "1M"], ["2 Mo", "2M"], ["3 Mo", "3M"], ["4 Mo", "4M"], ["6 Mo", "6M"], ["1 Yr", "1Y"], ["2 Yr", "2Y"], ["3 Yr", "3Y"], ["5 Yr", "5Y"], ["7 Yr", "7Y"], ["10 Yr", "10Y"], ["20 Yr", "20Y"], ["30 Yr", "30Y"]];

// ---------- dates ----------
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const mkey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const nextKey = (k) => { const [y, m] = k.split("-").map(Number); return m === 12 ? mkey(y + 1, 0) : mkey(y, m); };
const addDays = (d, n) => iso(Date.parse(d + "T00:00:00Z") + n * DAY);

/** Contract months from `from` (ISO date) on: [{ key: "2026-10", sym: "ZQV26.CBT" }] */
function contracts(from, n = AHEAD) {
  let y = +from.slice(0, 4), m = +from.slice(5, 7) - 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ key: mkey(y, m), sym: `ZQ${CODES[m]}${String(y).slice(2)}.CBT` });
    if (++m === 12) { m = 0; y++; }
  }
  return out;
}

// ---------- parsing ----------
/** Yahoo chart JSON → { price, closes: [[isoDate, close]] } (dates in the exchange's time zone) */
function parseChart(json) {
  const r = (typeof json === "string" ? JSON.parse(json) : json)?.chart?.result?.[0];
  if (!r) throw new Error("no chart");
  const off = (r.meta?.gmtoffset || 0) * 1000;
  const close = r.indicators?.quote?.[0]?.close || [];
  const closes = [];
  (r.timestamp || []).forEach((t, i) => { if (close[i] != null) closes.push([iso(t * 1000 + off), close[i]]); });
  const price = r.meta?.regularMarketPrice ?? closes[closes.length - 1]?.[1];
  if (price == null) throw new Error("no price");
  return { price, at: (r.meta?.regularMarketTime || 0) * 1000, closes };
}

/** Last value on or before `date` from [[isoDate, v]] (oldest first). */
function valueOn(rows, date) {
  let v = null;
  for (const [d, x] of rows || []) { if (d <= date) v = x; else break; }
  return v;
}

/** Treasury par yield curve CSV → [{ date, y: { "1M": 4.11, ... } }], newest first */
function parseTreasury(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  const head = lines[0].split(",").map((s) => s.replace(/"/g, "").trim());
  const col = TENORS.map(([h, k]) => [head.indexOf(h), k]).filter(([i]) => i >= 0);
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(c[0]);
    if (!m) continue;
    const y = {};
    for (const [i, k] of col) { const n = parseFloat(c[i]); if (Number.isFinite(n)) y[k] = n; }
    out.push({ date: `${m[3]}-${m[1]}-${m[2]}`, y });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const cellText = (s) => s.replace(/<sup[\s\S]*?<\/sup>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();

/** SEP table page → { years, median, prior }: the median "Federal funds rate" row of Table 1. */
function parseSep(html) {
  const rows = [];
  for (const tr of String(html).split(/<tr[\s>]/i).slice(1)) {
    const cells = [...tr.split(/<\/tr>/i)[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => cellText(m[1]));
    rows.push(cells);
  }
  const yr = rows.find((r) => r.filter((c) => /^\d{4}$|^Longer run$/i.test(c)).length >= 3);
  if (!yr) throw new Error("no year header");
  const years = [];
  for (const c of yr) { if (/^\d{4}$|^Longer run$/i.test(c)) { if (years.includes(c)) break; years.push(c); } }
  const num = (c) => { const n = parseFloat(c); return /^-?\d+(\.\d+)?$/.test(c) ? n : null; };
  const i = rows.findIndex((r) => /^Federal funds rate/i.test(r[0] || ""));
  if (i < 0) throw new Error("no fed funds row");
  const median = rows[i].slice(1, 1 + years.length).map(num);
  if (median.filter((v) => v != null).length < 2) throw new Error("no medians");
  const p = rows[i + 1];
  const prior = p && /projection/i.test(p[0]) ? { label: p[0], median: p.slice(1, 1 + years.length).map(num) } : null;
  return { years, median, prior };
}

/** Latest projections-table link on the FOMC calendar page → { url, asOf } */
function latestSepLink(html) {
  const ds = [...String(html).matchAll(/fomcprojtabl(\d{8})\.htm/g)].map((m) => m[1]).sort();
  if (!ds.length) return null;
  const d = ds[ds.length - 1];
  return { url: `https://www.federalreserve.gov/monetarypolicy/fomcprojtabl${d}.htm`, asOf: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` };
}

// ---------- the math ----------
/** A move of `bp` priced at one meeting → odds of holding, a 25bp move and a 50bp move. */
function odds(bp) {
  const a = Math.abs(bp);
  const p50 = a > 25 ? Math.min(1, (a - 25) / 25) : 0;
  const p25 = a > 25 ? 1 - p50 : a / 25;
  const hold = Math.max(0, 1 - p25 - p50);
  const dir = hold >= 0.5 ? "hold" : bp > 0 ? "hike" : "cut";
  return { hold, p25, p50, dir };
}

/**
 * Futures → per-meeting implied path (the usual day-weighting method).
 * rates: { "2026-10": 3.885, ... } implied average rate per month (100 − price)
 * meetings: [{ date (decision day), start, sep }]; spot: the rate going in (effective fed funds)
 * In a meeting month with N days and the decision on day d, the old rate holds d days and the new one N − d:
 *   avg = (d·pre + (N − d)·post) / N  →  post = (N·avg − d·pre) / (N − d)
 * When the next month has no meeting its average is the post-meeting rate itself, which is used instead
 * (steadier when the meeting is late in the month). Each meeting's post rate is the next one's pre rate.
 */
function impliedPath(rates, meetings, spot, asOf) {
  const mtgs = (meetings || []).filter((m) => m.date >= asOf).sort((a, b) => (a.date < b.date ? -1 : 1));
  const hasMtg = new Set(mtgs.map((m) => m.date.slice(0, 7)));
  const first = rates[asOf.slice(0, 7)];
  let pre = Number.isFinite(spot) ? spot : first;
  if (!Number.isFinite(pre)) return null;
  const start = pre, rows = [];
  for (const m of mtgs) {
    const k = m.date.slice(0, 7), avg = rates[k], nk = nextKey(k);
    const N = daysIn(+k.slice(0, 4), +k.slice(5) - 1), d = +m.date.slice(8);
    let post;
    if (!hasMtg.has(nk) && Number.isFinite(rates[nk])) post = rates[nk];
    else if (Number.isFinite(avg) && N - d > 0) post = (N * avg - d * pre) / (N - d);
    else if (Number.isFinite(rates[nk])) post = rates[nk];
    else break; // no futures this far out
    const move = (post - pre) * 100;
    rows.push({ date: m.date, start: m.start, sep: !!m.sep, pre, post, move, cum: (post - start) * 100, ...odds(move) });
    pre = post;
  }
  if (!rows.length) return { start, rows, end: start, extreme: null };
  let hi = rows[0], lo = rows[0];
  for (const r of rows) { if (r.post > hi.post) hi = r; if (r.post < lo.post) lo = r; }
  const up = hi.post - start, dn = start - lo.post;
  const extreme = Math.max(up, dn) < 0.05 ? null : up >= dn ? { kind: "peak", rate: hi.post, date: hi.date } : { kind: "trough", rate: lo.post, date: lo.date };
  return { start, rows, end: rows[rows.length - 1].post, extreme };
}

/** Implied rates per month as of `date`: futures closes, then the daily snapshots for anything missing. */
function ratesOn(futures, history, date) {
  const out = {};
  const snap = Object.keys(history || {}).filter((d) => d <= date).sort().pop();
  if (snap) Object.assign(out, history[snap].rates);
  for (const [k, f] of Object.entries(futures || {})) { const p = valueOn(f.closes, date); if (p != null) out[k] = 100 - p; }
  return out;
}

/** The implied path as it stood on `date`, from the stored closes and daily snapshots (null when nothing was stored). */
function pathAt(futures, history, meetings, dff, date) {
  const rates = ratesOn(futures, history, date);
  return Object.keys(rates).length ? impliedPath(rates, meetings, valueOn(dff, date), date) : null;
}

// Look-back windows for the fan: key, days, label (1W and 1M match the existing w1 / m1 comparisons)
const FAN = [["w1", 7, "1 week"], ["m1", 30, "1 month"], ["m3", 91, "3 months"]];
const between = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/**
 * How the expected path has moved: for each upcoming meeting (today's path), today's implied rate, the rate
 * as of 1W / 1M / 3M ago, and the lowest / highest implied rate seen on any stored day in each window.
 * Stored days = every futures close date plus weekday snapshot dates; the path is rebuilt on each with pathAt.
 * A window's range also counts the path as of its first day, so the "ago" line always sits inside its band.
 * → { asOf, start, windows: [{ key, label, days, from, since, span, obs, full, start: {lo, hi, ago} }],
 *     rows: [{ date, start, sep, now, ago: { w1, m1, m3 }, range: { w1: { lo, hi, n } | null, ... } }] }
 *   ago[k] is null when history doesn't reach that far or that meeting had no contract yet; obs = days with a path.
 */
function pathFan(futures, history, meetings, dff, today) {
  const at = (d) => pathAt(futures, history, meetings, dff, d);
  const now = at(today);
  if (!now?.rows.length) return null;
  const set = new Set();
  for (const f of Object.values(futures || {})) for (const [d] of f.closes || []) set.add(d);
  for (const d of Object.keys(history || {})) { const wd = new Date(d + "T12:00:00Z").getUTCDay(); if (wd && wd < 6) set.add(d); }
  const all = [...set].filter((d) => d < today).sort();
  const earliest = all[0] || today;
  const oldest = addDays(today, -Math.max(...FAN.map((f) => f[1])));
  const paths = all.filter((d) => d >= oldest).map((d) => [d, at(d)]).filter(([, p]) => p?.rows.length);
  paths.push([today, now]);
  const post = (p, date) => p?.rows.find((r) => r.date === date)?.post ?? null;
  const span = (vs) => (vs.length ? { lo: Math.min(...vs), hi: Math.max(...vs), n: vs.length } : null);
  const win = FAN.map(([key, days, label]) => {
    const from = addDays(today, -days), full = earliest <= from;
    const ago = full ? at(from) : null; // the path as of the window's first day (last stored prices on or before it)
    const inW = paths.filter(([d]) => d >= from).map(([, p]) => p).concat(ago?.rows.length ? [ago] : []);
    const since = full ? from : paths.find(([d]) => d >= from)[0];
    return { key, label, days, from, since, span: between(since, today), obs: inW.length - (ago?.rows.length ? 1 : 0), full, ago, inW };
  });
  const rows = now.rows.map((r) => ({
    date: r.date, start: r.start, sep: r.sep, now: r.post,
    ago: Object.fromEntries(win.map((w) => [w.key, post(w.ago, r.date)])),
    range: Object.fromEntries(win.map((w) => [w.key, span(w.inW.map((p) => post(p, r.date)).filter((v) => v != null))]))
  }));
  const windows = win.map(({ ago, inW, ...w }) => ({ ...w, start: { ...span(inW.map((p) => p.start)), ago: ago?.rows.length ? ago.start : null } }));
  return { asOf: today, start: now.start, windows, rows };
}

/** Market rate at the end of each SEP year: the post-meeting rate of that year's last meeting in the path. */
function marketVsDots(path, sep) {
  if (!sep) return [];
  return sep.years.map((y, i) => {
    const last = /^\d{4}$/.test(y) ? (path?.rows || []).filter((r) => r.date.startsWith(y)).pop() : null;
    const mkt = last ? last.post : null, dot = sep.median[i];
    return { year: y, dot, prior: sep.prior?.median?.[i] ?? null, market: mkt, gap: mkt != null && dot != null ? (mkt - dot) * 100 : null };
  });
}

/** [[date, v]] → latest, value ~1 month earlier and the change in bp */
function stripRow(rows, id, name) {
  if (!rows?.length) return { id, name, v: null };
  const [d, v] = rows[rows.length - 1];
  const was = valueOn(rows, addDays(d, -30));
  return { id, name, v, date: d, was, chg: was != null ? (v - was) * 100 : null };
}

function curves(rows) {
  if (!rows?.length) return null;
  const at = (n) => { const target = addDays(rows[0].date, -n); return rows.find((r) => r.date <= target) || null; };
  return { tenors: TENORS.map(([, k]) => k), now: rows[0], m1: at(30), y1: at(365) };
}

// ---------- fetching ----------
// federalreserve.gov drops Node's own fetch; Electron's network stack gets through (as in calendar.js)
const getText = (url, timeoutMs = 20000) => http.getText(url, { timeoutMs, net: true, headers: { Accept: "text/html,text/csv,*/*" } });

/** Contracts that rolled out of the fetched months: their closes are kept ~4 months (Yahoo stops serving them). */
function keepExpired(prev, today) {
  const cur = today.slice(0, 7), cut = addDays(today, -120), out = {};
  for (const [k, f] of Object.entries({ ...prev?.expired, ...prev?.futures })) {
    if (k >= cur) continue;
    const closes = (f.closes || []).filter(([d]) => d >= cut);
    if (closes.length) out[k] = { sym: f.sym, closes };
  }
  return out;
}

async function fetchAll(prev) {
  const now = Date.now(), today = iso(now), errors = {};
  const keep = (name, p, old) => p.catch((e) => { errors[name] = String(e.message || e); return old; });
  const futures = {};
  const futP = Promise.all(contracts(today).map(async (c) => {
    try {
      const f = parseChart(await yahoo.chart(c.sym, { range: "6mo", interval: "1d" }, 15000));
      futures[c.key] = { sym: c.sym, ...f };
    } catch (e) { if (prev?.futures?.[c.key]) futures[c.key] = prev.futures[c.key]; }
  }));
  const since = addDays(today, -120); // EFFR on the 3-month-ago date starts that day's path
  const fredP = Promise.all(STRIP.map(([id]) => keep(id, fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${since}`, 25000)
    .then((t) => parseFredCsv(t).map(([ts, v]) => [iso(ts), v])), prev?.fred?.[id]).then((r) => [id, r])));
  const y = +today.slice(0, 4);
  const tsyUrl = (yy) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yy}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yy}&page&_format=csv`;
  const tsyP = keep("treasury", Promise.all([getText(tsyUrl(y)), getText(tsyUrl(y - 1))])
    .then(([a, b]) => { const r = [...parseTreasury(a), ...parseTreasury(b)]; if (!r.length) throw new Error("nothing parsed"); return r; }), prev?.treasury);
  const sepP = keep("sep", (async () => {
    const link = latestSepLink(await getText("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"));
    if (!link) throw new Error("no projections link");
    if (prev?.sep?.live && prev.sep.asOf === link.asOf) return prev.sep;
    return { ...parseSep(await getText(link.url)), ...link, live: true };
  })(), prev?.sep);
  const [, fredRows, treasury, sep] = await Promise.all([futP, fredP, tsyP, sepP]);
  if (!Object.keys(futures).length) errors.futures = "no fed funds futures prices";
  return { at: now, futures, expired: keepExpired(prev, today), fred: Object.fromEntries(fredRows.filter(([, r]) => r)), treasury: treasury || null, sep: sep || null, errors };
}

// ---------- wiring ----------
function meetings(ctx) {
  const live = ctx.readJSON("calendar-cache.json", null)?.sched?.fomc;
  const f = live?.items?.length ? live : calendar.fallbackSched().fomc;
  return { items: f.items, live: !!f.live };
}

function build(cache, mt, history, now = Date.now()) {
  const today = iso(now);
  const base = { now, fetchedAt: cache?.at || 0, errors: cache?.errors || {}, meetingsLive: mt.live, sepChecked: SEP_CHECKED };
  if (!cache) return { ...base, loading: true };
  const dff = cache.fred?.DFF;
  const fut = { ...cache.expired, ...cache.futures }; // expired months' closes keep past paths whole across month-ends
  const pathOn = (date) => pathAt(fut, history, mt.items, dff, date);
  const path = Object.keys(cache.futures || {}).length ? pathOn(today) : null;
  const sep = cache.sep || SEP_FALLBACK;
  const prime = valueOn(cache.fred?.DPRIME, today);
  return {
    ...base,
    path, w1: path ? pathOn(addDays(today, -7)) : null, m1: path ? pathOn(addDays(today, -30)) : null,
    effr: valueOn(dff, today), quoteAt: Math.max(0, ...Object.values(cache.futures || {}).map((f) => f.at || 0)),
    target: prime != null ? [prime - 3.25, prime - 3] : null, // prime is set at the top of the target range + 3
    futures: Object.entries(cache.futures || {}).map(([k, f]) => ({ month: k, sym: f.sym, price: f.price, rate: 100 - f.price, at: f.at })).sort((a, b) => (a.month < b.month ? -1 : 1)),
    fan: path ? pathFan(fut, history, mt.items, dff, today) : null,
    sep, dots: marketVsDots(path, sep),
    strip: STRIP.map(([id, name]) => stripRow(cache.fred?.[id], id, name)),
    curve: curves(cache.treasury)
  };
}

function register(ctx) {
  let cache = ctx.readJSON("fed-cache.json", null);
  let history = ctx.readJSON("fed-history.json", {});
  let loading = null;
  const payload = () => build(cache, meetings(ctx), history);
  const push = () => ctx.send("fed:update", payload());

  function snapshot() {
    const day = iso(Date.now()), rates = {};
    for (const [k, f] of Object.entries(cache?.futures || {})) rates[k] = 100 - f.price;
    if (!Object.keys(rates).length) return;
    history[day] = { rates };
    const cut = iso(Date.now() - 400 * DAY);
    for (const d of Object.keys(history)) if (d < cut) delete history[d];
    ctx.writeJSON("fed-history.json", history);
  }
  async function refresh(force) {
    if (loading) return loading;
    if (!force && cache && Date.now() - cache.at < TTL) return;
    loading = fetchAll(cache).then((c) => { cache = c; ctx.writeJSON("fed-cache.json", c); snapshot(); push(); })
      .catch((e) => console.error("fed", e)).finally(() => { loading = null; });
    return loading;
  }

  ctx.ipcMain.handle("fed:get", () => { refresh(false); return payload(); });
  ctx.ipcMain.handle("fed:refresh", async () => { await refresh(true); return payload(); });
  ctx.ipcMain.handle("fed:headlines", () => calendar.headlines(ctx.get().stories, [...calendar.RELEASES.fomc.words, "treasury yields", "bond yields", "rate path"])
    .map((s) => ({ id: s.id, title: s.title, publisher: s.publisher, ts: s.ts, url: s.url })));
  setTimeout(() => refresh(false), 10000);
  setInterval(() => refresh(false), 30 * 60e3);
}

module.exports = { register, contracts, parseChart, parseTreasury, parseSep, latestSepLink, odds, impliedPath, ratesOn, pathAt, pathFan, keepExpired, marketVsDots, stripRow, curves, valueOn, build, SEP_FALLBACK };
