// Pick factors for an event model by forward selection on cross-validated AUC, then tune shrinkage
// on cross-validated Brier score. Used to build the risk monitors in src/monitors.js.
// Usage: node scripts/select-factors.js [eventId ...]     (no ids = all events)
//        node scripts/select-factors.js --compare inflation m2 m2,oil12 m2,cpi12   (score fixed sets)
//
// Cross-validation: the months are split into 6 consecutive blocks; each block is predicted by a model
// fitted on the other blocks, leaving out h months on each side so no outcome window crosses the split.
const os = require("os"), path = require("path");
const H = {};
require("../src/graphs").register({ ipcMain: { handle: (c, f) => (H[c] = f) }, file: (n) => path.join(os.tmpdir(), "tk-select-" + n), readJSON: (n, d) => d, writeJSON: () => {}, get: () => ({ watch: [] }) });
const R = require("../src/regress"), F = require("../src/factor");

// candidate factors: [id, key, transform, label]. Only ones with an economic reason to lead events, and
// enough history (roughly 1980s or earlier).
const POOL = [
  ["curve", "fred:T10Y3M", "level", "Yield curve (10y minus 3m)"], ["curve2", "fred:T10Y2Y", "level", "Yield curve (10y minus 2y)"],
  ["curve12", "fred:T10Y3M", "chg12", "Yield curve, 12-mo change"], ["baa", "fred:BAA10Y", "level", "Corporate bond spread (Baa)"],
  ["baa6", "fred:BAA10Y", "chg6", "Corporate bond spread, 6-mo change"], ["nfci", "fred:NFCI", "level", "Financial conditions (Chicago Fed)"],
  ["nfci6", "fred:NFCI", "chg6", "Financial conditions, 6-mo change"], ["unemp", "fred:UNRATE", "level", "Unemployment rate"],
  ["unemp12", "fred:UNRATE", "chg12", "Unemployment rate, 12-mo change"], ["claims6", "fred:ICSA", "pct6", "Jobless claims, 6-mo % change"],
  ["permit12", "fred:PERMIT", "pct12", "Building permits, 12-mo % change"], ["sent", "fred:UMCSENT", "level", "Consumer sentiment"],
  ["sent12", "fred:UMCSENT", "chg12", "Consumer sentiment, 12-mo change"], ["ff", "fred:DFF", "level", "Fed funds rate"],
  ["fed12", "fred:DFF", "chg12", "Fed funds rate, 12-mo change"], ["fed6", "fred:DFF", "chg6", "Fed funds rate, 6-mo change"],
  ["spx6", "yahoo:^GSPC", "pct6", "S&P 500, 6-mo % change"], ["spx12", "yahoo:^GSPC", "pct12", "S&P 500, 12-mo % change"],
  ["vix", "yahoo:^VIX", "level", "VIX"], ["indpro12", "fred:INDPRO", "pct12", "Industrial production, 12-mo % change"],
  ["oil12", "fred:WTISPLC", "pct12", "Oil price, 12-mo % change"], ["cpi12", "fred:CPIAUCSL", "pct12", "CPI inflation (12-mo)"],
  ["cpi3", "fred:CPIAUCSL", "pct3", "CPI, 3-mo % change"], ["m2", "fred:M2SL", "pct12", "M2 money supply, 12-mo % change"],
  ["wages", "fred:AHETPI", "pct12", "Hourly earnings, 12-mo % change"]
];

const EVENTS = {
  recession: { target: ["fred:USREC", "level"], c: { cond: "above", x: 0.5, h: 12, when: "within", unit: "pts", onlyNew: true } },
  correction: { target: ["yahoo:^GSPC", "level"], c: { cond: "fall", x: 10, h: 6, when: "within", unit: "pct" } },
  bear: { target: ["yahoo:^GSPC", "level"], c: { cond: "fall", x: 20, h: 12, when: "within", unit: "pct" } },
  credit: { target: ["fred:BAA10Y", "level"], c: { cond: "rise", x: 1, h: 6, when: "within", unit: "pts" } },
  inflation: { target: ["fred:CPIAUCSL", "yoy"], c: { cond: "rise", x: 1, h: 12, when: "within", unit: "pts" } },
  jobs: { target: ["fred:UNRATE", "level"], c: { cond: "rise", x: 0.5, h: 12, when: "within", unit: "pts" } },
  cuts: { target: ["fred:DFF", "level"], c: { cond: "fall", x: 1, h: 12, when: "within", unit: "pts" } }
};

const std = (X) => {
  const k = X[0].length, mu = [], sd = [];
  for (let j = 0; j < k; j++) { const v = X.map((r) => r[j]), m = v.reduce((a, b) => a + b, 0) / v.length; mu.push(m); sd.push(Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1); }
  return { z: (r) => r.map((v, j) => (v - mu[j]) / sd[j]) };
};
function crossValidate(d, h, ridge) {
  const n = d.y.length, B = 6, pred = new Array(n).fill(null);
  for (let b = 0; b < B; b++) {
    const lo = Math.floor((n * b) / B), hi = Math.floor((n * (b + 1)) / B);
    const tr = [...Array(n).keys()].filter((i) => i < lo - h || i >= hi + h);
    const ys = tr.map((i) => d.y[i]);
    if (!ys.some(Boolean) || ys.every(Boolean)) return null;
    const s = std(tr.map((i) => d.X[i]));
    let f; try { f = F.logit(tr.map((i) => s.z(d.X[i])), ys, { ridge }); } catch { return null; }
    for (let i = lo; i < hi; i++) pred[i] = f.prob(s.z(d.X[i]));
  }
  return { auc: F.auc(pred, d.y), brier: F.brier(pred, d.y), pred };
}

