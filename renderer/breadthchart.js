/* Markets page: the breadth section (window.TkBreadthChart), "how many companies are taking part".
   renderer/markets.js puts html() after the sector rotation chart on every render and calls show() when the page opens;
   this file owns the section's state, its hover and its controls (delegated on #markets), and redraws only its own
   section when the history arrives or the pane is resized. Data: the sector map's daily history (TkMapHistory);
   arithmetic: src/breadth.js (TkBreadth). Drawn as SVG at the card's real width. */
(() => {
  const BR = window.TkBreadth, HS = window.TkMapHistory;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const SPAN_WORDS = { "3M": "3 months", "6M": "6 months", "1Y": "the year" };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const C = { span: "6M", sector: "", visible: false, drawn: "", lastW: 0, cache: null, geo: null };
  try { const s = localStorage.getItem("wire.markets.brspan"); if (SPAN_WORDS[s]) C.span = s; } catch {}

  const dateOf = (d) => new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100));
  const dayLabel = (d, dow) => { const x = dateOf(d); return `${dow ? DOW[x.getUTCDay()] + " " : ""}${MON[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`; };
  const pc = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const spc = (v) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%`);
  const pts = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)} pts`);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** Ribbon color for the 10-day share rising: deep red when few rise, gray near half, deep green when most do. */
  function ribbon(v) {
    if (v == null) return "rgb(30,34,41)";
    const n = clamp((v - 0.5) / 0.17, -1, 1), k = Math.abs(n) ** 0.85, base = [56, 61, 70], to = n >= 0 ? [31, 158, 96] : [205, 52, 58];
    return `rgb(${base.map((c, i) => Math.round(c + (to[i] - c) * k)).join(",")})`;
  }

  /** Breadth for the chosen sector, computed once per download and sector. */
  function current() {
    const H = HS.get();
    if (!HS.ready()) return null;
    if (C.cache?.P === H.P && C.cache.sector === C.sector) return C.cache;
    const syms = H.data.syms, idx = [], caps = [];
    syms.forEach((s, i) => { if (!C.sector || s.sector === C.sector) { idx.push(i); caps.push(s.cap); } });
    if (!idx.length) { C.sector = ""; return current(); }
    const b = BR.breadth(H.P, idx, caps);
    return (C.cache = { P: H.P, sector: C.sector, b, up10: BR.smooth(b.up, 10), n: idx.length });
  }

  function chartWidth() {
    const el = $("#mbreadth .br-chart");
    if (el?.clientWidth) return el.clientWidth;
    return Math.max(320, ($("#markets")?.clientWidth || 860) - 58); // section and card padding
  }

  function chart(cur, W) {
    const H = HS.get(), dates = H.data.dates, n = dates.length, s = BR.spanStart(n, C.span), N = n - 1 - s, b = cur.b;
    const gap = BR.gapSeries(b.ew, b.cw, s);
    const pl = 34, pr = 10, pt = 8, RH = 150, sp = 16, GH = 74, pb = 22, pw = W - pl - pr, Ht = pt + RH + sp + GH + pb;
    const cw = pw / N, X = (k) => pl + k * cw, Y = (v) => pt + (1 - v) * RH, g0 = pt + RH + sp;
    const gs = gap.slice(s + 1), gmax = Math.max(1, ...gs.map((v) => Math.abs(v ?? 0))) * 1.15, YG = (v) => g0 + GH / 2 - (v / gmax) * (GH / 2);
    let g = `<svg viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" class="br-svg" role="img" aria-label="Market breadth by day">`;
    // the ribbon: one column per trading day, colored by the 10-day share rising
    g += `<g class="br-cols">`;
    for (let k = 0; k < N; k++) g += `<rect class="br-col" style="--d:${k}" x="${X(k).toFixed(2)}" y="${pt}" width="${(cw + 0.5).toFixed(2)}" height="${RH}" fill="${ribbon(cur.up10[s + 1 + k])}"/>`;
    g += `</g>`;
    for (const v of [0, 0.5, 1]) g += `<text x="${pl - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" class="br-ax">${v * 100}%</text>`;
    g += `<rect x="${pl}" y="${Y(0.7).toFixed(1)}" width="${pw}" height="${(Y(0.3) - Y(0.7)).toFixed(1)}" class="br-band"/>`;
    for (const v of [0.3, 0.7]) g += `<line x1="${pl}" x2="${pl + pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="br-lim"/>`;
    g += `<text x="${pl + 5}" y="${(Y(0.7) - 4).toFixed(1)}" class="br-zone">70% · STRETCHED</text><text x="${pl + 5}" y="${(Y(0.3) + 11).toFixed(1)}" class="br-zone">30% · WASHED OUT</text>`;
    // share above the 50-day average, broken where there is no reading
    const segs = []; let seg = [];
    for (let k = 0; k < N; k++) { const v = b.above[s + 1 + k]; if (v == null) { if (seg.length) segs.push(seg); seg = []; } else seg.push(`${(X(k) + cw / 2).toFixed(1)},${Y(v).toFixed(1)}`); }
    if (seg.length) segs.push(seg);
    for (const p of segs) if (p.length > 1) g += `<polyline points="${p.join(" ")}" class="br-halo"/><polyline points="${p.join(" ")}" class="br-line"/>`;
    // equal weight minus cap weight since the start of the span, filled by sign
    const gp = gs.map((v, k) => `${(X(k) + cw / 2).toFixed(1)},${YG(v ?? 0).toFixed(1)}`), z = YG(0);
    const area = `${(X(0) + cw / 2).toFixed(1)},${z.toFixed(1)} ${gp.join(" ")} ${(X(N - 1) + cw / 2).toFixed(1)},${z.toFixed(1)}`;
    g += `<defs><clipPath id="brUp"><rect x="${pl}" y="${g0}" width="${pw}" height="${(z - g0).toFixed(1)}"/></clipPath><clipPath id="brDn"><rect x="${pl}" y="${z.toFixed(1)}" width="${pw}" height="${(g0 + GH - z).toFixed(1)}"/></clipPath></defs>
      <rect x="${pl}" y="${g0}" width="${pw}" height="${GH}" class="br-gbox"/>
      <polygon points="${area}" class="br-broad" clip-path="url(#brUp)"/><polygon points="${area}" class="br-narrow" clip-path="url(#brDn)"/>
      <line x1="${pl}" x2="${pl + pw}" y1="${z.toFixed(1)}" y2="${z.toFixed(1)}" class="br-zero"/>
      <polyline points="${gp.join(" ")}" class="br-gline"/>
      <text x="${pl + 5}" y="${g0 + 11}" class="br-zone br-up">BROAD · THE AVERAGE STOCK IS AHEAD</text><text x="${pl + 5}" y="${g0 + GH - 5}" class="br-zone br-dn">NARROW · THE BIGGEST LEAD</text>
      <text x="${pl - 6}" y="${g0 + 9}" text-anchor="end" class="br-ax">+${gmax.toFixed(gmax < 10 ? 1 : 0)}</text><text x="${pl - 6}" y="${(z + 3).toFixed(1)}" text-anchor="end" class="br-ax">0</text><text x="${pl - 6}" y="${g0 + GH}" text-anchor="end" class="br-ax">−${gmax.toFixed(gmax < 10 ? 1 : 0)}</text>`;
    // a label at each month's first trading day
    let lastX = -99;
    for (let k = 1; k < N; k++) {
      const a = dates[s + k], d = dates[s + 1 + k];
      if (Math.floor(a / 100) === Math.floor(d / 100)) continue;
      const x = X(k) + cw / 2, mo = Math.floor(d / 100) % 100 - 1;
      if (x - lastX < 34 || x > pl + pw - 14) continue;
      lastX = x;
      g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${g0 + GH}" y2="${g0 + GH + 4}" class="br-tick"/><text x="${x.toFixed(1)}" y="${Ht - 6}" text-anchor="middle" class="br-ax${mo === 0 ? " strong" : ""}">${mo === 0 ? Math.floor(d / 10000) : MON[mo]}</text>`;
    }
    g += `<line class="br-x" x1="0" x2="0" y1="${pt}" y2="${g0 + GH}" visibility="hidden"/><circle class="br-xd" r="3.5" cx="0" cy="0" visibility="hidden"/><circle class="br-xg" r="3" cx="0" cy="0" visibility="hidden"/>
      <rect class="br-hit" x="${pl}" y="${pt}" width="${pw}" height="${g0 + GH - pt}"/></svg>`;
    C.geo = { W, s, N, pl, cw, Y, YG, gap, dates };
    return g;
  }

  function tiles(m) {
    const tile = (label, v, ago, fmt, help) => {
      const d = v == null || ago == null ? null : Math.round((v - ago) * 100);
      return `<div class="br-tile" title="${esc(help)}"><span class="br-tl">${label}</span><b>${fmt(v)}</b><span class="br-td ${d > 0 ? "up" : d < 0 ? "dn" : "dim"}">${d == null ? "" : d === 0 ? "unchanged in a month" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} pts in a month`}</span></div>`;
    };
    return `<div class="br-tiles">${tile("Rising today", m.up, m.upAgo, pc, "Share of companies that closed higher on the latest day")}
      ${tile("Above 50-day average", m.above, m.aboveAgo, pc, "Share of companies whose price is above its average of the last 50 trading days")}
      ${tile("New highs − new lows", m.hl, m.hlAgo, spc, "Companies at a new 20-day high minus those at a new 20-day low, as a share of all")}</div>`;
  }

  /** The whole section as HTML (markets.js calls this inside render()). */
  function html() {
    const H = HS?.get();
    if (!H) return "";
    const ready = HS.ready(), sectors = H.data?.sectors || [];
    const ctl = `<span class="mrange rot-tail br-ctl">${Object.keys(SPAN_WORDS).map((k) => `<button type="button" data-brspan="${k}" aria-pressed="${k === C.span}">${k}</button>`).join("")}
      <i class="cm-gap"></i><select class="br-sel" data-brsec aria-label="Sector"${ready ? "" : " disabled"}><option value="">All sectors</option>${sectors.map((s) => `<option value="${esc(s.id)}"${s.id === C.sector ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></span>`;
    const head = `<h3>Breadth · how many companies are taking part${ctl}</h3>`;
    if (!ready) {
      const n = H.data?.syms?.length || 440, st = H.status;
      const body = st.error && !st.loading ? window.WireUI.error(`Couldn't download the price history: ${st.error}`, "data-brretry")
        : window.WireUI.skeleton("chart", { label: `Downloading a year of prices for ${n} companies…${st.progress ? ` ${Math.round(st.progress * 100)}%` : ""}` });
      return `<section class="msec" id="mbreadth">${head}<div class="rot br-wait">${body}</div></section>`;
    }
    const cur = current(), W = Math.round(chartWidth()), key = `${C.span}|${C.sector}`, anim = C.drawn !== key;
    C.drawn = key; C.lastW = W;
    const m = BR.summarize(cur.b, BR.spanStart(H.data.dates.length, C.span)), scope = C.sector ? sectors.find((s) => s.id === C.sector)?.name || C.sector : "";
    const asOf = H.data.dates[H.data.dates.length - 1];
    return `<section class="msec" id="mbreadth">${head}
      <div class="rot br"><div class="br-chart${anim ? " br-anim" : ""}">${chart(cur, W)}<div class="br-tip" hidden></div></div>
        <div class="br-key"><span><i class="br-k ribbon"></i>Columns: share of companies rising, 10-day average (red few · gray about half · green most)</span><span><i class="br-k line"></i>Share above their 50-day average</span><span><i class="br-k gap"></i>Below: average stock minus the index since ${esc(dayLabel(H.data.dates[BR.spanStart(H.data.dates.length, C.span)]))}</span></div>
        <div class="br-side">${tiles(m)}
          <p class="br-read">${esc(BR.readingText(m, SPAN_WORDS[C.span], scope))}</p>
          <p class="dim br-how">${cur.n} ${scope ? esc(scope) + " " : ""}companies: the largest in each sector on the Sector map, closes to ${esc(dayLabel(asOf))}${H.status.loading ? " (updating…)" : ""}. "The index" weights each by its market value, so a few giants move it; the average stock gives each the same weight. Above zero in the lower chart the average stock is beating the index (a broad move); below zero a few big names are carrying it. Above 70% on the line the market is stretched, below 30% washed out: both tend not to last.</p></div></div></section>`;
  }

  /** Redraw just this section (history arrived, a control changed, the pane was resized). */
  function refresh() {
    if (!C.visible) return;
    const el = $("#mbreadth");
    if (el) el.outerHTML = html();
  }

  function hover(e) {
    const svg = e.target.closest?.(".br-svg"), G = C.geo;
    const tip = $("#mbreadth .br-tip");
    const hideAll = () => { if (tip) tip.hidden = true; $("#mbreadth")?.querySelectorAll(".br-x,.br-xd,.br-xg").forEach((x) => x.setAttribute("visibility", "hidden")); };
    if (!svg || !G || !tip) return hideAll();
    const r = svg.getBoundingClientRect(), sc = r.width / G.W, x = (e.clientX - r.left) / sc;
    const k = Math.floor((x - G.pl) / G.cw);
    if (k < 0 || k >= G.N) return hideAll();
    const cur = current(), i = G.s + 1 + k, b = cur.b, cx = G.pl + k * G.cw + G.cw / 2;
    const ln = svg.querySelector(".br-x"), d1 = svg.querySelector(".br-xd"), d2 = svg.querySelector(".br-xg");
    ln.setAttribute("x1", cx); ln.setAttribute("x2", cx); ln.setAttribute("visibility", "visible");
    if (b.above[i] != null) { d1.setAttribute("cx", cx); d1.setAttribute("cy", G.Y(b.above[i])); d1.setAttribute("visibility", "visible"); } else d1.setAttribute("visibility", "hidden");
    const gv = G.gap[i];
    if (gv != null) { d2.setAttribute("cx", cx); d2.setAttribute("cy", G.YG(gv)); d2.setAttribute("visibility", "visible"); } else d2.setAttribute("visibility", "hidden");
    tip.innerHTML = `<b>${esc(dayLabel(G.dates[i], true))}</b>
      <div><span>Rose that day</span><b>${pc(b.up[i])}</b></div>
      <div><span>Rising, 10-day average</span><b>${pc(cur.up10[i])}</b></div>
      <div><span>Above 50-day average</span><b>${pc(b.above[i])}</b></div>
      <div><span>New highs − new lows</span><b>${spc(b.hl[i])}</b></div>
      <div><span>Average stock vs index</span><b class="${gv > 0 ? "up" : gv < 0 ? "dn" : ""}">${pts(gv)}</b></div>
      <div class="dim">since ${esc(dayLabel(G.dates[G.s]))}</div>`;
    tip.hidden = false;
    const box = tip.parentElement.getBoundingClientRect(), tw = tip.offsetWidth, px = cx * sc;
    tip.style.left = (px + 14 + tw > box.width ? px - tw - 14 : px + 14) + "px";
    tip.style.top = "6px";
  }

  function bind() {
    const root = $("#markets");
    if (!root) return;
    root.addEventListener("click", (e) => {
      const sp = e.target.closest("[data-brspan]");
      if (sp) { C.span = sp.dataset.brspan; try { localStorage.setItem("wire.markets.brspan", C.span); } catch {} return refresh(); }
      if (e.target.closest("[data-brretry]")) { HS.want(); return; }
    });
    root.addEventListener("change", (e) => { const sel = e.target.closest("[data-brsec]"); if (sel) { C.sector = sel.value; refresh(); } });
    root.addEventListener("mousemove", (e) => { if (e.target.closest?.("#mbreadth")) hover(e); });
    root.addEventListener("mouseleave", () => hover({ target: root }));
    root.addEventListener("mouseout", (e) => { if (e.target.closest?.(".br-svg") && !e.relatedTarget?.closest?.(".br-svg")) hover({ target: root }); });
    // redraw at the new width when the pane is resized
    new ResizeObserver(() => { if (C.visible && HS.ready() && Math.abs(chartWidth() - C.lastW) > 24) refresh(); }).observe(root);
    HS.on(() => refresh());
  }
  bind();

  window.TkBreadthChart = {
    html,
    show() { C.visible = true; HS.want(); },
    hide() { C.visible = false; }
  };
})();
