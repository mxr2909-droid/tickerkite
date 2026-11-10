// Portfolio Monte Carlo (MC): main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, expose, readJSON, writeJSON } — reads the holdings and their values through ctx.expose.portfolio()
//  - IPC channels must start with "mc:" (the preload only forwards those)
//  - custom portfolios (a name plus tickers and weights) are kept in userData/mc-portfolios.json
//
// What it does: takes the portfolio at today's weights and a benchmark (SPY unless changed), downloads up to ten years of
// daily dividend-adjusted closes for each from Yahoo, and builds one daily return series for the portfolio and one for the
// benchmark on the same dates. Each of the 10,000 runs then stitches a future together from blocks of 20 consecutive real
// trading days picked at random (a block bootstrap): the portfolio and the benchmark always take the same days, so their
// correlation, fat tails and volatility clusters come from history rather than from a bell curve.
// The random numbers are seeded, so the same holdings, prices and settings give the same result every time.
const yahoo = require("./data/yahoo");
const WL = require("./watchlist");

const HORIZONS = [["6M", "6 months", 126], ["1Y", "1 year", 252], ["3Y", "3 years", 756], ["5Y", "5 years", 1260], ["10Y", "10 years", 2520]];
const RUNS = 10000, SAMPLE = 100, BLOCK = 20, SEED = 20260101, MAX_POINTS = 126;
const MIN_DAYS = 250;       // a holding needs about a year of prices to be simulated
const TIE = 0.05;           // percentage points: a run within ±0.05 of the benchmark counts as tied
const TTL = 6 * 3600e3, YEARS = 10, DAY = 864e5;
const DEFAULT_BENCH = "SPY", DEFAULT_CAPITAL = 10000, MAX_ITEMS = 30;

/** Small seeded random generator (mulberry32): same seed, same numbers. Returns a function giving [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value at percentile p (0..100) of an ascending array, interpolating between neighbours. */
function pctl(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const x = (p / 100) * (n - 1), i = Math.floor(x), f = x - i;
  return i + 1 < n ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

/** The date `n` trading days after t0 (weekdays only; market holidays are not skipped, a few days over ten years). */
function addTradingDays(t0, n) {
  const d = new Date(t0);
  let dow = d.getUTCDay();
  if (dow === 6) { d.setUTCDate(d.getUTCDate() - 1); dow = 5; }
  if (dow === 0) { d.setUTCDate(d.getUTCDate() - 2); dow = 5; }
  const idx = dow - 1 + n; // weekdays since that week's Monday
  d.setUTCDate(d.getUTCDate() - (dow - 1) + Math.floor(idx / 5) * 7 + (idx % 5));
  return d.getTime();
}

/**
 * Daily returns of the portfolio (at fixed weights) and the benchmark on the benchmark's trading dates.
 * series: { SYM: [[t, close] ascending] }; weights: [{ sym, weight, flat }] (flat: cash, held at 0% a day when it has
 * no usable price history); bench: [[t, close]].
 * A holding's last close on or before each date is used, so weekend moves (crypto) land on the next trading day.
 * Returns { dates, port, bench, used, excluded } or { error }.
 */
function alignReturns(series, weights, bench) {
  if (!bench || bench.length < MIN_DAYS) return { error: "Not enough price history for the benchmark." };
  const grid = bench.map((p) => p[0]), n = grid.length;
  const used = [], excluded = [];
  let start = 0;
  for (const w of weights) {
    if (!(w.weight > 0)) continue;
    const s = series[w.sym];
    // cash with no usable history (a money-market fund, a currency) is held flat at 0% a day instead of being dropped
    const skip = (why) => { if (w.flat) used.push({ ...w, vals: null }); else excluded.push({ sym: w.sym, why }); };
    if (!s?.length) { skip("no price history"); continue; }
    const vals = new Float64Array(n);
    let j = -1, first = -1;
    for (let i = 0; i < n; i++) {
      // a holding's bar is stamped at its own market's time, so compare calendar days, not exact times
      while (j + 1 < s.length && Math.floor(s[j + 1][0] / DAY) <= Math.floor(grid[i] / DAY)) j++;
      if (j >= 0) { vals[i] = s[j][1]; if (first < 0) first = i; } else vals[i] = NaN;
    }
    if (first < 0 || n - first < MIN_DAYS) { skip("less than a year of prices"); continue; }
    used.push({ ...w, flat: false, vals, first });
    start = Math.max(start, first);
  }
  const total = used.reduce((a, u) => a + u.weight, 0);
  if (!used.some((u) => u.vals) || !(total > 0)) return { error: "None of your holdings has enough price history to simulate (each needs about a year).", excluded };
  const len = n - start - 1;
  const port = new Float64Array(len), b = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const t = start + i + 1;
    b[i] = bench[t][1] / bench[t - 1][1] - 1;
    let r = 0;
    for (const u of used) if (u.vals) r += (u.weight / total) * (u.vals[t] / u.vals[t - 1] - 1);
    port[i] = r;
  }
  return {
    dates: grid.slice(start + 1), port, bench: b, excluded,
    used: used.map((u) => ({ sym: u.sym, name: u.name, weight: (u.weight / total) * 100, flat: !!u.flat, from: u.vals ? grid[u.first] : null }))
  };
}