async function run(id) {
  const ev = EVENTS[id], h = ev.c.h;
  const S = {};
  for (const k of [...new Set([ev.target[0], ...POOL.map((p) => p[1])])]) { const r = await H["graphs:series"](null, k); if (!r.error) S[k] = r.points; }
  let trow = R.resample(S[ev.target[0]], "M");
  if (ev.target[1] === "yoy") trow = R.shape(trow, "pct12", 0, "M");
  const labels = F.labelCase(trow, ev.c);
  const build = (ids) => {
    const list = ids.map((x) => { const p = POOL.find((q) => q[0] === x); return { name: x, points: S[p[1]], transform: p[2], lag: 0 }; });
    if (list.some((l) => !l.points)) return null;
    const a = R.alignSeries(list, "M"), months = a.periods.filter((p) => labels.has(p));
    return { months, X: months.map((p) => { const i = a.periods.indexOf(p); return ids.map((x) => a.cols[x][i]); }), y: months.map((p) => labels.get(p)) };
  };
  const score = (ids, ridge = 1e-4) => { const d = build(ids); if (!d || d.y.length < 180) return null; const ev2 = d.y.reduce((a, b) => a + b, 0); if (ev2 < 20) return null; const r = crossValidate(d, h, ridge); return r && { ids, ...r, d, n: d.y.length, events: ev2, from: d.months[0] }; };

  console.log(`\n=== ${id}: ${F.describeCase(ev.c, ev.target[0])}`);
  let cur = [], best = null;
  for (let step = 0; step < 4; step++) {
    let cand = null;
    for (const p of POOL) {
      if (cur.includes(p[0]) || cur.some((c) => POOL.find((q) => q[0] === c)[1] === p[1])) continue; // one transform per series
      const r = score([...cur, p[0]]);
      if (r && r.auc != null && (!cand || r.auc > cand.auc)) cand = r;
    }
    if (!cand || (best && cand.auc < best.auc + 0.01)) break;
    best = cand; cur = cand.ids;
    console.log(`  + ${cur[cur.length - 1].padEnd(9)} CV AUC ${cand.auc.toFixed(3)}  (n ${cand.n} from ${cand.from}, ${cand.events} case months)`);
  }
  if (!best) { console.log("  nothing usable"); return null; }
  const base = best.events / best.n, brierBase = base * (1 - base);
  let tuned = null;
  for (const ridge of [1, 2, 5, 10, 20, 40]) { const r = crossValidate(best.d, h, ridge); if (r && (!tuned || r.brier < tuned.brier)) tuned = { ridge, ...r }; }
  const s = std(best.d.X), f = F.logit(best.d.X.map(s.z), best.d.y, { ridge: tuned.ridge });
  console.log(`  shrinkage ${tuned.ridge}: CV AUC ${tuned.auc.toFixed(3)}, CV Brier ${tuned.brier.toFixed(4)} vs base rate ${brierBase.toFixed(4)} (skill ${((1 - tuned.brier / brierBase) * 100).toFixed(0)}%) · base rate ${(base * 100).toFixed(0)}%`);
  console.log(`  odds × per SD: ${best.ids.map((x, j) => `${x} ${Math.exp(f.b[j + 1]).toFixed(2)}`).join(", ")}`);
  return { id, ids: best.ids, ridge: tuned.ridge, cvAuc: tuned.auc, cvBrier: tuned.brier, brierBase, base, n: best.n, from: best.from };
}

async function compare(id, sets) {
  // score fixed factor sets on the same event (for checking a hand-picked model)
  const ev = EVENTS[id], h = ev.c.h, S = {};
  for (const k of [...new Set([ev.target[0], ...POOL.map((p) => p[1])])]) { const r = await H["graphs:series"](null, k); if (!r.error) S[k] = r.points; }
  let trow = R.resample(S[ev.target[0]], "M"); if (ev.target[1] === "yoy") trow = R.shape(trow, "pct12", 0, "M");
  const labels = F.labelCase(trow, ev.c);
  for (const ids of sets) {
    const list = ids.map((x) => { const p = POOL.find((q) => q[0] === x); return { name: x, points: S[p[1]], transform: p[2], lag: 0 }; });
    const a = R.alignSeries(list, "M"), months = a.periods.filter((p) => labels.has(p));
    const d = { X: months.map((p) => { const i = a.periods.indexOf(p); return ids.map((x) => a.cols[x][i]); }), y: months.map((p) => labels.get(p)) };
    const base = d.y.reduce((x, y) => x + y, 0) / d.y.length;
    for (const ridge of [5, 20]) { const r = crossValidate(d, h, ridge); console.log(`  ${ids.join("+").padEnd(28)} ridge ${String(ridge).padEnd(3)} n ${d.y.length} from ${months[0]}  CV AUC ${r.auc.toFixed(3)}  skill ${((1 - r.brier / (base * (1 - base))) * 100).toFixed(0)}%`); }
  }
}

(async () => {
  if (process.argv[2] === "--compare") { await compare(process.argv[3], process.argv.slice(4).map((s) => s.split(","))); return; }
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(EVENTS);
  const out = [];
  for (const id of ids) out.push(await run(id));
  console.log("\nJSON " + JSON.stringify(out.filter(Boolean)));
})();
