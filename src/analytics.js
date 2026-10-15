// Pure price analytics: range stats, smoothed derivatives (momentum) and big-move detection.
// No network, no Electron, so it's unit-tested in test/analytics.test.js.

const RANGES = {
  "1D": { range: "1d", interval: "5m", kind: "intra", moves: 4, refreshMs: 60e3 },
  "5D": { range: "5d", interval: "30m", kind: "intra5", moves: 3, refreshMs: 3 * 60e3 },
  "1M": { range: "1mo", interval: "1d", kind: "daily", moves: 4, refreshMs: 5 * 60e3 },
  "3M": { range: "3mo", interval: "1d", kind: "daily", moves: 5, refreshMs: 5 * 60e3 },
  "6M": { range: "6mo", interval: "1d", kind: "daily", moves: 5, refreshMs: 10 * 60e3 },
  "YTD": { range: "ytd", interval: "1d", kind: "daily", moves: 6, refreshMs: 10 * 60e3 },
  "1Y": { range: "1y", interval: "1d", kind: "daily", moves: 6, refreshMs: 10 * 60e3 },
  "5Y": { range: "5y", interval: "1wk", kind: "weekly", moves: 6, refreshMs: 30 * 60e3 }
};

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
function ema(a, n) {
  const k = 2 / (n + 1);
  const out = new Array(a.length);
  let prev = a[0];
  for (let i = 0; i < a.length; i++) { prev = i === 0 ? a[0] : a[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function percentile(arr, x) {
  if (!arr.length) return 50;
  let below = 0;
  for (const v of arr) if (v < x) below++;
  return Math.round((below / arr.length) * 100);
}

/** Exchange-local calendar date (YYYY-MM-DD) for a timestamp in ms. */
function localDay(t, gmtoffset = 0) {
  return new Date(t + gmtoffset * 1000).toISOString().slice(0, 10);
}

/** Normalise Yahoo chart JSON into {points, meta}. */
function fromYahoo(json) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description || "no data");
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null || !Number.isFinite(c)) continue;
    points.push({ t: ts[i] * 1000, o: q.open?.[i] ?? c, h: q.high?.[i] ?? c, l: q.low?.[i] ?? c, c, v: q.volume?.[i] ?? 0 });
  }
  const m = r.meta || {};
  return {
    points,
    meta: {
      last: m.regularMarketPrice ?? points.at(-1)?.c,
      prevClose: m.chartPreviousClose ?? m.previousClose ?? null,
      dayHigh: m.regularMarketDayHigh ?? null,
      dayLow: m.regularMarketDayLow ?? null,
      high52: m.fiftyTwoWeekHigh ?? null,
      low52: m.fiftyTwoWeekLow ?? null,
      currency: m.currency || "",
      gmtoffset: m.gmtoffset ?? 0,
      tz: m.exchangeTimezoneName || "",
      time: (m.regularMarketTime ?? 0) * 1000
    }
  };
}

/** Per-bar change: log % for prices, basis points for yields. */
function barChanges(points, type) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].c, b = points[i].c;
    out.push(type === "yld" ? (b - a) * 100 : Math.log(b / a) * 100);
  }
  return out;
}

function periodsPerYear(cfg, points) {
  if (cfg.kind === "weekly") return 52;
  if (cfg.kind === "daily") return 252;
  // intraday: bars per day observed in the data x 252
  const days = new Set(points.map((p) => new Date(p.t).toISOString().slice(0, 10))).size || 1;
  return (points.length / days) * 252;
}