/** Bins for the ending-outperformance histogram. diffs: percentage points per run. Zero is always a bin edge;
 *  the rare runs beyond the 1st/99th percentile are counted in the outermost bins. */
function histogram(diffs, target = 36) {
  const s = Float64Array.from(diffs).sort();
  let lo = Math.min(pctl(s, 1), 0), hi = Math.max(pctl(s, 99), 0);
  const raw = (hi - lo) / target || 0.1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const width = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((w) => w >= raw - 1e-12);
  const i0 = Math.min(Math.floor(lo / width + 1e-9), -1), i1 = Math.max(Math.ceil(hi / width - 1e-9), 1);
  const bins = [];
  for (let i = i0; i < i1; i++) bins.push({ lo: +(i * width).toPrecision(12), hi: +((i + 1) * width).toPrecision(12), n: 0 });
  let under = 0, over = 0;
  for (const d of diffs) {
    let k = Math.floor(d / width) - i0;
    if (k < 0) { k = 0; under++; } else if (k >= bins.length) { k = bins.length - 1; over++; }
    bins[k].n++;
  }
  return { width, bins, under, over };
}

/**
 * The simulation. port, bench: daily returns on the same dates (same length). Pure, for tests.
 * Returns values in dollars at up to MAX_POINTS evenly spaced steps (plus the start), for every percentile line,
 * the sample paths, the ending stats and the outperformance histogram.
 */
function simulate({ port, bench, days, capital = DEFAULT_CAPITAL, runs = RUNS, seed = SEED, block = BLOCK, sample = SAMPLE, startAt = Date.now() }) {
  const n = port.length;
  const step = Math.max(1, Math.ceil(days / MAX_POINTS));
  const cps = [];
  for (let d = step; d < days; d += step) cps.push(d);
  cps.push(days);
  const K = cps.length;
  const P = new Float64Array(K * runs), B = new Float64Array(K * runs); // growth of $1, one column per checkpoint
  const rand = rng(seed);
  for (let r = 0; r < runs; r++) {
    let vp = 1, vb = 1, pos = 0, k = 0;
    for (let d = 0; d < days; d++) {
      pos = d % block === 0 ? Math.floor(rand() * n) : pos + 1 === n ? 0 : pos + 1;
      vp *= 1 + port[pos]; vb *= 1 + bench[pos];
      if (d + 1 === cps[k]) { P[k * runs + r] = vp; B[k * runs + r] = vb; k++; }
    }
  }
  // the sample of paths to draw: its own seeded generator, so it stays the same 100 runs whatever else changes
  const pick = rng(seed ^ 0x9e3779b9), order = Array.from({ length: runs }, (_, i) => i), m = Math.min(sample, runs);
  for (let i = 0; i < m; i++) { const j = i + Math.floor(pick() * (runs - i)); [order[i], order[j]] = [order[j], order[i]]; }
  const usd = (g) => Math.round(g * capital * 100) / 100;
  const paths = order.slice(0, m).map((r) => [capital, ...cps.map((_, k) => usd(P[k * runs + r]))]);

  const PORT = [1, 5, 25, 50, 75, 95, 99], BENCH = [5, 25, 50, 75, 95];
  const lines = (M, ps) => {
    const out = Object.fromEntries(ps.map((p) => ["p" + p, [capital]]));
    for (let k = 0; k < K; k++) {
      const col = M.slice(k * runs, (k + 1) * runs).sort();
      for (const p of ps) out["p" + p].push(usd(pctl(col, p)));
    }
    return out;
  };
  const portL = lines(P, PORT), benchL = lines(B, BENCH);

  const endP = P.subarray((K - 1) * runs), endB = B.subarray((K - 1) * runs);
  const diffs = new Float64Array(runs);
  let ahead = 0, behind = 0, loss = 0, benchLoss = 0, sum = 0;
  for (let r = 0; r < runs; r++) {
    const d = (endP[r] - endB[r]) * 100;
    diffs[r] = d; sum += d;
    if (d > TIE) ahead++; else if (d < -TIE) behind++;
    if (endP[r] < 1) loss++;
    if (endB[r] < 1) benchLoss++;
  }
  const ds = Float64Array.from(diffs).sort();
  const share = (c) => (c / runs) * 100;
  const last = (L, ps) => Object.fromEntries(ps.map((p) => ["p" + p, L["p" + p][K]]));
  return {
    days, runs, capital, seed, block, step, sample: m,
    t: [startAt, ...cps.map((d) => addTradingDays(startAt, d))],
    port: portL, bench: benchL, paths,
    end: { port: last(portL, PORT), bench: last(benchL, BENCH), probLoss: share(loss), benchProbLoss: share(benchLoss) },
    out: {
      ahead: share(ahead), behind: share(behind), tied: share(runs - ahead - behind), tie: TIE,
      mean: sum / runs, median: pctl(ds, 50), p5: pctl(ds, 5), p95: pctl(ds, 95), ...histogram(diffs)
    }
  };
}

