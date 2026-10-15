// Backtest: score every month since 2007 and compare with each asset's return over the next 12 months.
// Usage: node scripts/backtest.js [--cache file.json]
// Uses today's revised data, so it's a sanity check of the logic, not a record of live calls.
const fs = require("fs");
const { fetchAllSeries } = require("../src/macro/data");
const { fetchText } = require("../src/news/fetcher");
const S = require("../src/macro/score");
const W = require("../src/macro/weights");
const { INDICATORS } = require("../src/macro/indicators");

const DAY = 864e5;
// total-return proxies (adjusted closes include dividends and coupons)
const PROXY = { stocks: "SPY", bonds: "IEF", commodities: "DBC", realestate: "VNQ", crypto: "BTC-USD", alts: "GLD" };

async function adjCloses(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=max&interval=1mo`;
  const r = JSON.parse(await fetchText(url, 30000)).chart.result[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose || r.indicators.quote[0].close;
  return r.timestamp.map((t, i) => [t * 1000, adj[i]]).filter(([, v]) => v != null);
}

const corr = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
const rank = (xs) => { const s = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = []; s.forEach(([, i], k) => (r[i] = k)); return r; };
const spearman = (xs, ys) => corr(rank(xs), rank(ys));
const pct = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";

(async () => {
  const cacheArg = process.argv.indexOf("--cache");
  const cacheFile = cacheArg > 0 ? process.argv[cacheArg + 1] : null;
  let raw;
  if (cacheFile && fs.existsSync(cacheFile)) raw = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  else {
    raw = await fetchAllSeries({}, { years: 30 });
    if (Object.keys(raw.errors).length) console.error("failed:", raw.errors);
    if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(raw));
  }
  const prices = {};
  for (const [a, sym] of Object.entries(PROXY)) prices[a] = await adjCloses(sym);
  const fwd = (a, t) => {
    const p = prices[a], p0 = S.valueAt(p, t), p1 = S.valueAt(p, t + 365 * DAY);
    if (p0 == null || p1 == null || t + 365 * DAY > Date.now() || S.idxAt(p, t) < 0 || p[0][0] > t - 20 * DAY) return null;
    return p1 / p0 - 1;
  };

  const prepared = S.prepare(INDICATORS, raw.series);
  const variants = {
    "fixed weights": S.mergeWeights(W, { ...W, inflationary: {} }),
    "inflation-aware": S.mergeWeights(W, W),
    // experiment: extreme fear and wide spreads have been buying opportunities over 12 months,
    // so score the level of stress, credit and sentiment as contrarian and keep the trend as-is
    "contrarian extremes": S.mergeWeights(W, {
      ...W,
      assets: {
        ...W.assets,
        stocks: { ...W.assets.stocks, stress: { level: 1, trend: -2 }, credit: { level: -1, trend: 2 }, consumer: { level: -0.5, trend: 1 } },
        realestate: { ...W.assets.realestate, stress: { level: 0.5, trend: -1 }, credit: { level: -0.5, trend: 1 } },
        crypto: { ...W.assets.crypto, stress: { level: 1, trend: -2 }, credit: { level: -0.5, trend: 1 } },
        commodities: { ...W.assets.commodities, stress: { level: 0.5, trend: -1 } }
      }
    })
  };
  const dates = [];
  for (let y = 2007; y <= 2026; y++) for (let m = 0; m < 12; m++) { const t = Date.UTC(y, m, 28); if (t < Date.now() - 5 * DAY) dates.push(t); }

  const runs = {};
  for (const [name, w] of Object.entries(variants)) runs[name] = dates.map((t) => ({ t, e: S.evaluate(INDICATORS, prepared, w, t) }));

  for (const [name, rows] of Object.entries(runs)) {
    console.log(`\n=== ${name} ===`);
    console.log("asset        months  corr  rank-corr   avg 12m return when score ≥58 | 43–57 | ≤42");
    for (const a of Object.keys(PROXY)) {
      const pts = rows.map(({ t, e }) => [e.assets[a].score, fwd(a, t)]).filter(([, r]) => r != null);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const bucket = (f) => { const b = pts.filter(([s]) => f(s)); return b.length ? `${pct(b.reduce((x, p) => x + p[1], 0) / b.length)} (${b.length})` : "—"; };
      console.log(`${a.padEnd(12)} ${String(pts.length).padStart(6)}  ${corr(xs, ys).toFixed(2).padStart(5)}  ${spearman(xs, ys).toFixed(2).padStart(9)}   ${bucket((s) => s >= 58).padEnd(14)} | ${bucket((s) => s > 42 && s < 58).padEnd(14)} | ${bucket((s) => s <= 42)}`);
    }
    // relative: does ranking assets against each other pick next year's leaders?
    let hits = 0, tot = 0, topMinusBottom = 0;
    for (const { t, e } of rows) {
      const avail = Object.keys(PROXY).filter((a) => fwd(a, t) != null);
      if (avail.length < 4) continue;
      const by = [...avail].sort((x, y) => e.assets[y].score - e.assets[x].score);
      const r = (a) => fwd(a, t);
      topMinusBottom += r(by[0]) - r(by[by.length - 1]);
      const mean = avail.reduce((x, a) => x + r(a), 0) / avail.length;
      hits += r(by[0]) > mean ? 1 : 0; tot++;
    }
    console.log(`relative: top-ranked asset beat the average in ${hits}/${tot} months (${Math.round(hits / tot * 100)}%); top minus bottom averaged ${pct(topMinusBottom / tot)} a year`);
    // stock–bond: does the model call bonds over stocks at the right times?
    const sb = rows.map(({ t, e }) => [e.assets.bonds.score - e.assets.stocks.score, fwd("bonds", t), fwd("stocks", t)]).filter(([, b, s]) => b != null && s != null);
    console.log(`bonds-minus-stocks score vs bonds-minus-stocks return: corr ${corr(sb.map((x) => x[0]), sb.map((x) => x[1] - x[2])).toFixed(2)}`);
  }

  console.log("\n=== episodes (inflation-aware) ===");
  console.log("date      regime        infl-mode  stocks bonds(fixed) cmdty  RE  crypto alts | contrarian stocks | next-12m stocks bonds");
  for (const d of ["2007-10", "2008-06", "2008-11", "2009-03", "2011-08", "2015-08", "2018-12", "2020-02", "2020-04", "2021-06", "2021-12", "2022-06", "2022-10", "2023-10", "2024-10", "2025-10"]) {
    const t = Date.UTC(+d.slice(0, 4), +d.slice(5) - 1, 28);
    const e = S.evaluate(INDICATORS, prepared, variants["inflation-aware"], t);
    const f = S.evaluate(INDICATORS, prepared, variants["fixed weights"], t);
    const c = S.evaluate(INDICATORS, prepared, variants["contrarian extremes"], t);
    const sc = (a) => String(e.assets[a].score).padStart(5);
    const rs = (a) => { const r = fwd(a, t); return r == null ? "  n/a" : pct(r).padStart(7); };
    console.log(`${d}   ${e.regime.name.padEnd(12)} ${(e.mode.alpha * 100).toFixed(0).padStart(5)}%   ${sc("stocks")} ${sc("bonds")}${f.assets.bonds.score !== e.assets.bonds.score ? `(${f.assets.bonds.score})` : "    "}${sc("commodities")}${sc("realestate")}${sc("crypto")}${sc("alts")} | ${String(c.assets.stocks.score).padStart(10)}        |  ${rs("stocks")} ${rs("bonds")}`);
  }
})();