function stats(points, cfg, type, meta = {}) {
  if (points.length < 2) return null;
  const last = points.at(-1).c;
  const base = cfg.kind === "intra" && meta.prevClose ? meta.prevClose : points[0].c;
  const chg = last - base;
  const pct = type === "yld" ? null : (chg / base) * 100;
  const hi = Math.max(...points.map((p) => p.h ?? p.c));
  const lo = Math.min(...points.map((p) => p.l ?? p.c));
  const ch = barChanges(points, type);
  const vol = std(ch) * Math.sqrt(periodsPerYear(cfg, points));

  // max drawdown (prices) / max pullback in bp (yields), peak to trough
  let peak = points[0].c, dd = 0, ddPeak = points[0].t, ddTrough = points[0].t, curPeakT = points[0].t;
  for (const p of points) {
    if (p.c > peak) { peak = p.c; curPeakT = p.t; }
    const d = type === "yld" ? (p.c - peak) * 100 : (p.c / peak - 1) * 100;
    if (d < dd) { dd = d; ddPeak = curPeakT; ddTrough = p.t; }
  }

  let best = { v: -Infinity, t: 0 }, worst = { v: Infinity, t: 0 }, up = 0;
  for (let i = 0; i < ch.length; i++) {
    if (ch[i] > best.v) best = { v: ch[i], t: points[i + 1].t };
    if (ch[i] < worst.v) worst = { v: ch[i], t: points[i + 1].t };
    if (ch[i] > 0) up++;
  }

  const vols = points.map((p) => p.v || 0);
  const avgVol = mean(vols.filter((v) => v > 0));
  return {
    base, last, chg, pct, hi, lo,
    pos: hi > lo ? (last - lo) / (hi - lo) : 0.5,
    vol, volUnit: type === "yld" ? "bp" : "%",
    maxDD: dd, ddPeak, ddTrough,
    best, worst,
    upShare: ch.length ? up / ch.length : 0,
    bars: ch.length,
    avgVol: avgVol || 0,
    lastVol: vols.at(-1) || 0,
    fromHigh52: meta.high52 ? (type === "yld" ? (last - meta.high52) * 100 : (last / meta.high52 - 1) * 100) : null,
    fromLow52: meta.low52 ? (type === "yld" ? (last - meta.low52) * 100 : (last / meta.low52 - 1) * 100) : null
  };
}

/**
 * Momentum from a smoothed series.
 * velocity = 1st derivative of smoothed (log) price, acceleration = 2nd derivative.
 * Units: % (or bp for yields) per hour (1D), per day (5D, daily) or per week (5Y).
 */
function momentum(points, cfg, type) {
  const n = points.length;
  if (n < 5) return null;
  const x = points.map((p) => (type === "yld" ? p.c * 100 : Math.log(p.c) * 100));
  const w = clamp(Math.round(n / 12), 3, 15);
  const s = ema(x, w);
  const v = s.map((val, i) => (i === 0 ? 0 : val - s[i - 1]));
  v[0] = v[1] ?? 0;
  const vs = ema(v, w);
  const a = vs.map((val, i) => (i === 0 ? 0 : val - vs[i - 1]));
  a[0] = a[1] ?? 0;
  const as = ema(a, w);

  let f = 1, per = "day";
  if (cfg.kind === "intra") { f = 60 / 5; per = "hr"; }
  else if (cfg.kind === "intra5") {
    const days = new Set(points.map((p) => new Date(p.t).toISOString().slice(0, 10))).size || 1;
    f = n / days; per = "day";
  } else if (cfg.kind === "weekly") per = "wk";

  const vel = vs.map((z) => z * f);
  const acc = as.map((z) => z * f * f);
  const u = type === "yld" ? "bp" : "%";
  const vNow = vel.at(-1), aNow = acc.at(-1);
  const sv = std(vel) || 1e-9, sa = std(acc) || 1e-9;

  let regime, tone;
  const flat = Math.abs(vNow) < 0.15 * sv;
  const aUp = aNow > 0.1 * sa, aDn = aNow < -0.1 * sa;
  if (flat) { regime = aUp ? "Flat, turning up" : aDn ? "Flat, turning down" : "Flat, no momentum"; tone = aUp ? "up" : aDn ? "dn" : "flat"; }
  else if (vNow > 0) { regime = aUp ? "Accelerating higher" : aDn ? "Rising, but slowing" : "Rising steadily"; tone = "up"; }
  else { regime = aDn ? "Accelerating lower" : aUp ? "Falling, but losing steam" : "Falling steadily"; tone = "dn"; }

  // last time velocity changed sign (momentum turning point)
  let turn = null;
  for (let i = vel.length - 1; i > 0; i--) {
    if (Math.sign(vel[i]) !== Math.sign(vel[i - 1]) && vel[i] !== 0) { turn = { t: points[i].t, dir: vel[i] > 0 ? "up" : "down" }; break; }
  }

  return {
    vel, acc, vNow, aNow,
    velPct: percentile(vel, vNow),
    accPct: percentile(acc, aNow),
    unitVel: `${u}/${per}`,
    unitAcc: `${u}/${per}²`,
    smooth: w,
    regime, tone, turn
  };
}