/** Yahoo chart JSON → [[t, dividend-adjusted close]] ascending (plain close where Yahoo gives no adjusted one). */
function closesFromChart(json) {
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp) return null;
  const adj = r.indicators?.adjclose?.[0]?.adjclose, raw = r.indicators?.quote?.[0]?.close || [];
  const pts = [];
  r.timestamp.forEach((ts, i) => { const c = adj?.[i] ?? raw[i]; if (c != null && isFinite(c) && c > 0) pts.push([ts * 1000, c]); });
  return { pts, name: r.meta?.shortName || r.meta?.longName || r.meta?.symbol || "" };
}

/** Clean up a custom portfolio read from disk or sent by the page: [{ id, name, items: [{ sym, weight }] }]. */
function sanitizeMix(m) {
  const seen = new Set(), items = [];
  for (const it of Array.isArray(m?.items) ? m.items : []) {
    const sym = WL.normalizeSymbol(it?.sym), weight = Number(it?.weight);
    if (!sym || seen.has(sym) || !(weight > 0) || !isFinite(weight) || items.length >= MAX_ITEMS) continue;
    seen.add(sym);
    items.push({ sym, name: String(it.name || sym).slice(0, 120), weight });
  }
  const name = String(m?.name || "").trim().slice(0, 40);
  if (!items.length) return null;
  return { id: /^[a-z0-9]{4,20}$/.test(m?.id || "") ? m.id : null, name: name || items.slice(0, 3).map((x) => x.sym).join(" + "), items };
}

