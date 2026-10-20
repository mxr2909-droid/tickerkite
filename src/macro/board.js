// Decile board: ranks each indicator's latest reading against its own history. No I/O, and no
// require(): the renderer loads this file with a <script> tag (window.WireBoardMath) and node/tests
// require() it.
//
// Each indicator's series is cut to one reading per month (the last of the month), so daily and
// monthly data rank against comparable histories. As of a date, the reading is the last month at
// or before it; it ranks against every monthly reading from the range start up to it. The
// percentile is flipped for indicators where lower is better, so D10 is always the best tenth of
// history for the economy and D1 the worst.
(function (root) {
  const DAY = 864e5, YEAR = 365.25 * DAY;
  const STALE_DAYS = { d: 10, w: 21, m: 120, q: 230 }; // same as score.js
  const DROP_DAYS = 400; // older than this, a tile is shown but left out of the group scores

  // Whether more of each scoring factor is good (+1) or bad (−1) for the economy. An indicator's
  // direction is its sign (does a higher reading mean more of the factor?) times this.
  const GOOD = {
    growth: 1, inflation: -1, labor: 1, yields: -1, fed: 1, credit: 1, conditions: 1,
    dollar: -1, stress: -1, consumer: 1, global: 1
  };
  /** +1 if a higher reading is better for the economy, −1 if lower is better. */
  const direction = (def) => (def.good != null ? def.good : (def.sign || 1) * (def.factor?.startsWith("trend_") ? 1 : GOOD[def.factor] ?? 1));

  /** Last observation of each UTC month, oldest first. */
  function toMonthly(s) {
    const out = [];
    let key = null;
    for (const p of s || []) {
      const d = new Date(p[0]), k = d.getUTCFullYear() * 12 + d.getUTCMonth();
      if (k === key) out[out.length - 1] = p; else { out.push(p); key = k; }
    }
    return out;
  }

  /** Index of the last point at or before t, or −1. */
  function idxAt(s, t) {
    let lo = 0, hi = s.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m][0] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  /** Share of values below x, ties counting half (0..1). */
  function pctile(vals, x) {
    if (!vals.length) return 0.5;
    let below = 0, eq = 0;
    for (const v of vals) { if (v < x) below++; else if (v === x) eq++; }
    return (below + eq / 2) / vals.length;
  }

  /** 0..1 "goodness" percentile → decile 1..10 (D10 = best tenth). */
  const decile = (g) => Math.min(10, Math.max(1, Math.floor(g * 10) + 1));

  /**
   * One indicator as of a date, ranked against its readings from `from` to `asOf`.
   * @param s    monthly series [[t, v], …] oldest first
   * @param def  indicator definition (sign, factor, freq)
   * @returns null if there's no reading at or before asOf
   */
  function rank(s, def, { from = -Infinity, asOf = Infinity } = {}) {
    const i = idxAt(s || [], asOf);
    if (i < 0) return null;
    const [t, v] = s[i];
    const vals = [];
    let since = null;
    for (let j = 0; j <= i; j++) if (s[j][0] >= from) { vals.push(s[j][1]); if (since == null) since = s[j][0]; }
    if (!vals.length) { vals.push(v); since = t; } // range starts after the latest reading: rank it alone
    const dir = direction(def);
    const pct = pctile(vals, v), good = dir > 0 ? pct : 1 - pct;
    const ya = idxAt(s, t - 360 * DAY);
    const age = (Math.min(asOf, Date.now()) - t) / DAY;
    return {
      t, v, n: vals.length, since, dir, pct, good, decile: decile(good), score: Math.round(good * 100),
      prior: i > 0 ? s[i - 1] : null,
      yearAgo: ya >= 0 && ya < i ? s[ya] : null,
      stale: age > (STALE_DAYS[def.freq] || 120) + 31, // + a month: readings are month-ends
      dropped: age > DROP_DAYS
    };
  }

  /**
   * The whole board as of a date.
   * @param defs     indicator definitions
   * @param series   { id: monthly series }
   * @param sections [[key, label], …] column order
   * @returns { tiles: {id: rank()}, groups: {section: 0–100 | null}, overall: 0–100 | null }
   */
  function board(defs, series, sections, opts = {}) {
    const tiles = {}, groups = {};
    for (const d of defs) tiles[d.id] = rank(series[d.id], d, opts);
    for (const [k] of sections) {
      const live = defs.filter((d) => d.section === k && tiles[d.id] && !tiles[d.id].dropped);
      groups[k] = live.length ? Math.round(live.reduce((x, d) => x + tiles[d.id].good, 0) / live.length * 100) : null;
    }
    const gs = Object.values(groups).filter((g) => g != null);
    return { tiles, groups, overall: gs.length ? Math.round(gs.reduce((x, g) => x + g, 0) / gs.length) : null };
  }

  /** Range start for a lookback button: `years` before asOf, or the first data (`start`) for "ALL". */
  const rangeFrom = (years, asOf, start) => (years === "all" || years == null ? start : Math.max(start, asOf - years * YEAR));

  const api = { GOOD, direction, toMonthly, idxAt, pctile, decile, rank, board, rangeFrom, YEAR };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WireBoardMath = api;
})(typeof window !== "undefined" ? window : globalThis);
