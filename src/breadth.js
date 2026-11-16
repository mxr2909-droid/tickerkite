// Market breadth and map replay arithmetic over the sector map's daily-history store (src/sectormap.js keeps
// the store; renderer/markets.js draws the breadth ribbon, renderer/map.js the replay). Plain functions, no I/O
// and no require(): the renderer loads this file with a <script> tag (window.TkBreadth), node and the tests require() it.
//
// The store: one calendar of trading days (yyyymmdd numbers) and, per company, a close for each day or null.
// Per day, over any set of companies:
//   up     share that rose that day (of those with a move that day)
//   above  share closing above their own 50-day average
//   hl     new 20-day highs minus new 20-day lows, as a share of companies
//   ew/cw  an equal-weight index (the average daily move, compounded) and a cap-weighted one; the gap between
//          them says whether the average stock is keeping up with the biggest ones.
(function (root) {
  const SMA = 50, SMA_MIN = 40;       // 50-day average; needs 40 of the 50 days
  const HL = 20, HL_MIN = 15;         // new 20-day high or low; needs 15 of the 19 days before
  const CLOSE_MIN = 16 * 60 + 20;     // "after the US close": 4:20 pm New York, once the closing prints settle
  const SPANS = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252 }; // trading days

  /** Round to 4 significant digits (null for a missing or bad number): keeps the cache and the IPC payload small. */
  const sig = (v) => (v == null || !Number.isFinite(+v) || +v <= 0 ? null : +(+v).toPrecision(4));
  /** yyyymmdd of a bar's time. Bars are stamped in the exchange's own time (barsFromChart adds the offset), so UTC fields are New York's. */
  const ymdOf = (t) => { const d = new Date(t); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };

  /** The last weekday whose US session has closed by `now` (yyyymmdd). Holidays aren't known: on one, the day before counts as open. */
  function lastCloseYmd(now = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(now).map((x) => [x.type, x.value]));
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
    for (let back = wd >= 1 && wd <= 5 && +p.hour * 60 + +p.minute >= CLOSE_MIN ? 0 : 1; ; back++) {
      const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day - back)), w = d.getUTCDay();
      if (w >= 1 && w <= 5) return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    }
  }
  /** Is the store missing or older than the latest close? (So it is downloaded at most once a day, after the close.) */
  const historyDue = (store, now = new Date()) => !store?.dates?.length || !(store.asOf >= lastCloseYmd(now));

  /** Daily bars per symbol → { dates, closes: { SYM: [close|null] } } on one calendar: the last `days` trading days
   *  up to `asOf` of `calBars` (SPY), or of the most complete symbol when those are missing. A day still trading
   *  (after asOf) is left out. Symbols with closes on fewer than 20 of the days (or half, for a short calendar) are skipped. */
  function buildHistory(barsBySym, calBars, days, asOf) {
    const byDay = (bars) => { const m = new Map(); for (const b of bars || []) { const d = ymdOf(b.t); if (d <= asOf && b.close > 0) m.set(d, b.close); } return m; };
    const maps = {};
    for (const [s, bars] of Object.entries(barsBySym || {})) if (bars?.length) maps[s] = byDay(bars);
    let cal = calBars?.length ? [...byDay(calBars).keys()] : [];
    const most = Object.values(maps).reduce((a, m) => Math.max(a, m.size), 0);
    if (cal.length < most * 0.9) cal = [...(Object.values(maps).find((m) => m.size === most)?.keys() || [])];
    const dates = cal.sort((a, b) => a - b).slice(-days), closes = {}, min = Math.min(20, Math.ceil(dates.length / 2));
    for (const [s, m] of Object.entries(maps)) {
      const row = dates.map((d) => sig(m.get(d)));
      if (row.filter((v) => v != null).length >= min) closes[s] = row;
    }
    return { dates, closes };
  }

  /** Per-company series the breadth and the replay need, computed once per store.
   *  rows: closes arrays on the calendar (null = no close). Returns { days, rows: [{ c, r, a50, hl, last }] } where
   *  c = closes (NaN missing), r = daily return (NaN unless both days have a close), a50 = 1 above / 0 below its
   *  50-day average / −1 not enough history, hl = 1 new 20-day high / −1 new low / 0 neither / −2 not enough history,
   *  last = the latest close (to scale today's market cap back in time). */
  function prepare(rows, days) {
    const n = days ?? Math.max(0, ...rows.map((r) => r?.length || 0));
    return { days: n, rows: rows.map((src) => {
      const c = new Float64Array(n).fill(NaN), r = new Float64Array(n).fill(NaN), a50 = new Int8Array(n).fill(-1), hl = new Int8Array(n).fill(-2);
      for (let i = 0; i < n; i++) { const v = src?.[i]; if (v > 0) c[i] = v; }
      let sum = 0, cnt = 0, last = NaN;
      for (let i = 0; i < n; i++) {
        const v = c[i];
        if (v === v) { sum += v; cnt++; last = v; }
        if (i >= SMA) { const o = c[i - SMA]; if (o === o) { sum -= o; cnt--; } }
        if (v !== v) continue;
        if (i > 0 && c[i - 1] === c[i - 1]) r[i] = v / c[i - 1] - 1;
        if (cnt >= SMA_MIN) a50[i] = v > sum / cnt ? 1 : 0;
        let hi = -Infinity, lo = Infinity, k = 0;
        for (let j = Math.max(0, i - HL + 1); j < i; j++) { const x = c[j]; if (x === x) { k++; if (x > hi) hi = x; if (x < lo) lo = x; } }
        if (k >= HL_MIN) hl[i] = v > hi ? 1 : v < lo ? -1 : 0;
      }
      return { c, r, a50, hl, last };
    }) };
  }

  /** Breadth per day over the companies `idx` (indices into P.rows) with today's market caps `caps` (same order).
   *  A day counts only when at least half the companies (and 3) have a reading. The cap-weighted index weights each
   *  company by its cap on the day before: today's cap × that day's close ÷ the latest close. */
  function breadth(P, idx, caps) {
    const n = P.days, need = Math.max(3, Math.ceil(idx.length * 0.5));
    const out = { up: new Array(n).fill(null), above: new Array(n).fill(null), hl: new Array(n).fill(null), ew: new Array(n).fill(1), cw: new Array(n).fill(1), n: idx.length };
    const rows = idx.map((i) => P.rows[i]), w = rows.map((row, j) => (caps?.[j] > 0 && row.last > 0 ? caps[j] / row.last : 0));
    for (let i = 0; i < n; i++) {
      let rose = 0, moved = 0, sr = 0, ab = 0, abn = 0, hi = 0, lo = 0, hln = 0, cwN = 0, cwD = 0;
      for (let j = 0; j < rows.length; j++) {
        const row = rows[j], ret = row.r[i];
        if (ret === ret) { moved++; sr += ret; if (ret > 0) rose++; const prev = row.c[i - 1] * w[j]; if (prev > 0) { cwN += prev * ret; cwD += prev; } }
        const a = row.a50[i]; if (a >= 0) { abn++; ab += a; }
        const h = row.hl[i]; if (h > -2) { hln++; if (h === 1) hi++; else if (h === -1) lo++; }
      }
      if (moved >= need) out.up[i] = rose / moved;
      if (abn >= need) out.above[i] = ab / abn;
      if (hln >= need) out.hl[i] = (hi - lo) / hln;
      const prevE = i ? out.ew[i - 1] : 1, prevC = i ? out.cw[i - 1] : 1;
      out.ew[i] = moved >= need ? prevE * (1 + sr / moved) : prevE;
      out.cw[i] = cwD > 0 && moved >= need ? prevC * (1 + cwN / cwD) : prevC;
    }
    return out;
  }

  /** Trailing average over `k` entries, skipping nulls; null until half the window has values. */
  function smooth(a, k) {
    const out = new Array(a.length).fill(null);
    let sum = 0, cnt = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] != null) { sum += a[i]; cnt++; }
      if (i >= k && a[i - k] != null) { sum -= a[i - k]; cnt--; }
      if (cnt >= Math.ceil(k / 2)) out[i] = sum / cnt;
    }
    return out;
  }

  /** Equal-weight minus cap-weight return since day `s`, in percentage points (null before s). */
  const gapSeries = (ew, cw, s) => ew.map((e, i) => (i < s ? null : ((e / ew[s]) - (cw[i] / cw[s])) * 100));

  /** First day of a span ("3M") counted back from the last day; the span's returns are measured from its close. */
  const spanStart = (days, span) => Math.max(0, days - 1 - (SPANS[span] || SPANS["1Y"]));

  /** The latest readings and the ones a month (21 trading days) earlier, for the reading and the stat tiles. */
  function summarize(b, s, ago = 21) {
    let i = b.up.length - 1;
    while (i > 0 && b.up[i] == null) i--;
    const j = Math.max(0, i - ago), up10 = smooth(b.up, 10);
    return { i, up: b.up[i], upAgo: b.up[j], above: b.above[i], aboveAgo: b.above[j], hl: b.hl[i], hlAgo: b.hl[j], up10: up10[i],
      gap: ((b.ew[i] / b.ew[s]) - (b.cw[i] / b.cw[s])) * 100, ewRet: (b.ew[i] / b.ew[s] - 1) * 100, cwRet: (b.cw[i] / b.cw[s] - 1) * 100 };
  }

  /** A plain-English reading of summarize()'s numbers. scope: "" or a sector name; span: "3 months". */
  function readingText(m, span, scope = "") {
    const p = (v) => `${Math.round(v * 100)}%`, who = scope ? `${scope} companies` : "companies", out = [];
    if (m.above != null) {
      const d = m.aboveAgo == null ? null : Math.round(m.above * 100) - Math.round(m.aboveAgo * 100);
      out.push(`${p(m.above)} of ${who} are above their 50-day average${d == null ? "." : d === 0 ? ", the same as a month ago." : `, ${d > 0 ? "up" : "down"} from ${p(m.aboveAgo)} a month ago.`}`);
    }
    if (Number.isFinite(m.gap)) {
      const g = Math.abs(m.gap).toFixed(1), idx = scope ? `the ${scope} total` : "the index";
      out.push(Math.abs(m.gap) < 1
        ? `The average stock is within a point of ${idx} over ${span}: big and small companies are moving together.`
        : m.gap < 0
          ? `The average stock is ${g} points behind ${idx} over ${span}: ${m.cwRet >= 0 ? "the gains are concentrated in the biggest companies." : "the smaller companies are falling harder than the biggest."}`
          : `The average stock is ${g} points ahead of ${idx} over ${span}: ${m.cwRet >= 0 ? "the rise is broad, not just the biggest names." : "the losses are concentrated in the biggest companies."}`);
    }
    if (m.up10 != null) {
      const v = m.up10, word = v >= 0.6 ? "a strong, broad run" : v >= 0.53 ? "more risers than fallers" : v > 0.47 ? "an even split" : v > 0.4 ? "more fallers than risers" : "a broad sell-off";
      out.push(`Over the last 10 trading days ${p(v)} of ${who} rose on a typical day: ${word}.`);
    }
    return out.join(" ");
  }

  // ---------- replay ----------
  /** Colors for the map replay over days s+1 … e, computed once. groups: per sector, its companies on the map
   *  [{ row (index into P.rows, or −1), cap }]. Returns { len, firm: [[{ day, cum }]], sec: [{ day, cum }] } of
   *  Float32Arrays in % (NaN = no data): day = that day's return; cum = the return since the close of day s.
   *  A sector is cap-weighted: by today's caps on a day, by caps scaled back to day s for "since the start". */
  function replayFrames(P, groups, s, e) {
    const len = Math.max(0, e - s), F = () => new Float32Array(len).fill(NaN);
    const firm = groups.map((g) => g.map(({ row }) => {
      const R = P.rows[row], day = F(), cum = F();
      if (!R) return { day, cum, base: NaN, ff: null };
      let base = NaN;
      for (let i = s; i >= 0 && base !== base; i--) base = R.c[i];
      for (let i = s + 1; i <= e && base !== base; i++) base = R.c[i];
      const ff = new Float64Array(len).fill(NaN); // closes carried over days without one
      let cur = R.c[s];
      for (let k = 0; k < len; k++) {
        const i = s + 1 + k;
        if (R.c[i] === R.c[i]) cur = R.c[i];
        ff[k] = cur;
        if (R.r[i] === R.r[i]) day[k] = R.r[i] * 100;
        if (base > 0 && cur === cur) cum[k] = (cur / base - 1) * 100;
      }
      return { day, cum, base, ff, last: R.last };
    }));
    const sec = groups.map((g, gi) => {
      const day = F(), cum = F();
      for (let k = 0; k < len; k++) {
        let dn = 0, dd = 0, cn = 0, cd = 0;
        g.forEach(({ cap }, j) => {
          const f = firm[gi][j];
          if (!(cap > 0)) return;
          const r = f.day[k]; if (r === r) { dn += cap * r; dd += cap; }
          if (f.base > 0 && f.ff && f.ff[k] === f.ff[k] && f.last > 0) { const sh = cap / f.last; cn += sh * f.ff[k]; cd += sh * f.base; }
        });
        if (dd > 0) day[k] = dn / dd;
        if (cd > 0) cum[k] = (cn / cd - 1) * 100;
      }
      return { day, cum };
    });
    for (const g of firm) for (const f of g) { delete f.ff; delete f.base; delete f.last; }
    return { len, firm, sec };
  }

  /** Equal-weight index of the companies `idx` over days s+1 … e: the average daily move compounded, in % since day s. */
  function ewPath(P, idx, s, e) {
    const len = Math.max(0, e - s), out = new Float32Array(len);
    let lvl = 1;
    for (let k = 0; k < len; k++) {
      let sum = 0, n = 0;
      for (const i of idx) { const r = P.rows[i]?.r[s + 1 + k]; if (r === r && r != null) { sum += r; n++; } }
      if (n) lvl *= 1 + sum / n;
      out[k] = (lvl - 1) * 100;
    }
    return out;
  }

  const api = { SMA, HL, SPANS, sig, ymdOf, lastCloseYmd, historyDue, buildHistory, prepare, breadth, smooth, gapSeries, spanStart, summarize, readingText, replayFrames, ewPath };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TkBreadth = api;
})(typeof window !== "undefined" ? window : globalThis);