// ---------- wiring ----------
function register(ctx) {
  const cache = new Map(); // sym -> { at, pts, name }
  let mixes = (ctx.readJSON("mc-portfolios.json", []) || []).map(sanitizeMix).filter((m) => m?.id);
  const saveMixes = () => ctx.writeJSON("mc-portfolios.json", mixes);

  async function history(sym) {
    const hit = cache.get(sym);
    if (hit && Date.now() - hit.at < TTL) return hit;
    const now = Math.floor(Date.now() / 1000);
    const got = closesFromChart(await yahoo.chart(sym, { period1: now - Math.round(YEARS * 365.25 * 86400), period2: now, interval: "1d" }, 25000));
    if (!got?.pts.length) throw new Error("no data");
    const rec = { at: Date.now(), ...got };
    cache.set(sym, rec);
    return rec;
  }
  /** Histories for many symbols, four at a time. Returns { got: { SYM: rec }, failed: [SYM] }. */
  async function histories(syms) {
    const got = {}, failed = [];
    let i = 0;
    const worker = async () => { while (i < syms.length) { const s = syms[i++]; try { got[s] = await history(s); } catch { failed.push(s); } } };
    await Promise.all(Array.from({ length: 4 }, worker));
    return { got, failed };
  }

  async function run(opts = {}) {
    const horizon = HORIZONS.find((h) => h[0] === opts.horizon) || HORIZONS[1];
    const benchSym = WL.normalizeSymbol(opts.benchmark) || DEFAULT_BENCH;
    const mix = mixes.find((m) => m.id === opts.source) || null;
    const base = {
      horizons: HORIZONS.map(([k, label]) => [k, label]), horizon: horizon[0], horizonLabel: horizon[1], benchmark: benchSym,
      mixes, source: mix ? mix.id : "holdings", sourceName: mix ? mix.name : "My holdings"
    };
    let weights, value = null, noPrice = [];
    if (mix) weights = mix.items.map((it) => ({ sym: it.sym, name: it.name, weight: it.weight, flat: false }));
    else {
      let pf = ctx.expose.portfolio?.();
      if (pf?.rows?.length && !pf.rows.some((r) => r.value != null)) { await ctx.expose.refreshPortfolio?.(); pf = ctx.expose.portfolio(); }
      const rows = (pf?.rows || []).filter((r) => r.value > 0);
      if (!pf?.rows?.length) return { ...base, ok: false, empty: true };
      if (!rows.length) return { ...base, ok: false, error: "Your holdings have no prices yet. Give the quotes a moment to load, then run it again." };
      value = rows.reduce((a, r) => a + r.value, 0);
      weights = rows.map((r) => ({ sym: r.sym, name: r.name, weight: r.value, flat: r.cls === "cash" }));
      noPrice = pf.rows.filter((r) => !(r.value > 0)).map((r) => ({ sym: r.sym, why: "no price" }));
    }
    const { got } = await histories([...new Set([benchSym, ...weights.map((w) => w.sym)])]);
    if (!got[benchSym]) return { ...base, ok: false, error: `No price history for the benchmark ${benchSym}. Check the ticker or try again in a minute.` };
    for (const w of weights) if (got[w.sym]?.name) w.name = got[w.sym].name;

    const series = Object.fromEntries(Object.entries(got).map(([s, h]) => [s, h.pts]));
    const al = alignReturns(series, weights, got[benchSym].pts);
    if (al.error) return { ...base, ok: false, error: mix ? al.error.replace("your holdings", "the tickers in this portfolio") : al.error };

    const typed = Number(opts.capital) > 0 && isFinite(opts.capital);
    const capital = typed ? Math.min(Number(opts.capital), 1e12) : Math.round(value) || DEFAULT_CAPITAL;
    const t0 = Date.now();
    const sim = simulate({ port: al.port, bench: al.bench, days: horizon[2], capital });
    return {
      ...base, ok: true, ...sim, benchName: got[benchSym].name, portfolioValue: value, capitalIsPortfolio: !typed && value != null,
      holdings: al.used.sort((a, b) => b.weight - a.weight), excluded: [...al.excluded, ...noPrice],
      history: { from: al.dates[0], to: al.dates[al.dates.length - 1], days: al.dates.length, limitedBy: al.used.filter((u) => u.from).sort((a, b) => b.from - a.from)[0]?.sym || null },
      at: Date.now(), tookMs: Date.now() - t0
    };
  }

  /** Save a custom portfolio (new when it has no id). Every ticker must have price history on Yahoo. */
  async function saveMix(raw) {
    const m = sanitizeMix(raw);
    if (!m) return { ok: false, error: "Add at least one ticker with a weight above 0." };
    const { got, failed } = await histories(m.items.map((x) => x.sym));
    if (failed.length) return { ok: false, error: `No price history on Yahoo Finance for ${failed.join(", ")}. Check the ticker (indexes start with ^, like ^GSPC).`, failed };
    for (const it of m.items) it.name = got[it.sym].name || it.sym;
    const at = mixes.findIndex((x) => x.id === m.id);
    if (at >= 0) mixes[at] = m;
    else { m.id = Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, "0"); mixes.push(m); }
    saveMixes();
    return { ok: true, id: m.id, mixes };
  }

  ctx.ipcMain.handle("mc:run", (_e, opts) => run(opts && typeof opts === "object" ? opts : {}).catch((e) => ({ ok: false, error: String(e.message || e), mixes })));
  ctx.ipcMain.handle("mc:mixes", () => mixes);
  ctx.ipcMain.handle("mc:save", (_e, m) => saveMix(m).catch((e) => ({ ok: false, error: String(e.message || e) })));
  ctx.ipcMain.handle("mc:delete", (_e, id) => { mixes = mixes.filter((m) => m.id !== String(id)); saveMixes(); return { ok: true, mixes }; });
}

module.exports = { register, sanitizeMix, rng, pctl, addTradingDays, alignReturns, histogram, simulate, closesFromChart, HORIZONS, RUNS, SAMPLE, TIE };
