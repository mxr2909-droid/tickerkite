/* Tickerkite FINTECH page. Registers with app.js through window.WirePages (see the "pages" section there).
   About seventy listed fintechs in eight sub-sectors (payments, lending, digital banks, brokerage, crypto, market
   infrastructure, financial software, insurtech): how they trade as a group against the S&P 500 and the financials
   sector, where the value sits, who leads and lags, the fintech deals from the M&A page and fintech headlines.
   src/fintech.js downloads caps and closes; renderer/fintechstats.js (window.TkFintechStats) does the arithmetic.
   One scrolling page split into regions that are only replaced when their HTML changed (snapshots arrive often while
   prices load), so a push that changes nothing redraws nothing. Charts are SVG drawn at the region's real width. */
(() => {
  const api = window.wire;
  const S = window.TkFintechStats;
  const T = window.TkTreemap;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAY = 864e5;
  const PERIODS = S?.PERIODS || ["1D", "1W", "1M", "3M", "YTD", "1Y", "3Y"];
  const WORDS = { "1D": "today", "1W": "over the past week", "1M": "over the past month", "3M": "over the past 3 months", YTD: "so far this year", "1Y": "over the past year", "3Y": "over the past 3 years" };
  const COLS = ["1D", "1M", "YTD", "1Y"]; // return columns in the sub-sector table (the chosen period is added if it isn't one)
  // a company moving ±SCALE % over the period is fully saturated on the treemap (as on the Sector map)
  const SCALE = { "1D": 3, "1W": 6, "1M": 12, "3M": 20, YTD: 35, "1Y": 50, "3Y": 80 };
  // one fixed color per sub-sector, used wherever sub-sectors are told apart by color (deal bars, dots, sparklines)
  const SUB_COL = { pay: "#5ec2f2", lend: "#f2b34a", bank: "#d9c27a", brok: "#8b93ff", cryp: "#f08a3c", infra: "#58d0c0", soft: "#b48cf2", ins: "#e88ac0" };
  const subCol = (id) => SUB_COL[id] || "#9aa6b6";
  // trend lines: the fintech index is the hero; benchmarks are quieter
  const LINE_COL = { cap: "var(--accent)", eq: "var(--accent)", SPY: "#c3cad4", XLF: "#f2b34a" };
  const ETF_COL = ["#58d0c0", "#e88ac0", "#b48cf2"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------- formatting ----------
  const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
  /** A percent change: two decimals under 10%, one under 100%, none above, so columns stay narrow. */
  const pct = (v) => {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    return `${sign(v)}${a < 10 ? a.toFixed(2) : a < 100 ? a.toFixed(1) : a.toFixed(0)}%`;
  };
  const pts = (v) => (v == null || !isFinite(v) ? "—" : `${sign(v)}${Math.abs(v).toFixed(1)} pts`);
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const money = (v) => {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(v / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B` : a >= 1e6 ? `$${Math.round(v / 1e6)}M` : `$${Math.round(v / 1e3)}K`;
  };
  const px = (v) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const day = (s) => (s ? `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}` : "—");
  const shortDay = (s) => `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`;
  const ago = (ts) => {
    const m = Math.max(0, Math.round((Date.now() - ts) / 6e4));
    return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const terminal = () => !!window.TkTheme?.isTerminal?.() || document.documentElement.dataset.theme === "terminal";
  /** Treemap color for an intensity n in −1…1 (null = no data): the Sector map's scale, pale → deep in the terminal theme, dark → vivid in classic. */
  function colorN(n) {
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    if (n == null) return terminal() ? [22, 28, 37] : [34, 38, 46];
    if (terminal()) { const k = Math.abs(n) ** 0.7; return n >= 0 ? mix([214, 238, 208], [27, 110, 43], k) : mix([247, 205, 200], [168, 26, 30], k); }
    return mix([27, 30, 37], n >= 0 ? [38, 166, 110] : [214, 74, 80], Math.abs(n) ** 0.8);
  }
  const rgb = (c) => `rgb(${c.join(",")})`;
  const inkOn = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150 ? "#0b0f14" : "#ffffff");
  const axPct = (v, step) => `${sign(Math.round(v * 100) / 100)}${Math.abs(v).toFixed(step < 1 ? 1 : 0)}%`;
  /** A round step that gives about `n` ticks across `span`. */
  function niceStep(span, n) {
    const raw = span / n, p = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }

  // ---------- state ----------
  const P = {
    active: false, snap: null, mna: null, err: null, period: "1M",
    sel: null,            // { k: "co" | "sub" | "deal" | "story", id }
    zoom: null,           // sub-sector id the treemap is opened into
    lines: { cap: true, eq: true, SPY: true, XLF: true }, etf: null,
    dealMode: "count", theme: "", cache: {}, detailHTML: null, dirty: false,
    d: null, deals: null, news: null, hover: null, tips: {}, lastW: 0
  };
  try {
    const p = localStorage.getItem("wire.fintech.period"); if (PERIODS.includes(p)) P.period = p;
    const l = JSON.parse(localStorage.getItem("wire.fintech.lines") || "null"); if (l && typeof l === "object") Object.assign(P.lines, l);
    if (localStorage.getItem("wire.fintech.dealmode") === "value") P.dealMode = "value";
  } catch {}
  const save = (k, v) => { try { localStorage.setItem(`wire.fintech.${k}`, typeof v === "string" ? v : JSON.stringify(v)); } catch {} };

  // ---------- derived data, memoized per snapshot ----------
  const hasPrices = () => !!P.snap?.dates?.length;
  function dataSig(s) {
    let px = 0;
    for (const c of s.companies || []) px += (c.price || 0) + (c.cap || 0) / 1e9;
    return `${s.fetchedAt}|${s.dates?.length}|${s.dates?.[s.dates.length - 1]}|${s.companies?.length}|${Object.keys(s.closes || {}).length}|${px.toFixed(3)}`;
  }
  /** Everything computed from the snapshot, recomputed only when the data changed; per-period parts fill in on demand. */
  function D() {
    const s = P.snap, sig = dataSig(s);
    if (P.d && P.d.sig === sig) return P.d;
    const subs = s.subsectors || [], byId = new Map(subs.map((x) => [x.id, x]));
    const cos = (s.companies || []).filter((c) => byId.has(c.sub));
    const bySym = new Map(cos.map((c) => [c.sym, c]));
    let R = new Map();
    if (hasPrices()) try { R = S.companyReturns(s); } catch (e) { console.error("Fintech returns:", e); }
    const total = cos.reduce((a, c) => a + (c.cap > 0 ? c.cap : 0), 0);
    P.d = { sig, subs, byId, cos, bySym, R, total, per: {} };
    return P.d;
  }
  /** Per-period numbers: sub-sector stats, the index and benchmark series, leaders. */
  function per(p) {
    const d = D();
    if (d.per[p]) return d.per[p];
    const s = P.snap, o = { subs: [], cap: null, eq: null, bench: {}, subIdx: {}, leaders: { up: [], down: [] } };
    if (hasPrices()) {
      const safe = (f, dflt) => { try { return f() ?? dflt; } catch (e) { console.error("Fintech stats:", e); return dflt; } };
      o.subs = safe(() => S.subStats(s, p, d.R), []);
      o.cap = safe(() => S.indexSeries(s, p, { weight: "cap" }), null);
      o.eq = safe(() => S.indexSeries(s, p, { weight: "equal" }), null);
      for (const b of s.benchmarks || []) o.bench[b.sym] = safe(() => S.benchSeries(s, b.sym, p), null);
      for (const x of d.subs) o.subIdx[x.id] = safe(() => S.indexSeries(s, p, { weight: "cap", sub: x.id }), null);
      o.leaders = safe(() => S.leaders(s, p, 5, d.R), { up: [], down: [] });
    }
    return (d.per[p] = o);
  }
  /** The last value of a rebased-to-100 series as a % change. */
  const lastRet = (ser) => { const v = ser?.values; if (!v?.length) return null; for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return v[i] - 100; return null; };
  const coRet = (sym, p) => D().R.get(sym)?.[p] ?? null;
  const subName = (id) => D().byId.get(id)?.name || id;
  /** The chart period: a one-day line is two points, so 1D charts show the last week. */
  const chartP = () => (P.period === "1D" ? "1W" : P.period);
  const benches = () => (P.snap?.benchmarks || []).filter((b) => (P.snap.closes?.[b.sym] || []).some((v) => v != null));
  const etfs = () => benches().filter((b) => b.sym !== "SPY" && b.sym !== "XLF");

  // fintech deals: the M&A snapshot's deals that fintechDeal() claims, memoized per M&A snapshot and universe
  function deals() {
    const m = P.mna, s = P.snap;
    if (!m?.deals || !s?.companies) return [];
    const sig = `${m.deals.length}|${m.fetchedAt}|${m.sizing?.known}|${s.companies.length}`;
    if (P.deals?.sig === sig) return P.deals.list;
    const list = [];
    for (const deal of m.deals) {
      let f = null;
      try { f = S.fintechDeal(deal, s.companies); } catch (e) { console.error("Fintech deal:", e); break; }
      if (f) list.push({ ...deal, sub: f.sub, why: f.why });
    }
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    let st = null;
    try { st = S.dealStats(list, Date.now()); } catch (e) { console.error("Fintech deal stats:", e); }
    P.deals = { sig, list, st };
    return list;
  }
  // fintech headlines from the news feed, memoized per feed
  function news() {
    const all = window.WireApp?.stories?.() || [];
    const sig = `${all.length}|${all[0]?.id}|${all[0]?.updated}|${P.snap?.companies?.length || 0}`;
    if (P.news?.sig === sig) return P.news;
    let list = [], counts = [];
    try {
      list = S.newsFilter(all, P.snap?.companies || []) || [];
      counts = S.themeCounts(list, Date.now()) || [];
    } catch (e) { console.error("Fintech news:", e); }
    list = [...list].sort((a, b) => (b.updated || b.ts) - (a.updated || a.ts));
    return (P.news = { sig, list, counts });
  }
  const themeOf = (id) => (S.THEMES || []).find((t) => t.id === id);
  const hasTheme = (st, id) => { const t = themeOf(id); return (st.themes || []).some((x) => x === id || x === t?.name || x?.id === id); };

  // ---------- regions ----------
  /** Replace one region's HTML if it changed. */
  function put(name, html) {
    const el = $(`#fintech [data-r="${name}"]`);
    if (!el || P.cache[name] === html) return;
    el.innerHTML = html; P.cache[name] = html;
  }
  /** A whole-page state (loading, error) instead of the regions. */
  function state(html) {
    const el = $("#fintech");
    if (P.cache.state === html) return;
    el.innerHTML = html; P.cache = { state: html };
  }
  function shell() {
    const el = $("#fintech");
    if (el.querySelector(".ft")) return;
    el.innerHTML = `<div class="ft">
      <div class="ft-bar" data-r="bar"></div>
      <div data-r="tiles"></div>
      <section class="ft-sec"><div class="ft-sh"><h3>Trends</h3><span class="dim" data-r="trendsub"></span></div>
        <div class="ft-card" data-r="trend"></div><div data-r="multi"></div></section>
      <section class="ft-sec"><div class="ft-sh"><h3>Breakdown</h3><span class="dim">where the value sits and how each part did</span></div>
        <div class="ft-brk"><div class="ft-card ft-treec" data-r="tree"></div><div class="ft-card ft-subc" data-r="subt"></div></div></section>
      <section class="ft-sec"><div class="ft-sh"><h3>Leaders and laggards</h3><span class="dim" data-r="leadsub"></span></div><div data-r="leaders"></div></section>
      <section class="ft-sec"><div class="ft-sh"><h3>Mergers and acquisitions</h3><span class="dim">fintech deals in SEC filings, last three years</span></div><div data-r="mna"></div></section>
      <section class="ft-sec"><div class="ft-sh"><h3>News and themes</h3><span class="dim">fintech headlines from your news feed</span></div><div data-r="news"></div></section>
      <div class="ft-tip" hidden></div></div>`;
    P.cache = {};
  }
  const width = (name, dflt = 800) => Math.max(320, $(`#fintech [data-r="${name}"]`)?.clientWidth || dflt);

  function bar() {
    const s = P.snap;
    const when = s.fetchedAt ? new Date(s.fetchedAt) : null;
    const today = when && when.toDateString() === new Date().toDateString();
    const time = when ? when.toLocaleString("en-US", today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    const prog = s.loading ? `Loading prices${s.progress != null ? ` · ${Math.round(s.progress * 100)}%` : "…"}` : "";
    const status = s.error ? `<span class="dn">${esc(s.error)}</span>` : prog ? `<span class="ft-load"><i class="ft-spin"></i>${esc(prog)}</span>` : when ? `Updated ${esc(time)}` : "";
    const last = s.dates?.length ? `prices to ${day(s.dates[s.dates.length - 1])}` : "";
    return `<div class="ft-ttl"><h2>Fintech</h2><p class="dim" title="Payments, lending, digital banks, brokerage, crypto, market infrastructure, financial software and insurtech">${D().cos.length} US-listed companies in ${D().subs.length} sub-sectors: payments, lending, digital banks, brokerage, crypto, market infrastructure, software, insurtech</p></div>
      <div class="ft-ctl"><div class="ft-seg" role="group" aria-label="Period">${PERIODS.map((p, i) => `<button type="button" data-per="${p}" aria-pressed="${p === P.period}" title="${esc(`Returns ${WORDS[p]} (key ${i + 1})`)}">${p}</button>`).join("")}</div>
        <button type="button" class="ft-btn" data-ref ${s.loading ? "disabled" : ""} title="Fetch the latest prices (R)">${s.loading ? "Loading…" : "↻ Refresh"}</button></div>
      <p class="ft-st dim" role="status">${status}${last ? `<span>${esc(last)}</span>` : ""}</p>`;
  }

  // ---------- 1. tiles ----------
  function tiles() {
    const p = P.period, o = per(p), d = D();
    if (!hasPrices()) {
      return `<div class="ft-tiles"><div class="ft-tile"><span>Total market value</span><b>${money(d.total)}</b><em class="dim">${d.cos.length} companies in ${d.subs.length} sub-sectors</em></div>
        <div class="ft-tile ft-wide"><span>Returns</span><b class="dim ft-tw">Prices still loading</b><em class="dim">${P.snap.progress != null ? `${Math.round(P.snap.progress * 100)}% downloaded` : "three years of daily closes from Yahoo"}</em></div></div>`;
    }
    const fin = lastRet(o.cap), eq = lastRet(o.eq), spy = lastRet(o.bench.SPY), xlf = lastRet(o.bench.XLF);
    const rel = (b) => (fin == null || b == null ? null : fin - b);
    const subs = o.subs.filter((x) => x.ret != null), best = subs.reduce((a, x) => (!a || x.ret > a.ret ? x : a), null), worst = subs.reduce((a, x) => (!a || x.ret < a.ret ? x : a), null);
    let up = 0, dn = 0, n = 0;
    for (const c of d.cos) { const r = coRet(c.sym, p); if (r == null) continue; n++; if (r > 0) up++; else if (r < 0) dn++; }
    const sub = (t, c = "dim") => `<em class="${c}">${t}</em>`;
    const vs = (name, b) => `<div class="ft-tile" title="${esc(`The fintech index ${WORDS[p]} minus ${name}: positive means fintech did better`)}"><span>Fintech vs ${esc(name)}</span><b class="${cls(rel(b))}">${pts(rel(b))}</b>${sub(b == null ? "no data" : `${esc(name)} ${pct(b)}`)}</div>`;
    const subTile = (x, word) => x ? `<button type="button" class="ft-tile" data-sub="${esc(x.id)}" title="Show ${esc(x.name)}"><span>${word} sub-sector</span><b class="ft-tw" title="${esc(x.name)}"><i class="ft-dot" style="background:${subCol(x.id)}"></i><span>${esc(x.name)}</span></b>${sub(`${pct(x.ret)} ${WORDS[p]}`, cls(x.ret))}</button>` : `<div class="ft-tile"><span>${word} sub-sector</span><b>—</b></div>`;
    return `<div class="ft-tiles">
      <div class="ft-tile" title="Every company weighted by its market value, rebalanced daily, so a company only counts from its first trading day"><span>Fintech index</span><b class="${cls(fin)}">${pct(fin)}</b>${sub(`${WORDS[p]} · equal-weighted ${pct(eq)}`)}</div>
      ${vs("S&P 500", spy)}${vs("financials (XLF)", xlf)}
      <div class="ft-tile"><span>Total market value</span><b>${money(d.total)}</b>${sub(`${d.cos.length} companies · ${d.subs.length} sub-sectors`)}</div>
      ${subTile(best, "Best")}${subTile(worst, "Worst")}
      <div class="ft-tile" title="Companies with a price for the whole period"><span>Companies up</span><b>${n ? Math.round((up / n) * 100) + "%" : "—"}</b>${sub(`<span class="up">${up} up</span> · <span class="dn">${dn} down</span>${n < d.cos.length ? ` · ${d.cos.length - n} too new` : ""}`)}</div></div>`;
  }

  // ---------- 2. trends ----------
  function trendLines() {
    const p = chartP(), o = per(p), out = [];
    const add = (key, label, ser, color, extra = {}) => { if (ser?.values?.length) out.push({ key, label, ser, color, ...extra }); };
    add("cap", "Fintech, value-weighted", o.cap, LINE_COL.cap, { w: 2.2 });
    add("eq", "Fintech, equal-weighted", o.eq, LINE_COL.eq, { dash: "5 4", w: 1.6 });
    add("SPY", "S&P 500", o.bench.SPY, LINE_COL.SPY);
    add("XLF", "Financials (XLF)", o.bench.XLF, LINE_COL.XLF);
    etfs().forEach((b, i) => add(b.sym, `${b.sym} ETF`, o.bench[b.sym], ETF_COL[i % ETF_COL.length], { etf: true, title: b.name }));
    return out;
  }
  const lineOn = (l) => (l.etf ? (P.etf || etfs()[0]?.sym) === l.key : P.lines[l.key] !== false);
  /** x labels for a run of trading days: days for a month or less, months for a year or less, then quarters. */
  function xTicks(dates, X) {
    const n = dates.length, out = [];
    if (n < 2) return out;
    const span = (Date.parse(dates[n - 1]) - Date.parse(dates[0])) / DAY;
    if (span <= 45) {
      const step = Math.max(1, Math.ceil(n / 6));
      for (let i = 0; i < n; i += step) out.push([X(i), shortDay(dates[i]), false]);
      return out;
    }
    const every = span <= 120 ? 1 : span <= 400 ? 2 : 6;
    for (let i = 1; i < n; i++) {
      if (dates[i].slice(5, 7) === dates[i - 1].slice(5, 7)) continue;
      const mo = +dates[i].slice(5, 7) - 1;
      if (mo % every) continue;
      out.push([X(i), mo === 0 ? dates[i].slice(0, 4) : MON[mo], mo === 0]);
    }
    return out;
  }
  function trend() {
    if (!hasPrices()) return window.WireUI.empty("Prices still loading", "The lines appear once the daily closes are in.");
    const lines = trendLines(), on = lines.filter(lineOn), base = lines[0];
    if (!base) return window.WireUI.empty("Not enough prices for this period", "Pick a longer period or wait for the download to finish.");
    const dates = base.ser.dates, n = dates.length;
    const W = width("trend") - 28, H = 270, pl = 8, pr = 48, pt = 12, pb = 24, pw = W - pl - pr, ph = H - pt - pb;
    // every line on the base calendar, by date
    const val = on.map((l) => { const m = new Map(l.ser.dates.map((dt, i) => [dt, l.ser.values[i]])); return dates.map((dt) => m.get(dt) ?? null); });
    let lo = 100, hi = 100;
    for (const v of val) for (const x of v) if (x != null) { if (x < lo) lo = x; if (x > hi) hi = x; }
    const padY = Math.max(0.5, (hi - lo) * 0.08); lo -= padY; hi += padY;
    const X = (i) => pl + (n > 1 ? (i / (n - 1)) * pw : pw / 2), Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * ph;
    let g = `<svg class="ft-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Fintech index against benchmarks, rebased to 100">`;
    const step = niceStep(hi - lo, 5);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Y(v).toFixed(1);
      g += `<line x1="${pl}" x2="${pl + pw}" y1="${y}" y2="${y}" class="ft-grid"/><text x="${pl + pw + 6}" y="${+y + 3}" class="ft-ax">${axPct(v - 100, step)}</text>`;
    }
    g += `<line x1="${pl}" x2="${pl + pw}" y1="${Y(100).toFixed(1)}" y2="${Y(100).toFixed(1)}" class="ft-base"/>`;
    for (const [x, t, strong] of xTicks(dates, X)) g += `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ft-ax${strong ? " strong" : ""}">${esc(t)}</text>`;
    // the hero line last, so it sits on top
    const order = on.map((l, i) => i).sort((a, b) => (on[a].key === "cap") - (on[b].key === "cap"));
    for (const i of order) {
      const l = on[i], pp = [];
      let seg = "";
      val[i].forEach((v, j) => { if (v == null) { if (pp.length) { seg += `M${pp.join("L")}`; pp.length = 0; } return; } pp.push(`${X(j).toFixed(1)},${Y(v).toFixed(1)}`); });
      if (pp.length) seg += `M${pp.join("L")}`;
      if (seg) g += `<path d="${seg}" fill="none" stroke="${l.color}" stroke-width="${l.w || 1.5}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""} stroke-linejoin="round" class="ft-line"/>`;
    }
    g += `<g class="ft-cross"></g><rect class="ft-hit" data-hit="trend" x="${pl}" y="${pt}" width="${pw}" height="${ph}"/></svg>`;
    P.tips.trend = { dates, on, val, X, Y, pl, pw, pt, ph, n };
    const chips = lines.map((l) => {
      const r = lastRet(l.ser), pressed = lineOn(l);
      return `<button type="button" class="ft-chip" data-line="${esc(l.key)}" aria-pressed="${pressed}" title="${esc(l.title || (pressed ? "Hide this line" : "Show this line"))}"><i class="ft-sw${l.dash ? " dash" : ""}" style="--c:${l.color}"></i>${esc(l.label)}<b class="${cls(r)}">${pct(r)}</b></button>`;
    }).join("");
    return `<div class="ft-chips" role="group" aria-label="Lines">${chips}</div>${g}
      <p class="ft-note">Each line starts at 100 on the close before the period and shows the growth of $100. The value-weighted index weights each company by its market value; the equal-weighted one gives every company the same say, so it shows how the typical fintech did. New listings join on their first close.${P.period === "1D" ? " A one-day line has only two points, so the chart shows the past week; the tiles above show today." : ""}${etfs().length > 1 ? " Fintech ETF chips show one ETF at a time." : ""}</p>`;
  }
  function multi() {
    if (!hasPrices()) return "";
    const p = chartP(), o = per(p), d = D(), base = o.cap?.values || [];
    const cells = d.subs.map((x) => {
      const ser = o.subIdx[x.id], v = ser?.values || [], r = lastRet(ser), fr = lastRet(o.cap);
      if (!v.length) return `<div class="ft-sm"><div class="ft-smh"><b><i class="ft-dot" style="background:${subCol(x.id)}"></i>${esc(x.name)}</b><span class="dim">no data</span></div></div>`;
      let lo = Infinity, hi = -Infinity;
      for (const a of [v, base]) for (const y of a) if (y != null) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      if (!(hi > lo)) { hi = lo + 1; }
      const path = (a) => { const n = a.length; let s = "", pen = false; a.forEach((y, i) => { if (y == null) { pen = false; return; } s += `${pen ? "L" : "M"}${((i / Math.max(1, n - 1)) * 200).toFixed(1)},${(46 - ((y - lo) / (hi - lo)) * 42).toFixed(1)}`; pen = true; }); return s; };
      const y100 = (46 - ((100 - lo) / (hi - lo)) * 42).toFixed(1);
      const diff = r != null && fr != null ? r - fr : null;
      return `<button type="button" class="ft-sm" data-sub="${esc(x.id)}" aria-pressed="${P.sel?.k === "sub" && P.sel.id === x.id}" title="${esc(`${x.name}: ${pct(r)} ${WORDS[p]}, ${pts(diff)} against the whole fintech index`)}">
        <div class="ft-smh"><b><i class="ft-dot" style="background:${subCol(x.id)}"></i>${esc(x.name)}</b><span class="${cls(r)}">${pct(r)}</span></div>
        <svg viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden="true">${100 >= lo && 100 <= hi ? `<line x1="0" x2="200" y1="${y100}" y2="${y100}" class="ft-base"/>` : ""}<path d="${path(base)}" class="ft-smb"/><path d="${path(v)}" class="ft-sml" style="stroke:${subCol(x.id)}"/></svg>
        <div class="ft-smf dim"><span>${diff == null ? "" : `${pts(diff)} vs fintech`}</span><span>${d.cos.filter((c) => c.sub === x.id).length} cos</span></div></button>`;
    }).join("");
    return `<div class="ft-multi">${cells}</div><p class="ft-note"><i class="ft-sw" style="--c:var(--dim)"></i> grey line: the whole fintech index on the same scale. Click a sub-sector for its companies.</p>`;
  }

  // ---------- 3. breakdown: treemap + sub-sector table ----------
  function tree() {
    const d = D(), p = P.period, W = width("tree") - 26, zoom = P.zoom && d.byId.get(P.zoom) ? P.zoom : null;
    const H = Math.round(clamp(W * 0.6, 300, 470)), sc = SCALE[p];
    const cos = d.cos.filter((c) => c.cap > 0);
    if (!cos.length) return window.WireUI.empty("Market values still loading", "Company sizes come from Nasdaq's stock screener.");
    const tip = (P.tips.tree = {});
    let g = `<svg class="ft-svg ft-tm" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Treemap of fintech sub-sectors and companies by market value">`;
    const cell = (c, r, ink) => {
      const ret = coRet(c.sym, p), col = colorN(ret == null ? null : clamp(ret / sc, -1, 1)), fg = ink || inkOn(col);
      tip[c.sym] = `<b>${esc(c.sym)}</b> <span class="dim">${esc(c.name || "")}</span><div>${money(c.cap)} · ${esc(subName(c.sub))}</div><div>${P.period} <b class="${cls(ret)}">${pct(ret)}</b>${c.price != null ? ` · ${px(c.price)}` : ""}</div>`;
      const sel = P.sel?.k === "co" && P.sel.id === c.sym ? " sel" : "";
      let s = `<g class="ft-cell${sel}" data-sym="${esc(c.sym)}" data-tip="tree"><rect x="${(r.x + 0.5).toFixed(1)}" y="${(r.y + 0.5).toFixed(1)}" width="${Math.max(0, r.w - 1).toFixed(1)}" height="${Math.max(0, r.h - 1).toFixed(1)}" fill="${rgb(col)}"/>`;
      if (r.w > 30 && r.h > 16) {
        const fs = clamp(Math.min(r.w / 4.2, r.h / 2.4), 9, zoom ? 20 : 15), cx = r.x + r.w / 2, two = r.h > fs * 2.6;
        s += `<text x="${cx.toFixed(1)}" y="${(r.y + r.h / 2 + (two ? -fs * 0.15 : fs * 0.35)).toFixed(1)}" text-anchor="middle" fill="${fg}" font-size="${fs.toFixed(1)}" class="ft-cs">${esc(c.sym)}</text>`;
        if (two) s += `<text x="${cx.toFixed(1)}" y="${(r.y + r.h / 2 + fs * 0.95).toFixed(1)}" text-anchor="middle" fill="${fg}" font-size="${(fs * 0.72).toFixed(1)}" class="ft-cr">${pct(ret)}</text>`;
      }
      return s + "</g>";
    };
    if (zoom) {
      const list = cos.filter((c) => c.sub === zoom), rects = T.squarify(list.map((c) => c.cap), { x: 0, y: 0, w: W, h: H });
      list.forEach((c, i) => { g += cell(c, rects[i]); });
    } else {
      const subs = d.subs.map((x) => ({ x, cos: cos.filter((c) => c.sub === x.id) })).filter((x) => x.cos.length);
      const top = T.squarify(subs.map((x) => x.cos.reduce((a, c) => a + c.cap, 0)), { x: 0, y: 0, w: W, h: H });
      subs.forEach((s, i) => {
        const r = top[i], band = r.h > 54 && r.w > 70 ? 17 : 0;
        const inner = { x: r.x + 1, y: r.y + band + 1, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - band - 2) };
        const rects = T.squarify(s.cos.map((c) => c.cap), inner);
        const sr = per(p).subs.find((x) => x.id === s.x.id)?.ret;
        g += `<g class="ft-grp" data-sub="${esc(s.x.id)}"><rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" class="ft-gbg"/>`;
        s.cos.forEach((c, j) => { g += cell(c, rects[j]); });
        if (band) {
          const room = Math.floor((r.w - 54) / 6.4), name = s.x.name.length > room ? s.x.name.slice(0, Math.max(3, room - 1)) + "…" : s.x.name;
          g += `<text x="${(r.x + 6).toFixed(1)}" y="${(r.y + 12.5).toFixed(1)}" class="ft-gn">${esc(name.toUpperCase())}</text><text x="${(r.x + r.w - 6).toFixed(1)}" y="${(r.y + 12.5).toFixed(1)}" text-anchor="end" class="ft-gn ${cls(sr)}">${pct(sr)}</text>`;
        }
        g += `<rect x="${(r.x + 0.5).toFixed(1)}" y="${(r.y + 0.5).toFixed(1)}" width="${Math.max(0, r.w - 1).toFixed(1)}" height="${Math.max(0, r.h - 1).toFixed(1)}" class="ft-gol"/></g>`;
      });
    }
    g += "</svg>";
    const stops = [-1, -0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6, 1].map((n) => rgb(colorN(n))).join(",");
    const crumb = zoom ? `<button type="button" class="ft-crumb" data-up title="Back to every sub-sector (Esc)">‹ All sub-sectors</button><b>${esc(subName(zoom))}</b><span class="dim">${cos.filter((c) => c.sub === zoom).length} companies · ${money(cos.filter((c) => c.sub === zoom).reduce((a, c) => a + c.cap, 0))}</span>`
      : `<b>All sub-sectors</b><span class="dim">click a sub-sector to open it</span>`;
    return `<div class="ft-ch">${crumb}</div>${g}
      <div class="ft-leg"><span class="num">−${sc}%</span><i style="background:linear-gradient(90deg,${stops})"></i><span class="num">+${sc}%</span><span class="dim">area = market value · color = ${esc(P.period)} return${hasPrices() ? "" : " (prices still loading)"}</span></div>`;
  }
  function subt() {
    const d = D(), p = P.period, cols = COLS.includes(p) ? COLS : [p, ...COLS];
    const stats = Object.fromEntries(cols.map((c) => [c, new Map(per(c).subs.map((x) => [x.id, x]))]));
    const cur = stats[p];
    const rows = d.subs.map((x) => {
      const st = cur.get(x.id) || {}, members = d.cos.filter((c) => c.sub === x.id), cap = members.reduce((a, c) => a + (c.cap > 0 ? c.cap : 0), 0);
      const share = d.total ? (cap / d.total) * 100 : null;
      const bw = (o) => (o ? `<button type="button" class="ft-tk" data-co="${esc(o.sym)}" title="${esc(`${d.bySym.get(o.sym)?.name || o.sym}: ${pct(o.ret)}`)}">${esc(o.sym)}</button> <span class="${cls(o.ret)}">${pct(o.ret)}</span>` : '<span class="dimmer">—</span>');
      return `<div class="ft-r" role="row" data-sub="${esc(x.id)}" aria-selected="${P.sel?.k === "sub" && P.sel.id === x.id}" title="${esc(x.blurb || "")}">
        <span class="c-n"><i class="ft-dot" style="background:${subCol(x.id)}"></i>${esc(x.name)}</span>
        <span class="c-num">${members.length}</span><span class="c-num">${money(cap)}</span>
        <span class="c-num c-share"><i style="width:${share == null ? 0 : clamp(share, 0, 100).toFixed(1)}%"></i><em>${share == null ? "—" : share.toFixed(1) + "%"}</em></span>
        ${cols.map((c) => { const v = stats[c].get(x.id)?.ret; return `<span class="c-num c-ret ${cls(v)}${c === p ? " cur" : ""}">${pct(v)}</span>`; }).join("")}
        <span class="c-bw">${bw(st.best)}</span><span class="c-bw">${bw(st.worst)}</span></div>`;
    }).join("");
    const head = `<div class="ft-r ft-h" role="row"><span>Sub-sector</span><span class="c-num">Cos</span><span class="c-num">Value</span><span class="c-num">Share</span>${cols.map((c) => `<span class="c-num c-ret${c === p ? " cur" : ""}">${c}</span>`).join("")}<span class="c-bw" title="Best ${esc(p)} return in the sub-sector">Best</span><span class="c-bw" title="Worst ${esc(p)} return in the sub-sector">Worst</span></div>`;
    return `<div class="ft-t" role="grid" aria-label="Sub-sectors" style="--ncol:${cols.length}">${head}${rows}</div>
      <p class="ft-note">Returns are value-weighted within each sub-sector. ↑↓ move · ↵ opens · click a ticker for its company.</p>`;
  }

  // ---------- 4. leaders and laggards ----------
  function leaders() {
    if (!hasPrices()) return window.WireUI.empty("Prices still loading", "");
    const L = per(P.period).leaders;
    if (!L.up?.length && !L.down?.length) return window.WireUI.empty("No returns for this period yet", "");
    const max = Math.max(0.01, ...[...(L.up || []), ...(L.down || [])].map((x) => Math.abs(x.ret || 0)));
    const list = (xs, title) => `<div class="ft-card ft-ld"><div class="ft-ch"><b>${title}</b></div>${xs.map((x, i) => `<button type="button" class="ft-lr" data-co="${esc(x.sym)}" aria-pressed="${P.sel?.k === "co" && P.sel.id === x.sym}">
        <span class="ft-rk">${i + 1}</span><span class="ft-sym">${esc(x.sym)}</span><span class="ft-nm"><span>${esc(x.name || D().bySym.get(x.sym)?.name || "")}</span><em><i class="ft-dot" style="background:${subCol(x.sub)}"></i>${esc(subName(x.sub))}</em></span>
        <span class="ft-lb"><i class="${cls(x.ret)}" style="width:${((Math.abs(x.ret || 0) / max) * 100).toFixed(1)}%"></i></span><b class="${cls(x.ret)}">${pct(x.ret)}</b></button>`).join("") || `<p class="ft-note">None</p>`}</div>`;
    return `<div class="ft-two">${list(L.up || [], `Best ${esc(P.period)}`)}${list(L.down || [], `Worst ${esc(P.period)}`)}</div>`;
  }

  // ---------- 5. M&A ----------
  function mna() {
    const m = P.mna;
    if (!m) return window.WireUI.skeleton("rows", { n: 4, label: "Loading deals from SEC filings…" });
    const list = deals();
    if (!m.deals?.length) {
      if (m.loading || (!m.error && !m.fetchedAt)) return window.WireUI.skeleton("rows", { n: 4, label: "The M&A page is still downloading deal filings from the SEC…" });
      if (m.error) return window.WireUI.error(m.error, "data-mnaref");
    }
    if (!list.length) return window.WireUI.empty("No fintech deals in this period", "None of the SEC deal filings from the last three years has a fintech target or buyer.", `<button type="button" class="es-btn" data-goto="mna">Open the M&A page</button>`);
    const st = P.deals.st || {}, sized = list.filter((x) => x.value != null), value = sized.reduce((a, x) => a + x.value, 0);
    const largest = sized.reduce((a, x) => (!a || x.value > a.value ? x : a), null), open = list.filter((x) => x.active).length;
    const W = width("mna") - 2, two = W >= 980, cw = (two ? Math.floor((W - 12) * 0.62) : W) - 28;
    const head = `<div class="ft-tiles ft-tiles-s">
      <div class="ft-tile"><span>Fintech deals</span><b>${list.length}</b><em class="dim">${open} in progress</em></div>
      <div class="ft-tile"><span>Disclosed value</span><b>${sized.length ? money(value) : "—"}</b><em class="dim">sizes known for ${sized.length} of ${list.length}</em></div>
      ${largest ? `<button type="button" class="ft-tile" data-deal="${esc(largest.id)}" title="Show this deal"><span>Largest</span><b>${money(largest.value)}</b><em class="dim">${esc(largest.target.name)}</em></button>` : `<div class="ft-tile"><span>Largest</span><b>—</b><em class="dim">${m.needsContact ? "sizes need an SEC contact email (M&amp;A page)" : "no sizes known yet"}</em></div>`}</div>`;
    // quarterly stacked bars
    const qs = (st.byQuarter || []).slice(-12), subs = D().subs, valMode = P.dealMode === "value";
    const qv = {}; // value per quarter and sub-sector (dealStats counts by sub-sector; values are summed here)
    for (const x of list) { if (x.value == null) continue; const q = `${x.date.slice(0, 4)}Q${Math.floor((+x.date.slice(5, 7) - 1) / 3) + 1}`; ((qv[q] ||= {})[x.sub] ||= 0); qv[q][x.sub] += x.value; }
    const seg = (q) => subs.map((s) => [s.id, valMode ? qv[q.q]?.[s.id] || 0 : q.bySub?.[s.id] || 0]).filter(([, v]) => v > 0);
    const tot = qs.map((q) => seg(q).reduce((a, [, v]) => a + v, 0)), max = Math.max(valMode ? 1e8 : 1, ...tot) * 1.1;
    const H = 210, pl = 40, pr = 8, pt = 10, pb = 22, pw = cw - pl - pr, ph = H - pt - pb, band = pw / Math.max(1, qs.length), bw = Math.max(4, band * 0.64);
    const Y = (v) => pt + (1 - v / max) * ph;
    let g = `<svg class="ft-svg" viewBox="0 0 ${cw} ${H}" width="${cw}" height="${H}" role="img" aria-label="Fintech deals per quarter by sub-sector">`;
    const step = niceStep(max, 4);
    for (let v = 0; v <= max; v += step) g += `<line x1="${pl}" x2="${pl + pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="ft-grid"/><text x="${pl - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" class="ft-ax">${valMode ? (v ? money(v).replace(".0B", "B") : "0") : v}</text>`;
    P.tips.q = {};
    qs.forEach((q, i) => {
      const x = pl + i * band + (band - bw) / 2;
      let b = 0;
      for (const [id, v] of seg(q)) { g += `<rect x="${x.toFixed(1)}" y="${Y(b + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(b) - Y(b + v)).toFixed(1)}" fill="${subCol(id)}" class="ft-qbar"/>`; b += v; }
      g += `<text x="${(pl + i * band + band / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ft-ax${q.q.endsWith("Q1") ? " strong" : ""}">${q.q.endsWith("Q1") ? q.q.slice(0, 4) : q.q.slice(4)}</text>`;
      g += `<rect class="ft-qhit" data-tip="q" data-q="${esc(q.q)}" x="${(pl + i * band).toFixed(1)}" y="${pt}" width="${band.toFixed(1)}" height="${ph}"/>`;
      const parts = subs.map((s) => [s, q.bySub?.[s.id] || 0, qv[q.q]?.[s.id] || 0]).filter(([, n]) => n > 0);
      P.tips.q[q.q] = `<b>${esc(q.q.replace("Q", " Q"))}</b><div>${q.n} deal${q.n === 1 ? "" : "s"}${q.value > 0 ? ` · ${money(q.value)} disclosed` : q.n ? " · no sizes known" : ""}</div>${parts.map(([s, n, v]) => `<div class="ft-tl"><i class="ft-dot" style="background:${subCol(s.id)}"></i>${esc(s.name)}<b>${n}${v ? ` · ${money(v)}` : ""}</b></div>`).join("")}`;
    });
    g += "</svg>";
    const legend = subs.filter((s) => list.some((x) => x.sub === s.id)).map((s) => `<span><i class="ft-dot" style="background:${subCol(s.id)}"></i>${esc(s.name)}</span>`).join("");
    const chart = `<div class="ft-card"><div class="ft-ch"><b>${valMode ? "Disclosed value" : "Deals"} per quarter</b><span class="dim">by the target's sub-sector</span>
        <span class="ft-tog"><button type="button" data-dmode="count" aria-pressed="${!valMode}">Count</button><button type="button" data-dmode="value" aria-pressed="${valMode}">Value</button></span></div>
      ${qs.length ? g : `<p class="ft-note">No quarters to show yet.</p>`}<div class="ft-legend">${legend}</div></div>`;
    const bs = (st.bySub || []).filter((x) => x.n > 0).sort((a, b) => b.n - a.n), bmax = Math.max(1, ...bs.map((x) => x.n));
    const totals = `<div class="ft-card"><div class="ft-ch"><b>By sub-sector</b><span class="dim">deals · disclosed value</span></div>
      ${bs.map((x) => `<div class="ft-bs"><span><i class="ft-dot" style="background:${subCol(x.id)}"></i>${esc(subName(x.id))}</span><span class="ft-bsb"><i style="width:${((x.n / bmax) * 100).toFixed(1)}%;background:${subCol(x.id)}"></i></span><b>${x.n}</b><em>${x.value ? money(x.value) : "—"}</em></div>`).join("")}</div>`;
    const rows = list.slice(0, 25).map((x) => {
      const tk = x.target.tickers?.[0], a = x.acquirers || [];
      return `<div class="ft-dr" role="row" data-deal="${esc(x.id)}" aria-selected="${P.sel?.k === "deal" && P.sel.id === x.id}">
        <span class="c-date">${day(x.date)}</span>
        <span class="c-tgt"><b>${esc(x.target.name)}</b>${tk ? `<em class="ft-tkx">${esc(tk)}</em>` : ""}</span>
        <span class="c-buy">${a.length ? esc(a[0].name) + (a.length > 1 ? ` <em class="dim">+${a.length - 1}</em>` : "") : '<span class="dimmer">not named</span>'}</span>
        <span class="c-sub"><i class="ft-dot" style="background:${subCol(x.sub)}"></i>${esc(subName(x.sub))}</span>
        <span class="c-num">${x.value != null ? money(x.value) : '<span class="dimmer">—</span>'}</span>
        <span class="c-typ">${esc(x.type || "")}</span>
        <span class="c-stat">${x.active ? '<i class="ft-live"></i>In progress' : "Past"}</span></div>`;
    }).join("");
    return `${head}<div class="ft-mna${two ? " two" : ""}">${chart}${totals}</div>
      <div class="ft-card"><div class="ft-ch"><b>Latest fintech deals</b><span class="dim">newest first${list.length > 25 ? ` · 25 of ${list.length}` : ""}</span><button type="button" class="ft-btn ft-ml" data-goto="mna" title="Open the M&A page for every deal and its filters">Open M&A page ›</button></div>
        <div class="ft-dt" role="grid" aria-label="Fintech deals"><div class="ft-dr ft-h" role="row"><span>Date</span><span>Target</span><span>Buyer</span><span>Sub-sector</span><span class="c-num">Size</span><span>Type</span><span>Status</span></div>${rows}</div></div>
      <p class="ft-note">Only deals where the target files with the SEC (a US-listed company) are here: private fintechs bought privately, and most foreign ones, file nothing the M&A page can read. A deal counts as fintech when the target or a buyer is in this page's universe, or when the target's industry code and name say so.${m.loading ? " Filings are still downloading, so more may appear." : ""}</p>`;
  }

  // ---------- 6. news and themes ----------
  function newsR() {
    const N = news(), all = window.WireApp?.stories?.() || [];
    if (!all.length) return window.WireUI.empty("No news loaded yet", "Headlines appear once the news feeds have been pulled.");
    const chips = `<div class="ft-chips" role="group" aria-label="Themes"><button type="button" class="ft-chip" data-ntheme="" aria-pressed="${!P.theme}">All fintech<b>${N.list.length}</b></button>${N.counts.map((t) => `<button type="button" class="ft-chip" data-ntheme="${esc(t.id)}" aria-pressed="${P.theme === t.id}" title="${esc(`${t.name}: ${t.n24h} in the last 24 hours, ${t.n7d} in 7 days`)}"${!t.n7d ? " disabled" : ""}>${esc(t.name)}<b>${t.n24h}</b><em>${t.n7d}</em></button>`).join("")}</div>`;
    const list = (P.theme ? N.list.filter((s) => hasTheme(s, P.theme)) : N.list).slice(0, 20);
    if (!list.length) return `${chips}${window.WireUI.empty(P.theme ? `No ${themeOf(P.theme)?.name || ""} headlines right now` : "No fintech headlines right now", "Nothing in the news feed mentions a fintech company or theme. Stories show up as the feeds refresh.")}`;
    const rows = list.map((s) => `<div class="ft-nr" role="row" data-story="${esc(s.id)}" aria-selected="${P.sel?.k === "story" && P.sel.id === s.id}">
        <span class="c-ago" title="${esc(new Date(s.ts).toLocaleString())}">${ago(s.updated || s.ts)}</span><span class="c-src">${esc(s.code || "")}</span>
        <span class="c-ttl">${esc(s.title)}</span>
        <span class="c-tags">${(s.tickers || []).slice(0, 3).map((t) => `<button type="button" class="ft-tk" data-co="${esc(t)}">${esc(t)}</button>`).join("")}</span></div>`).join("");
    return `${chips}<p class="ft-note ft-cnote">Chips count headlines in the last 24 hours <em>(and 7 days)</em>; click one to filter.</p><div class="ft-card ft-nl" role="grid" aria-label="Fintech headlines">${rows}</div>`;
  }

  // ---------- right pane ----------
  function rowsPane(items) {
    const max = Math.max(0.01, ...items.map((x) => Math.abs(x.v ?? 0)));
    return `<div class="ft-pr">${items.map((x) => `<button type="button" class="ft-prr${x.sel ? " sel" : ""}" ${x.attr}="${esc(x.key)}" title="${esc(x.title || "")}">
      <span class="ft-prn">${x.dot ? `<i class="ft-dot" style="background:${x.dot}"></i>` : ""}<b>${esc(x.label)}</b>${x.sub ? `<span>${esc(x.sub)}</span>` : ""}</span>
      <span class="ft-prb"><i class="${cls(x.v)}" style="width:${x.v == null ? 0 : ((Math.abs(x.v) / max) * 50).toFixed(1)}%;${x.v >= 0 ? "left:50%" : "right:50%"}"></i></span>
      <span class="ft-prv ${cls(x.v)}">${pct(x.v)}</span><span class="ft-prc">${money(x.cap)}</span></button>`).join("")}</div>`;
  }
  function detail() {
    const s = P.snap;
    if (!s) return P.err ? window.WireUI.error(P.err, "data-ref") : window.WireUI.skeleton("detail");
    const d = D(), p = P.period, sel = P.sel;
    if (sel?.k === "co" && d.bySym.has(sel.id)) return coPane(d.bySym.get(sel.id));
    if (sel?.k === "sub" && d.byId.has(sel.id)) return subPane(d.byId.get(sel.id));
    if (sel?.k === "deal") { const x = deals().find((y) => y.id === sel.id); if (x) return dealPane(x); }
    if (sel?.k === "story") { const x = news().list.find((y) => y.id === sel.id); if (x) return storyPane(x); }
    const o = per(p), fin = lastRet(o.cap);
    return `<div class="dhead"><span class="code">FIN</span><span class="nm">${d.cos.length} companies · ${money(d.total)}</span></div>
      <h1>Fintech</h1>
      ${hasPrices() ? `<p class="ft-big"><span class="${cls(fin)}">${pct(fin)}</span> <span class="dim">${esc(WORDS[p])}, value-weighted</span></p>` : `<p class="ft-pnote">Prices are still loading; returns appear once they are in.</p>`}
      <div class="isec">SUB-SECTORS · ${esc(p)} RETURN</div>
      ${rowsPane(d.subs.map((x) => { const st = o.subs.find((y) => y.id === x.id); return { attr: "data-sub", key: x.id, label: x.name, v: st?.ret ?? null, cap: d.cos.filter((c) => c.sub === x.id).reduce((a, c) => a + (c.cap > 0 ? c.cap : 0), 0), dot: subCol(x.id), title: x.blurb }; }).sort((a, b) => (b.v ?? -1e9) - (a.v ?? -1e9)))}
      <div class="isec">HOW THIS PAGE WORKS</div>
      <dl class="kv ft-kv">
        <dt>Universe</dt><dd>US-listed payments, lending, digital-bank, brokerage, crypto, market-infrastructure, financial-software and insurtech companies, each in one sub-sector.</dd>
        <dt>Index</dt><dd>Value-weighted by market value, rebalanced every day, so a new listing counts from its first close and never before.</dd>
        <dt>Value</dt><dd>Market value from Nasdaq's screener, moved with the live price.</dd>
        <dt>Prices</dt><dd>Daily closes from Yahoo, three years back.</dd>
        <dt>Deals</dt><dd>From the M&A page (SEC filings), only those with a fintech target or buyer.</dd>
      </dl>
      <p class="ft-pnote">Keys: 1–7 pick the period · ↑↓ move through the sub-sectors (or a sub-sector's companies) · ↵ opens · Esc goes back · R refreshes.</p>`;
  }
  function coPane(c) {
    const d = D(), p = P.period, peers = d.cos.filter((x) => x.sub === c.sub && x.cap > 0).sort((a, b) => b.cap - a.cap);
    const subCap = peers.reduce((a, x) => a + x.cap, 0), rank = peers.findIndex((x) => x.sym === c.sym) + 1;
    const watched = (window.WireApp?.watch?.() || []).some((w) => w.sym === c.sym);
    const rets = PERIODS.map((q) => { const r = coRet(c.sym, q), f = lastRet(per(q).cap), sp = lastRet(per(q).bench.SPY); return `<tr${q === p ? ' class="cur"' : ""}><td>${q}</td><td class="${cls(r)}">${pct(r)}</td><td class="${cls(f)}">${pct(f)}</td><td class="${cls(sp)}">${pct(sp)}</td></tr>`; }).join("");
    const dl = deals().filter((x) => (x.target.tickers || []).includes(c.sym) || (x.acquirers || []).some((a) => (a.tickers || []).includes(c.sym))).slice(0, 5);
    const nw = news().list.filter((s) => (s.tickers || []).includes(c.sym)).slice(0, 5);
    return `<div class="dhead"><span class="code">${esc(c.sym)}</span><span class="nm"><i class="ft-dot" style="background:${subCol(c.sub)}"></i>${esc(subName(c.sub))}</span></div>
      <h1>${esc(c.name || c.sym)}</h1>
      <p class="ft-big">${px(c.price)} <span class="${cls(c.d1)}">${pct(c.d1)}</span> <span class="dim">today</span></p>
      <dl class="kv ft-kv">
        <dt>Market value</dt><dd>${money(c.cap)}</dd>
        <dt>In its sub-sector</dt><dd>${rank ? `#${rank} of ${peers.length} by value · ${subCap ? ((c.cap / subCap) * 100).toFixed(1) : "—"}% of ${esc(subName(c.sub))}` : "—"}</dd>
        <dt>Of all fintech</dt><dd>${d.total && c.cap ? ((c.cap / d.total) * 100).toFixed(2) + "%" : "—"}</dd>
      </dl>
      <table class="ft-ret"><tr class="hd"><th></th><th>${esc(c.sym)}</th><th>Fintech</th><th>S&amp;P 500</th></tr>${rets}</table>
      <div class="openrow ft-open"><button type="button" class="open" data-inst="${esc(c.sym)}">Chart <span>›</span></button>
        ${window.WireCompanyPage?.open ? `<button type="button" class="ft-btn" data-cop="${esc(c.sym)}">Company page</button>` : ""}
        <button type="button" class="ft-btn" data-watch="${esc(c.sym)}"${watched ? " disabled" : ""}>${watched ? "On watchlist ✓" : "+ Watchlist"}</button></div>
      ${dl.length ? `<div class="isec">DEALS</div>${dl.map((x) => `<button type="button" class="ft-pl" data-deal="${esc(x.id)}"><b>${esc(x.target.name)}</b><span>${day(x.date)} · ${x.value != null ? money(x.value) : "size not disclosed"}</span></button>`).join("")}` : ""}
      ${nw.length ? `<div class="isec">IN THE NEWS</div>${nw.map((s) => `<button type="button" class="ft-pl" data-story="${esc(s.id)}"><b>${esc(s.title)}</b><span>${esc(s.code || s.publisher || "")} · ${ago(s.updated || s.ts)} ago</span></button>`).join("")}` : ""}`;
  }
  function subPane(x) {
    const d = D(), p = P.period, st = per(p).subs.find((y) => y.id === x.id) || {}, members = d.cos.filter((c) => c.sub === x.id);
    const cap = members.reduce((a, c) => a + (c.cap > 0 ? c.cap : 0), 0), sel = P.sel?.k === "co" ? P.sel.id : null;
    return `<div class="dhead"><span class="code"><i class="ft-dot" style="background:${subCol(x.id)}"></i>${esc(x.id.toUpperCase())}</span><span class="nm">${members.length} companies · ${money(cap)} · ${d.total ? ((cap / d.total) * 100).toFixed(1) : "—"}% of fintech</span></div>
      <h1>${esc(x.name)}</h1>${x.blurb ? `<p class="ft-blurb">${esc(x.blurb)}</p>` : ""}
      ${hasPrices() ? `<p class="ft-big"><span class="${cls(st.ret)}">${pct(st.ret)}</span> <span class="dim">${esc(WORDS[p])} · equal-weighted median ${pct(st.eqRet)}</span></p>` : ""}
      <div class="isec">COMPANIES · ${esc(p)} RETURN</div>
      ${rowsPane(order(x.id).map((c) => ({ attr: "data-co", key: c.sym, label: c.sym, sub: c.name, v: coRet(c.sym, p), cap: c.cap, sel: c.sym === sel })))}
      <p class="ft-pnote">↑↓ move through these companies · ↵ opens the chart · Esc goes back to every sub-sector.</p>`;
  }
  function dealPane(x) {
    const tk = x.target.tickers?.[0], a = x.acquirers || [];
    const buyers = a.length ? a.slice(0, 4).map((b) => `<div>${esc(b.name)}${b.tickers?.[0] ? ` <button type="button" class="ft-tk" data-inst="${esc(b.tickers[0])}">${esc(b.tickers[0])}</button>` : ""}</div>`).join("") : '<span class="dim">Not named on the filing cover</span>';
    return `<div class="dhead">${tk ? `<span class="code">${esc(tk)}</span>` : ""}<span class="nm">${esc(x.type || "")} · <i class="ft-dot" style="background:${subCol(x.sub)}"></i>${esc(subName(x.sub))}</span></div>
      <h1>${esc(x.target.name)}</h1>
      <p class="ft-big">${x.value != null ? money(x.value) : '<span class="dim">Size not disclosed</span>'}${x.price != null ? ` <span class="dim">${px(x.price)} a share</span>` : ""}</p>
      <dl class="kv ft-kv">
        <dt>Buyer${a.length > 1 ? "s" : ""}</dt><dd>${buyers}</dd>
        <dt>Why fintech</dt><dd>${esc(x.why || "")}</dd>
        <dt>Type</dt><dd>${esc(x.type || "—")}</dd>
        <dt>Stage</dt><dd>${esc(x.stage || "—")}<div class="dim">${x.active ? "In progress: a filing in the last 90 days" : "No new filing for 90 days: completed or abandoned"}</div></dd>
        <dt>Industry</dt><dd>${esc(x.industry || "—")}</dd>
        <dt>First filing</dt><dd>${day(x.date)}</dd>
        <dt>Latest filing</dt><dd>${day(x.lastDate)}</dd>
      </dl>
      <div class="openrow ft-open">${tk ? `<button type="button" class="open" data-inst="${esc(tk)}">Chart ${esc(tk)} <span>›</span></button>` : ""}<button type="button" class="ft-btn" data-goto="mna">M&amp;A page ›</button></div>
      <div class="isec">FILINGS · NEWEST FIRST</div>
      ${(x.filings || []).map((f) => `<button type="button" class="ft-pl ft-fil" data-url="${esc(f.url)}" title="Open on sec.gov"><b>${esc(f.form)}</b><span>${day(f.date)} ↗</span></button>`).join("") || '<p class="ft-pnote">No filings listed.</p>'}`;
  }
  function storyPane(s) {
    const themes = (s.themes || []).map((t) => themeOf(t)?.name || t?.name || t).filter(Boolean);
    return `<div class="dhead"><span class="code">${esc(s.code || "")}</span><span class="nm">${esc(s.publisher || "")}</span><span class="dt">${esc(new Date(s.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</span></div>
      <h1>${esc(s.title)}</h1>
      ${s.summary ? `<p>${esc(s.summary)}</p>` : `<p class="ft-pnote ft-mb">The feed carries no summary for this story. Open it for the full text.</p>`}
      <dl class="kv ft-kv">
        ${s.tickers?.length ? `<dt>Companies</dt><dd>${s.tickers.map((t) => `<button type="button" class="ft-tk" data-co="${esc(t)}">${esc(t)}</button>`).join(" ")}</dd>` : ""}
        ${themes.length ? `<dt>Themes</dt><dd>${themes.map(esc).join(" · ")}</dd>` : ""}
        <dt>Coverage</dt><dd>${(s.sources || []).length || 1} outlet${(s.sources || []).length > 1 ? "s" : ""}</dd>
      </dl>
      <div class="openrow ft-open"><button type="button" class="open" data-url="${esc(s.link)}" title="${esc(s.link)}">Open story <span>›</span></button>${api?.showStory ? `<button type="button" class="ft-btn" data-shownews="${esc(s.id)}">Show in News</button>` : ""}</div>`;
  }
  /** A sub-sector's companies best to worst for the period (the order ↑↓ walk). */
  const order = (id) => D().cos.filter((c) => c.sub === id).sort((a, b) => (coRet(b.sym, P.period) ?? -1e9) - (coRet(a.sym, P.period) ?? -1e9) || (b.cap || 0) - (a.cap || 0));

  // ---------- page ----------
  function render() {
    if (!P.active) return;
    const s = P.snap;
    if (!S || !T) return state(window.WireUI.error("The fintech page's scripts didn't load.", ""));
    if (!s) return state(P.err ? window.WireUI.error(P.err, "data-ref") : window.WireUI.skeleton("tiles", { n: 24, label: "Loading fintech companies…" }));
    if (!s.companies?.length) {
      if (s.error && !s.loading) return state(window.WireUI.error(s.error, "data-ref"));
      return state(window.WireUI.skeleton("tiles", { n: 24, label: s.progress != null ? `Loading fintech prices · ${Math.round(s.progress * 100)}%` : "Loading fintech companies and prices…" }));
    }
    shell();
    const p = chartP();
    P.lastW = $("#fintech").clientWidth;
    put("bar", bar());
    put("tiles", tiles());
    put("trendsub", `growth of $100 ${P.period === "1D" ? "over the past week" : esc(WORDS[p])} against the S&P 500 and financials`);
    put("trend", trend());
    put("multi", multi());
    put("tree", tree());
    put("subt", subt());
    put("leadsub", `the five biggest moves ${esc(WORDS[P.period])}`);
    put("leaders", leaders());
    put("mna", mna());
    put("news", newsR());
  }
  function renderDetail(force) {
    if (!P.active || window.WireInstrument?.isOpen()) return;
    const el = $("#fintechdetail"), html = detail();
    if (!el || (!force && html === P.detailHTML)) return;
    el.innerHTML = html; P.detailHTML = html;
  }
  function apply(snap) {
    if (!snap) return;
    P.snap = snap; P.err = null;
    const d = D();
    window.WireChrome?.pulled("fintech", snap.fetchedAt || null);
    window.WireChrome?.status("fintech", snap.loading && !hasPrices() ? `LOADING${snap.progress != null ? ` ${Math.round(snap.progress * 100)}%` : ""}` : `${d.cos.length} COMPANIES · ${money(d.total)}${snap.loading ? " · UPDATING" : ""}`);
    if (P.zoom && !d.byId.has(P.zoom)) P.zoom = null;
    render(); renderDetail();
  }
  function applyMna(m) { if (!m) return; P.mna = m; if (P.active) { put("mna", mna()); renderDetail(); } }
  function fail(e) { P.err = String(e?.message || e || "Couldn't load fintech data"); if (!P.snap) { render(); renderDetail(); } }
  function refresh() {
    if (P.snap) { P.snap = { ...P.snap, loading: true }; render(); }
    api.page.invoke("fintech:refresh").then(apply, fail);
  }
  function setPeriod(p) {
    if (!PERIODS.includes(p) || p === P.period) return;
    P.period = p; save("period", p); hideTip();
    render(); renderDetail();
  }

  // ---------- selection ----------
  /** Select something for the right pane and mark it on the page in place (no redraw of the charts). */
  function select(k, id, keep) {
    P.sel = !keep && P.sel?.k === k && P.sel.id === id ? null : id == null ? null : { k, id };
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    const root = $("#fintech");
    root.querySelectorAll('[aria-selected="true"]').forEach((r) => r.setAttribute("aria-selected", "false"));
    root.querySelectorAll(".ft-cell.sel").forEach((r) => r.classList.remove("sel"));
    root.querySelectorAll('.ft-sm[aria-pressed="true"],.ft-lr[aria-pressed="true"]').forEach((r) => r.setAttribute("aria-pressed", "false"));
    if (P.sel) {
      const q = CSS.escape(P.sel.id);
      const attr = { co: "data-sym", sub: "data-sub", deal: "data-deal", story: "data-story" }[k];
      root.querySelectorAll(`[role="row"][${attr}="${q}"]`).forEach((r) => { r.setAttribute("aria-selected", "true"); r.scrollIntoView({ block: "nearest" }); });
      if (k === "co") { root.querySelectorAll(`.ft-cell[data-sym="${q}"]`).forEach((r) => r.classList.add("sel")); root.querySelectorAll(`.ft-lr[data-co="${q}"]`).forEach((r) => r.setAttribute("aria-pressed", "true")); }
      if (k === "sub") root.querySelectorAll(`.ft-sm[data-sub="${q}"]`).forEach((r) => r.setAttribute("aria-pressed", "true"));
    }
    renderDetail();
    $("#fintechdetail .ft-prr.sel")?.scrollIntoView({ block: "nearest" });
  }
  /** Open a sub-sector: the treemap zooms into it and the right pane lists its companies. */
  function openSub(id, toggle) {
    if (toggle && P.zoom === id && P.sel?.k === "sub" && P.sel.id === id) return zoomOut();
    P.zoom = id; hideTip();
    put("tree", tree());
    select("sub", id, true);
  }
  function zoomOut() {
    P.zoom = null; hideTip();
    put("tree", tree());
    select(null, null);
  }
  /** A company: when it's in the open sub-sector it is marked there; otherwise the right pane shows it. */
  function selectCo(sym) {
    if (!D().bySym.has(sym)) return window.WireApp.openInstrument(sym); // a ticker outside the universe (a buyer, a headline)
    select("co", sym, true);
  }
  function move(step) {
    if (!P.snap?.companies?.length) return;
    const sel = P.sel, d = D();
    // inside a sub-sector (zoomed, or one of its companies picked) ↑↓ walk its companies
    const subId = P.zoom || (sel?.k === "co" ? d.bySym.get(sel.id)?.sub : null);
    if (subId && (P.zoom || sel?.k === "co")) {
      const list = order(subId), i = sel?.k === "co" ? list.findIndex((c) => c.sym === sel.id) : -1;
      if (!list.length) return;
      return select("co", list[i < 0 ? (step > 0 ? 0 : list.length - 1) : clamp(i + step, 0, list.length - 1)].sym, true);
    }
    if (sel?.k === "deal") { const list = deals().slice(0, 25), i = list.findIndex((x) => x.id === sel.id); if (list.length) return select("deal", list[clamp(i + step, 0, list.length - 1)].id, true); }
    if (sel?.k === "story") { const N = news(), list = (P.theme ? N.list.filter((s) => hasTheme(s, P.theme)) : N.list).slice(0, 20), i = list.findIndex((x) => x.id === sel.id); if (list.length) return select("story", list[clamp(i + step, 0, list.length - 1)].id, true); }
    const subs = d.subs, i = sel?.k === "sub" ? subs.findIndex((x) => x.id === sel.id) : -1;
    if (!subs.length) return;
    select("sub", subs[i < 0 ? (step > 0 ? 0 : subs.length - 1) : clamp(i + step, 0, subs.length - 1)].id, true);
  }
  function enter() {
    const sel = P.sel;
    if (!sel) return;
    if (sel.k === "co") window.WireApp.openInstrument(sel.id);
    else if (sel.k === "sub") { if (P.zoom !== sel.id) openSub(sel.id); else { const first = order(sel.id)[0]; if (first) select("co", first.sym, true); } }
    else if (sel.k === "deal") { const x = deals().find((y) => y.id === sel.id), tk = x?.target.tickers?.[0]; if (tk) window.WireApp.openInstrument(tk); else if (x?.filings?.[0]) api.open?.(x.filings[0].url); }
    else if (sel.k === "story") { const x = news().list.find((y) => y.id === sel.id); if (x?.link) api.open?.(x.link); }
  }
  function back() {
    if (P.sel?.k === "co" && P.zoom) return select("sub", P.zoom, true);
    if (P.zoom) return zoomOut();
    if (P.sel) select(null, null);
  }

  // ---------- tooltip and crosshair ----------
  function tipAt(e, html) {
    const tip = $("#fintech .ft-tip"), box = $("#fintech .ft");
    if (!tip || !box) return;
    if (!html) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    const b = box.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(b.width - w - 4, x + 14)) + "px";
    tip.style.top = Math.max(4, y - h - 12 < 4 ? y + 18 : y - h - 12) + "px";
  }
  function hideTip() { const t = $("#fintech .ft-tip"); if (t) t.hidden = true; const c = $("#fintech .ft-cross"); if (c) c.innerHTML = ""; }
  function cross(e, hit) {
    const t = P.tips.trend, svg = hit.ownerSVGElement;
    if (!t || !svg) return;
    const r = svg.getBoundingClientRect(), sx = (svg.viewBox.baseVal.width || r.width) / r.width;
    const x = (e.clientX - r.left) * sx, i = clamp(Math.round(((x - t.pl) / t.pw) * (t.n - 1)), 0, t.n - 1), X = t.X(i);
    let g = `<line x1="${X.toFixed(1)}" x2="${X.toFixed(1)}" y1="${t.pt}" y2="${t.pt + t.ph}" class="ft-xh"/>`;
    const rows = [];
    t.on.forEach((l, k) => { const v = t.val[k][i]; if (v == null) return; g += `<circle cx="${X.toFixed(1)}" cy="${t.Y(v).toFixed(1)}" r="3.2" fill="${l.color}" class="ft-xd"/>`; rows.push([l, v]); });
    svg.querySelector(".ft-cross").innerHTML = g;
    rows.sort((a, b) => b[1] - a[1]);
    tipAt(e, `<b>${day(t.dates[i])}</b>${rows.map(([l, v]) => `<div class="ft-tl"><i class="ft-sw${l.dash ? " dash" : ""}" style="--c:${l.color}"></i>${esc(l.label)}<b class="${cls(v - 100)}">${pct(v - 100)}</b></div>`).join("")}`);
  }

  // ---------- events ----------
  /** The nearest element matching `sel` from the event target, but only inside this page's own areas: the app's
      wrappers carry data attributes too (data-page on #app, data-theme on <html>). */
  const at = (e, sel) => { const el = e.target?.closest?.(sel); return el && (root.contains(el) || pane.contains(el)) ? el : null; };
  /** Clicks shared by the page and the right pane. */
  function common(e) {
    const inst = at(e, "[data-inst]"); if (inst) { window.WireApp.openInstrument(inst.dataset.inst); return true; }
    const co = at(e, "[data-co]"); if (co) { selectCo(co.dataset.co); return true; }
    const u = at(e, "[data-url]"); if (u) { api.open?.(u.dataset.url); return true; }
    const pg = at(e, "[data-goto]"); if (pg) { window.WireApp.setPage(pg.dataset.goto); return true; }
    const dl = at(e, "[data-deal]"); if (dl) { select("deal", dl.dataset.deal, true); return true; }
    const st = at(e, "[data-story]"); if (st) { select("story", st.dataset.story, true); return true; }
    const ref = at(e, "[data-ref]"); if (ref) { refresh(); return true; }
    return false;
  }
  const root = $("#fintech"), pane = $("#fintechdetail");
  if (!root || !pane) { console.warn("Fintech page: #fintech or #fintechdetail is missing from index.html"); return; }
  root.addEventListener("click", (e) => {
    if (common(e)) return;
    const pr = at(e, "[data-per]"); if (pr) return setPeriod(pr.dataset.per);
    const ln = at(e, "[data-line]");
    if (ln) {
      const k = ln.dataset.line, l = trendLines().find((x) => x.key === k);
      if (l?.etf) P.etf = lineOn(l) ? "__none" : k; else { P.lines[k] = P.lines[k] === false; save("lines", P.lines); }
      hideTip(); return put("trend", trend());
    }
    const dm = at(e, "[data-dmode]"); if (dm) { P.dealMode = dm.dataset.dmode; save("dealmode", P.dealMode); return put("mna", mna()); }
    const th = at(e, "[data-ntheme]"); if (th) { P.theme = P.theme === th.dataset.ntheme ? "" : th.dataset.ntheme; return put("news", newsR()); }
    if (at(e, "[data-up]")) return zoomOut();
    if (at(e, "[data-mnaref]")) { api.page.invoke("mna:refresh").then(applyMna, () => {}); return; }
    const cell = at(e, ".ft-cell[data-sym]");
    if (cell) {
      // at the top level a click opens the cell's sub-sector; inside one it picks the company
      if (!P.zoom) return openSub(cell.closest("[data-sub]")?.dataset.sub || D().bySym.get(cell.dataset.sym)?.sub);
      return select("co", cell.dataset.sym);
    }
    const sb = at(e, "[data-sub]"); if (sb) return openSub(sb.dataset.sub, true);
  });
  root.addEventListener("dblclick", (e) => {
    const cell = at(e, ".ft-cell[data-sym]"); if (cell) return window.WireApp.openInstrument(cell.dataset.sym);
    const st = at(e, "[data-story]"); if (st) { const x = news().list.find((y) => y.id === st.dataset.story); if (x?.link) api.open?.(x.link); }
  });
  root.addEventListener("mousemove", (e) => {
    const hit = at(e, "[data-hit='trend']"); if (hit) return cross(e, hit);
    const c = $("#fintech .ft-cross"); if (c && c.innerHTML) c.innerHTML = "";
    const t = at(e, "[data-tip]");
    if (!t) return tipAt(e, null);
    tipAt(e, t.dataset.tip === "tree" ? P.tips.tree?.[t.dataset.sym] : t.dataset.tip === "q" ? P.tips.q?.[t.dataset.q] : null);
  });
  root.addEventListener("mouseleave", hideTip);
  pane.addEventListener("click", async (e) => {
    if (window.WireInstrument?.isOpen()) return; // the chart handles its own clicks
    if (common(e)) return;
    const sb = at(e, "[data-sub]"); if (sb) return openSub(sb.dataset.sub);
    const cp = at(e, "[data-cop]"); if (cp) return window.WireCompanyPage?.open(cp.dataset.cop);
    const sn = at(e, "[data-shownews]"); if (sn) return api.showStory?.(sn.dataset.shownews);
    const w = at(e, "[data-watch]");
    if (w) {
      w.disabled = true; w.textContent = "Adding…";
      const r = await api.addWatch?.(w.dataset.watch).catch(() => null);
      w.textContent = r?.ok ? "On watchlist ✓" : r?.error || "Couldn't add";
      if (!r?.ok) w.disabled = false;
    }
  });
  // redraw the charts at the new width when the window or the right pane is resized
  new ResizeObserver(() => { const w = root.clientWidth; if (P.active && P.snap && w && Math.abs(w - P.lastW) > 24) { hideTip(); render(); } }).observe(root);
  // the treemap colors depend on the theme
  new MutationObserver(() => { P.cache.tree = null; if (P.active) render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (api?.page) { api.page.on("fintech:update", apply); api.page.on("mna:update", applyMna); }
  // headlines: re-read the feed whenever the news updates (app.js stores it first; it registered its listener earlier)
  api?.onNews?.(() => setTimeout(() => { if (P.active && P.snap?.companies?.length) { put("news", newsR()); renderDetail(); } }, 0));

  (window.WirePages ||= {}).fintech = {
    show() {
      P.active = true; render(); renderDetail(true);
      api.page.invoke("fintech:get").then(apply, fail);
      api.page.invoke("mna:get").then(applyMna, () => {});
    },
    hide() { P.active = false; hideTip(); },
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const n = +e.key;
      if (n >= 1 && n <= PERIODS.length && /^\d$/.test(e.key)) { e.preventDefault(); setPeriod(PERIODS[n - 1]); }
      else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        // the page's own controls keep Enter; anywhere else it opens the selection
        if (at(e, "[data-per],[data-ref],[data-line],[data-ntheme],[data-dmode],[data-up],[data-watch],[data-goto]")) return;
        e.preventDefault(); enter();
      }
      else if (e.key === "Escape") { e.preventDefault(); back(); }
      else if (e.key === "r" || e.key === "R") refresh();
    },
    restore() { renderDetail(true); },
    detail: () => $("#fintechdetail")
  };
})();
