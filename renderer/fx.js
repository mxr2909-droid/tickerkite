/* Tickerkite Currencies page. Registers with app.js through window.WirePages (see the "pages" section there).
   The dollar and 17 currencies against it: a strength table, plain-language megatrend cards, and a compare chart for any two
   currencies (the cross rate, or both rebased to 100). src/fx.js fetches the series from Yahoo and does the maths. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const F = { active: false, data: null, a: "EUR", b: "USD", range: "5Y", mode: "cross", cmp: null, seq: 0 };
  try { Object.assign(F, JSON.parse(localStorage.getItem("wire.fx") || "{}")); } catch {}
  const save = () => { try { localStorage.setItem("wire.fx", JSON.stringify({ a: F.a, b: F.b, range: F.range, mode: F.mode })); } catch {} };
  const RANGES = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y", "MAX"];
  const COLS = ["1D", "1W", "1M", "3M", "YTD", "1Y"];

  const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%");
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const px = (v) => (v == null ? "—" : v >= 100 ? v.toFixed(2) : v >= 10 ? v.toFixed(3) : v >= 1 ? v.toFixed(4) : v.toFixed(5));
  const date = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const names = () => Object.fromEntries((F.data?.currencies || []).map(([c, n]) => [c, n]));
  const chartW = () => Math.max(300, Math.min(1050, ($("#fx").clientWidth || 800) - 48 - 28 - 30));
  let lastW = 0;
  new ResizeObserver(() => { const w = chartW(); if (F.active && F.cmp && Math.abs(w - lastW) > 30) { lastW = w; renderChart(); } }).observe($("#fx"));

  function spark(vals, up) {
    if (!vals || vals.length < 2) return "";
    const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
    const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 100).toFixed(1)},${(13 - ((v - lo) / r) * 12).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 100 14" preserveAspectRatio="none" class="fx-sp"><polyline points="${pts}" fill="none" stroke="${up ? "var(--up,#3ecf8e)" : "var(--down,#f2706b)"}" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function tableRow(r, isIdx) {
    const sel = r.code === F.a || r.code === F.b;
    const cell = (v) => `<td class="${cls(v)}">${pct(v, Math.abs(v ?? 0) >= 10 ? 0 : 1)}</td>`;
    return `<tr data-c="${esc(r.code)}"${isIdx ? ' data-idx="1"' : ""} class="${sel && !isIdx ? "sel" : ""}" tabindex="0" title="${esc(r.name)}${isIdx ? "" : ": click to chart against the compare partner"}">
      <td><b>${esc(r.code)}</b> <span class="dim">${esc(isIdx ? "dollar vs a basket" : r.name)}</span></td>
      <td class="num">${isIdx ? "" : `<span class="dim">${esc(r.quote)}</span> `}<b>${px(r.quoteLast)}</b></td>
      ${COLS.map((k) => cell(r.ret[k])).join("")}${cell(r.ann?.["5Y"])}${cell(r.ann?.["10Y"])}
      <td class="${cls(r.vsMa200)}" title="Distance from the 200-day average">${pct(r.vsMa200)}</td>
      <td>${spark(r.spark, (r.ret["1Y"] ?? 0) >= 0)}</td></tr>`;
  }

  function opts(sel) { return (F.data?.currencies || []).map(([c, n]) => `<option value="${c}"${c === sel ? " selected" : ""}>${c} · ${esc(n)}</option>`).join(""); }

  function render() {
    if (!F.active) return;
    const el = $("#fx"), d = F.data;
    if (!d) { el.innerHTML = window.WireUI.skeleton("chart", { label: "Loading currencies…" }); return; }
    if (d.empty) { el.innerHTML = d.error ? window.WireUI.error(`Currency data didn't download (${d.error}).`, "data-ref") : window.WireUI.skeleton("chart", { label: "Loading currencies…" }); return; }
    const mega = d.megatrends.map((m) => `<div class="fx-mc ${m.tone}"><b>${esc(m.title)}</b><p>${esc(m.text)}</p></div>`).join("");
    const rows = (d.dxy ? tableRow(d.dxy, true) : "") + d.rows.map((r) => tableRow(r, false)).join("");
    el.innerHTML = `<div class="yc fx">
      <div class="yc-head"><div><h2>Currencies</h2><p class="dim">Against the US dollar · Yahoo Finance, delayed${d.error ? ` · <span class="dn">${esc(d.error)}</span>` : ""}</p></div>
        <div class="yc-togs"><button type="button" class="yc-btn" data-ref title="Refresh (R)">↻</button></div></div>
      <div class="fx-mega">${mega}</div>
      <div class="yc-card" id="fxCompare">
        <div class="yc-ct fx-ct"><b>Compare</b>
          <select id="fxA" aria-label="First currency">${opts(F.a)}</select>
          <button type="button" class="yc-btn" id="fxSwap" title="Swap the two currencies" aria-label="Swap currencies">⇄</button>
          <select id="fxB" aria-label="Second currency">${opts(F.b)}</select>
          <span class="yc-spans">${RANGES.map((s) => `<button type="button" data-range="${s}" aria-pressed="${s === F.range}">${s}</button>`).join("")}</span>
          <span class="yc-spans"><button type="button" data-mode="cross" aria-pressed="${F.mode === "cross"}" title="How much of B one A buys">Cross rate</button><button type="button" data-mode="idx" aria-pressed="${F.mode === "idx"}" title="Both currencies against the dollar, rebased to 100 at the start">Both vs USD</button></span></div>
        <div class="fx-read dim num" id="fxRead">&nbsp;</div>
        <div id="fxChart"></div></div>
      <div class="yc-card"><div class="yc-ct"><b>Every currency against the dollar</b><span class="dim">up = stronger than the dollar (the DXY row is the opposite: up = dollar stronger) · 5Y and 10Y are per year</span></div>
        <div class="fx-wrap"><table class="yc-tab fx-tab num"><thead><tr><th>Currency</th><th>Rate</th>${COLS.map((k) => `<th>${k}</th>`).join("")}<th>5Y/yr</th><th>10Y/yr</th><th>vs 200d</th><th>1Y</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <p class="yc-src">Source: Yahoo Finance daily and weekly closes (unofficial, delayed). Cross rates are computed from each currency's dollar rate. Weekend and holiday gaps are carried forward.</p></div>`;
    renderChart();
  }

  function renderChart() {
    const box = $("#fxChart"); if (!box) return;
    const c = F.cmp;
    if (!c) { box.innerHTML = window.WireUI.skeleton("chart", { label: "Loading chart…" }); return; }
    if (c.none) { box.innerHTML = `<p class="dim fx-none">No data for that pair yet. Pick two different currencies.</p>`; return; }
    const W = chartW(), H = 300, pl = 8, pr = 58, pt = 12, pb = 26;
    const rows = F.mode === "idx" ? c.idx : c.pts;
    if (rows.length < 3) { box.innerHTML = `<p class="dim fx-none">Not enough history for this range.</p>`; return; }
    const lines = F.mode === "idx" ? [[1, "var(--accent)", c.a], [2, "#7cc4f5", c.b]] : [[1, "var(--accent)", `${c.a}/${c.b}`]];
    const vals = rows.flatMap((r) => lines.map(([k]) => r[k]));
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.08 || 0.01; lo -= pad; hi += pad;
    const t0 = rows[0][0], t1 = rows[rows.length - 1][0];
    const X = (t) => pl + ((t - t0) / (t1 - t0 || 1)) * (W - pl - pr), Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    let g = `<svg viewBox="0 0 ${W} ${H}" class="yc-svg fx-svg" role="img" aria-label="${esc(c.a)} against ${esc(c.b)}">`;
    const n = 5;
    for (let i = 0; i <= n; i++) { const v = lo + ((hi - lo) * i) / n; g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="yc-grid"/><text x="${W - pr + 6}" y="${Y(v) + 3}" class="yc-ax">${F.mode === "idx" ? v.toFixed(0) : px(v)}</text>`; }
    if (F.mode === "idx" && lo < 100 && hi > 100) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(100)}" y2="${Y(100)}" class="yc-zero"/>`;
    const span = (t1 - t0) / 864e5, long = span > 900;
    const marks = Math.max(3, Math.floor(W / 110)); let last = "";
    for (let i = 1; i < marks; i++) {
      const t = t0 + ((t1 - t0) * i) / marks, d = new Date(t);
      const lab = long ? String(d.getUTCFullYear()) : d.toLocaleDateString("en-US", { month: "short", year: span > 200 ? "2-digit" : undefined, day: span <= 100 ? "numeric" : undefined, timeZone: "UTC" });
      if (lab !== last) g += `<text x="${X(t)}" y="${H - 7}" class="yc-ax" text-anchor="middle">${lab}</text>`;
      last = lab;
    }
    for (const [k, color] of lines) g += `<polyline points="${rows.map((r) => `${X(r[0]).toFixed(1)},${Y(r[k]).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
    g += `<line class="fx-cross" id="fxX" y1="${pt}" y2="${H - pb}" x1="0" x2="0" style="display:none"/></svg>`;
    const leg = lines.map(([, color, name]) => `<span><i style="border-color:${color}"></i>${esc(name)}</span>`).join("");
    box.innerHTML = g + `<div class="yc-leg">${leg}<span class="dim">${F.mode === "idx" ? "each against the US dollar, start = 100" : `${esc(c.b)} per 1 ${esc(c.a)}`}</span></div>`;
    const svg = box.querySelector("svg"), xl = box.querySelector("#fxX"), read = $("#fxRead");
    const idle = () => { read.innerHTML = F.mode === "idx" ? "&nbsp;" : `${esc(c.a)}/${esc(c.b)} <b>${px(rows[rows.length - 1][1])}</b> · ${date(t1)}`; xl.style.display = "none"; };
    idle();
    svg.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
      const t = t0 + ((x - pl) / (W - pl - pr)) * (t1 - t0);
      let lo2 = 0, hi2 = rows.length - 1;
      while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (rows[m][0] < t) lo2 = m + 1; else hi2 = m; }
      const p = rows[lo2]; xl.setAttribute("x1", X(p[0])); xl.setAttribute("x2", X(p[0])); xl.style.display = "";
      read.innerHTML = `${date(p[0])} · ` + (F.mode === "idx" ? `${esc(c.a)} <b>${p[1].toFixed(1)}</b> · ${esc(c.b)} <b>${p[2].toFixed(1)}</b>` : `${esc(c.a)}/${esc(c.b)} <b>${px(p[1])}</b>`);
    });
    svg.addEventListener("mouseleave", idle);
  }

  function renderDetail() {
    if (!F.active || window.WireInstrument?.isOpen()) return;
    const el = $("#fxdetail"), d = F.data, c = F.cmp, N = names();
    if (!d || d.empty) { el.innerHTML = d?.error ? "" : window.WireUI.skeleton("detail"); return; }
    let body = `<p class="dim">Pick two currencies to compare.</p>`;
    if (c?.stats) {
      const s = c.stats, pair = `${c.a}/${c.b}`;
      const where = s.pctInWindow >= 80 ? "near the top" : s.pctInWindow <= 20 ? "near the bottom" : "mid-range";
      const hist = s.pctOfHistory == null ? "" : ` Against everything since ${new Date(s.historyFrom).getUTCFullYear()}, it is ${s.pctOfHistory >= 90 ? "at the high end" : s.pctOfHistory <= 10 ? "at the low end" : "in the middle"} (${Math.round(s.pctOfHistory)}% of readings were lower).`;
      body = `<h1>${esc(pair)}</h1><p class="dim">${esc(N[c.a] || c.a)} priced in ${esc(N[c.b] || c.b)}</p>
        <dl class="kv num"><dt>Rate</dt><dd><b>${px(s.last)}</b></dd>
        <dt>Change, ${esc(c.range)}</dt><dd class="${cls(s.chgPct)}">${pct(s.chgPct, 2)} <span class="dim">from ${px(s.first)}</span></dd>
        <dt>High</dt><dd>${px(s.high)} <span class="dim">${date(s.highAt)}</span></dd>
        <dt>Low</dt><dd>${px(s.low)} <span class="dim">${date(s.lowAt)}</span></dd>
        <dt>In range</dt><dd>${Math.round(s.pctInWindow)}% of the way from low to high</dd></dl>
        <p>${esc(c.a)} has ${s.chgPct >= 0 ? "gained" : "lost"} ${Math.abs(s.chgPct).toFixed(1)}% against ${esc(c.b)} over ${esc(c.range)}, and sits ${where} of that range.${hist}</p>`;
    }
    el.innerHTML = body + `<div class="isec">HOW TO READ IT</div>
      <p class="yc-note">The cross rate is how much of the second currency one unit of the first buys; a rising line means the first is getting stronger. "Both vs USD" shows each against the dollar, rebased to 100, so you can see which one drove the move. Click any row in the table to chart it.</p>
      <p class="yc-note">For long macro history (trade-weighted dollar, real exchange rates) open Graphs and add DTWEXBGS or DEXJPUS.</p>`;
  }

  async function loadCompare() {
    const seq = ++F.seq;
    F.cmp = null; renderChart();
    const r = await api.page.invoke("fx:compare", F.a, F.b, F.range).catch(() => null);
    if (seq !== F.seq) return;
    F.cmp = r || { none: true }; renderChart(); renderDetail();
  }
  function apply(d) { if (!d) return; F.data = d; window.WireChrome?.pulled("fx", d.at || null); render(); renderDetail(); if (!F.cmp || F.cmp.none) loadCompare(); }
  const setPair = (a, b) => { F.a = a; F.b = b; save(); render(); loadCompare(); };

  $("#fx").addEventListener("change", (e) => {
    const v = e.target.value;
    if (e.target.id === "fxA") v === F.b ? setPair(F.b, F.a) : setPair(v, F.b);
    else if (e.target.id === "fxB") v === F.a ? setPair(F.b, F.a) : setPair(F.a, v);
  });
  $("#fx").addEventListener("click", (e) => {
    if (e.target.closest("[data-ref]")) return void api.page.invoke("fx:refresh").then(apply);
    if (e.target.closest("#fxSwap")) return setPair(F.b, F.a);
    const r = e.target.closest("[data-range]"); if (r) { F.range = r.dataset.range; save(); render(); return loadCompare(); }
    const m = e.target.closest("[data-mode]"); if (m) { F.mode = m.dataset.mode; save(); render(); return; }
    const row = e.target.closest("tr[data-c]");
    if (row && !row.dataset.idx) { const c = row.dataset.c; setPair(c, c === F.b ? "USD" : F.b); $("#fxCompare")?.scrollIntoView({ block: "nearest" }); }
  });
  $("#fx").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("tr[data-c]")) e.target.click(); });
  if (api?.page) api.page.on("fx:update", apply);

  (window.WirePages ||= {}).fx = {
    show() { F.active = true; render(); renderDetail(); api.page.invoke("fx:get").then(apply); if (!F.cmp) loadCompare(); },
    hide() { F.active = false; },
    key(e) { if (e.key === "r" && !e.metaKey && !e.ctrlKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) api.page.invoke("fx:refresh").then(apply); },
    restore() { renderDetail(); },
    detail: () => $("#fxdetail")
  };
})();