/** Largest moves in the range, for news attribution. Returned in time order. */
function bigMoves(points, cfg, type, meta = {}) {
  const off = meta.gmtoffset || 0;
  let cands = [];
  if (cfg.kind === "intra") {
    // non-overlapping 30-minute windows
    const step = 6;
    const base = meta.prevClose;
    if (base && points.length) {
      const r = type === "yld" ? (points[0].c - base) * 100 : Math.log(points[0].c / base) * 100;
      cands.push({ t: points[0].t - 5 * 60e3, end: points[0].t, ret: r, label: "open", gap: true });
    }
    for (let i = 0; i + step < points.length; i += step) {
      const a = points[i], b = points[i + step];
      cands.push({ t: a.t, end: b.t, ret: type === "yld" ? (b.c - a.c) * 100 : Math.log(b.c / a.c) * 100 });
    }
  } else if (cfg.kind === "intra5") {
    const days = new Map();
    for (const p of points) days.set(localDay(p.t, off), p); // last bar of each day
    const list = [...days.entries()];
    let prev = meta.prevClose ?? null;
    for (const [day, p] of list) {
      if (prev != null) {
        const first = points.find((q) => localDay(q.t, off) === day);
        cands.push({ t: first.t, end: p.t, day, ret: type === "yld" ? (p.c - prev) * 100 : Math.log(p.c / prev) * 100 });
      }
      prev = p.c;
    }
  } else {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      cands.push({
        t: b.t, end: b.t, day: localDay(b.t, off),
        start: cfg.kind === "weekly" ? localDay(a.t, off) : undefined,
        ret: type === "yld" ? (b.c - a.c) * 100 : Math.log(b.c / a.c) * 100
      });
    }
  }
  if (!cands.length) return [];
  const sd = std(cands.map((c) => c.ret)) || 1e-9;
  for (const c of cands) c.z = c.ret / sd;
  const picked = [...cands].sort((x, y) => Math.abs(y.ret) - Math.abs(x.ret)).slice(0, cfg.moves);
  return picked.sort((x, y) => x.t - y.t).map((c, i) => ({ ...c, n: i + 1, day: c.day || localDay(c.t, off) }));
}

/** Share of the range's total change explained by the picked big moves. */
function moveContribution(moves, st, type) {
  if (!st || !moves.length) return null;
  const total = type === "yld" ? st.chg * 100 : st.pct; // same figure as the header
  const fromMoves = moves.reduce((s, m) => s + m.ret, 0);
  return { total, fromMoves };
}

function analyze(json, rangeKey, type) {
  const cfg = RANGES[rangeKey] || RANGES["1M"];
  const { points, meta } = fromYahoo(json);
  const st = stats(points, cfg, type, meta);
  const mom = momentum(points, cfg, type);
  const moves = bigMoves(points, cfg, type, meta);
  return { range: rangeKey, cfg, points, meta, stats: st, momentum: mom, moves, contribution: moveContribution(moves, st, type) };
}

module.exports = { RANGES, analyze, fromYahoo, stats, momentum, bigMoves, ema, std, percentile, localDay };
