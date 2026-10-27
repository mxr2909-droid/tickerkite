/* Tickerkite decile board: the Scorecards page's second view. Every indicator ranked D1–D10 against its own
   full history (src/macro/board.js does the math), grouped by section, with a timeline to pick the
   ranking window and the as-of date. scorecard.js owns the page and hands over render/detail/keys. */
(() => {
  const api = window.wire, M = window.WireBoardMath;
  const $ = (s) => document.querySelector(s);
  const DAY = 864e5;
  const PRESETS = [["all", "ALL"], [50, "50Y"], [30, "30Y"], [20, "20Y"], [10, "10Y"], [5, "5Y"]];
  const B = { data: null, asked: false, sel: null, preset: "all", lo: null, hi: null, res: null, seq: 0 };
  try { const p = localStorage.getItem("wire.board.range"); if (p && (p === "all" || PRESETS.some(([k]) => String(k) === p))) B.preset = p === "all" ? "all" : +p; } catch {}
  let H = {}; // helpers from scorecard.js: esc, fmt, fmtDate, ord, defs(), sections(), openInstrument

  // ---------- colors ----------
  // terminal theme: deep red → pale → deep green like a heat strip; D4–D8 are pale and take dark text (ink)
  const TERM = ["#7a1717", "#b3261e", "#e0685d", "#f2b4ab", "#f1e2cf", "#d4ecc6", "#a9da8e", "#6fbf57", "#3c973a", "#1d6b2a"];
  const ink = (d) => window.TkTheme?.isTerminal() && d >= 4 && d <= 8;
  const color = (d) => window.TkTheme?.isTerminal() ? TERM[Math.max(1, Math.min(10, d)) - 1] : `hsl(${Math.round(((d - 1) / 9) * 128)},42%,${d === 5 || d === 6 ? 26 : 29}%)`;
  const scoreColor = (s) => color(M.decile(s / 100));

  // ---------- time ----------
  const monthStart = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
  const monthEnd = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1; };
  // readings are month-ends, so dates show the month (quarter for quarterly data), always with the year
  const tdate = (t, x) => H.fmtDate(t, x.freq === "q" ? x : { freq: "m" });
  const mlabel = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  function extent() {
    const s = Object.values(B.data?.series || {});
    return { start: monthStart(Math.min(...s.map((x) => x[0][0]))), end: monthEnd(Date.now()) };
  }
  /** The ranking window: [from, asOf]. hi null = latest. */
  function window_() {
    const { start, end } = extent();
    const asOf = B.hi == null ? end : B.hi;
    const from = B.preset != null ? monthStart(M.rangeFrom(B.preset, asOf, start)) : Math.max(start, Math.min(B.lo, asOf - 2 * M.YEAR));
    return { start, end, from, asOf };
  }

  // ---------- main ----------
  function gauge(v) {
    const R = 70, cx = 90, cy = 84, seg = [];
    const pt = (f, r) => [cx - r * Math.cos(Math.PI * f), cy - r * Math.sin(Math.PI * f)];
    for (let d = 1; d <= 10; d++) {
      const [x1, y1] = pt((d - 1) / 10 + 0.004, R), [x2, y2] = pt(d / 10 - 0.004, R);
      seg.push(`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}" stroke="${color(d)}" stroke-width="14" fill="none"/>`);
    }
    const f = v == null ? 0.5 : v / 100, [nx, ny] = pt(f, R - 16);
    return `<svg viewBox="0 0 180 104" width="180" height="104" role="img" aria-label="Overall ${v ?? "—"} out of 100">
      ${seg.join("")}
      ${v == null ? "" : `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`}
      <circle cx="${cx}" cy="${cy}" r="5" fill="#fff"/>
      <text x="${cx - R}" y="${cy + 16}" fill="#8c93a1" font-size="9.5" text-anchor="middle">0</text>
      <text x="${cx + R}" y="${cy + 16}" fill="#8c93a1" font-size="9.5" text-anchor="middle">100</text>
    </svg>`;
  }

  function head() {
    const { from, asOf, end } = window_(), o = B.res.overall;
    const lbl = o == null ? "—" : o >= 60 ? "Better than usual" : o > 40 ? "Near the middle of history" : "Worse than usual";
    return `<div class="bd-g">${gauge(o)}</div>
      <div class="bd-sum">
        <div class="bd-ov"><b>${o ?? "—"}</b><span>/ 100</span><em>${lbl}</em></div>
        <div class="sc-sub">Average of the eight section scores. Each tile is ranked against its own monthly readings from <b>${mlabel(from)}</b> to <b>${asOf >= end ? "today" : mlabel(asOf)}</b>; 50 = its median, D10 = best tenth for the economy.</div>
        ${asOf < end ? `<div class="bd-past">AS OF ${mlabel(asOf).toUpperCase()} <button type="button" data-act="latest">BACK TO LATEST ›</button></div>` : ""}
      </div>`;
  }

  function tile(x, r) {
    if (!r) return `<button type="button" class="bt none${x.id === B.sel ? " sel" : ""}" data-id="${x.id}"><span class="bn">${H.esc(x.name)}</span><span class="bd">no data</span></button>`;
    const up = r.prior && r.v > r.prior[1], dn = r.prior && r.v < r.prior[1];
    return `<button type="button" class="bt${r.stale ? " stale" : ""}${ink(r.decile) ? " ink" : ""}${x.id === B.sel ? " sel" : ""}" data-id="${x.id}" style="background:${color(r.decile)}"
        title="${H.esc(x.name)}: ${H.ord(Math.round(r.pct * 100))} percentile of ${r.n} monthly readings since ${new Date(r.since).getUTCFullYear()}${r.stale ? " · stale" : ""}">
      <span class="bn">${H.esc(x.name)}</span>
      <span class="bv">${H.fmt(r.v, x)}<i>${up ? "▲" : dn ? "▼" : ""}</i></span>
      <span class="bf"><b>D${r.decile}</b><span>${tdate(r.t, x)}${r.stale ? " · STALE" : ""}</span></span>
    </button>`;
  }

  function grid() {
    const defs = H.defs();
    return H.sections().map(([k, l]) => {
      const g = B.res.groups[k];
      return `<div class="bcol"><div class="bch"><span>${H.esc(l.replace(" & Conditions", "").toUpperCase())}</span><b style="background:${g == null ? "#20242b" : scoreColor(g)}${g != null && ink(M.decile(g / 100)) ? ";color:#0b0f14" : ""}">${g ?? "—"}</b></div>
        ${defs.filter((x) => x.section === k).map((x) => tile(x, B.res.tiles[x.id])).join("")}</div>`;
    }).join("");
  }

  function timeline() {
    const box = $("#bdtl");
    if (!box) return;
    const { start, end, from, asOf } = window_();
    const W = Math.max(300, box.clientWidth - 36), Ht = 46, pad = 8; // 36 = the box's side padding
    const X = (t) => pad + ((t - start) / (end - start)) * (W - 2 * pad);
    let g = `<svg viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" id="bdsvg">`;
    g += `<rect x="${pad}" y="6" width="${W - 2 * pad}" height="22" fill="#191c22"/>`;
    g += `<rect x="${X(from)}" y="6" width="${X(asOf) - X(from)}" height="22" fill="rgba(139,147,255,.14)" stroke="var(--orange)" stroke-width="1"/>`;
    for (const [a, b] of B.data.recessions || []) if (b >= start) g += `<rect x="${X(Math.max(a, start))}" y="7" width="${Math.max(2, X(b) - X(Math.max(a, start)))}" height="20" fill="rgba(255,255,255,.3)"><title>Recession ${mlabel(a)} – ${mlabel(b)}</title></rect>`;
    const y0 = new Date(start).getUTCFullYear(), y1 = new Date(end).getUTCFullYear(), every = W < 520 ? 20 : 10;
    for (let yr = Math.ceil(y0 / every) * every; yr <= y1; yr += every) if (X(Date.UTC(yr, 0, 1)) > 14 && X(Date.UTC(yr, 0, 1)) < W - 14) g += `<line x1="${X(Date.UTC(yr, 0, 1))}" x2="${X(Date.UTC(yr, 0, 1))}" y1="28" y2="32" stroke="#4a5160"/><text x="${X(Date.UTC(yr, 0, 1))}" y="42" fill="#8c93a1" font-size="9.5" text-anchor="middle">${yr}</text>`;
    const handle = (t, k) => `<rect class="bh" data-h="${k}" x="${X(t) - 4}" y="2" width="8" height="30" rx="1.5" fill="var(--orange)"><title>${k === "lo" ? "Rank against readings from here" : "Show the board as of here"}</title></rect>`;
    g += handle(from, "lo") + handle(asOf, "hi") + `</svg>`;
    box.innerHTML = g;
    box._map = { X, start, end, W, pad };
  }

  function update() {
    if (!B.data?.series || !Object.keys(B.data.series).length) return;
    const { from, asOf, end } = window_();
    B.res = M.board(H.defs(), B.data.series, H.sections(), { from, asOf: asOf >= end ? Infinity : asOf });
    const hd = $("#bdhead"), gr = $("#bdgrid");
    if (hd) hd.innerHTML = head();
    if (gr) gr.innerHTML = grid();
    document.querySelectorAll("#bdpre button").forEach((b) => b.setAttribute("aria-pressed", String(String(b.dataset.pre) === String(B.preset))));
    const rl = $("#bdrl");
    if (rl) rl.textContent = `${mlabel(from)} – ${asOf >= end ? "latest" : mlabel(asOf)}`;
    timeline();
  }

  function render() {
    const el = $("#score");
    if (!B.asked) { B.asked = true; api?.page.invoke("board:get").then(apply).catch(() => {}); }
    const d = B.data;
    if (!d?.series || !Object.keys(d.series).length) {
      el.innerHTML = d?.error && !d.refreshing ? window.WireUI.error(d.error, "data-sref")
        : window.WireUI.skeleton("tiles", { n: 24, label: "Downloading full histories: every FRED series from its first reading and Yahoo prices back to 1928. This takes a few seconds the first time." });
      renderDetail();
      return;
    }
    el.innerHTML = `<div class="bd-top" id="bdhead"></div>
      <div class="bd-ctl">
        <span class="lbl">RANK AGAINST</span>
        <span class="mperiods" id="bdpre">${PRESETS.map(([k, l]) => `<button type="button" data-pre="${k}">${l}</button>`).join("")}</span>
        <span class="bd-rl" id="bdrl"></span>
        <span class="bd-leg">WORST ${Array.from({ length: 10 }, (_, i) => `<i${ink(i + 1) ? ' class="ink"' : ""} style="background:${color(i + 1)}">${i + 1}</i>`).join("")} BEST</span>
      </div>
      <div class="bd-tl" id="bdtl"></div>
      <div class="bd-tlx"><span>◂ left handle: the history each indicator is ranked against · shaded = recessions</span><span>right handle: the board as of that date ▸</span></div>
      <div class="bd-grid" id="bdgrid"></div>`;
    update();
    if (!B.sel || !H.defs().some((x) => x.id === B.sel)) B.sel = H.defs()[0]?.id;
    renderDetail();
  }

  // ---------- detail ----------
  function renderDetail(byUser = false) {
    const el = $("#sdetail");
    if (window.WireInstrument?.isOpen()) { if (!byUser) return; window.WireInstrument.close(); }
    const x = B.sel && H.defs().find((d) => d.id === B.sel), r = B.res?.tiles[B.sel];
    if (!x || !B.data?.series) { el.innerHTML = B.data?.series ? window.WireUI.empty("Nothing selected", "Pick a tile to see its history and decile.") : window.WireUI.skeleton("detail"); return; }
    const [kind, sym] = x.src.split(":");
    const fredIds = kind === "fred" ? [sym] : kind === "derived" && !sym.includes("/") ? sym.split("-") : null;
    const ysym = kind === "yahoo" ? sym : kind === "derived" && sym.includes("/") ? sym.split("/")[0] : null;
    const srcLabel = fredIds ? `St. Louis Fed (FRED) · ${fredIds.join(" − ")}` : `Yahoo Finance · ${sym}`;
    const secName = (H.sections().find(([k]) => k === x.section) || [, ""])[1];
    const { from, asOf, end } = window_();
    const pv = (p) => (p ? `${H.fmt(p[1], x)} <span class="dim">(${tdate(p[0], x)})</span>` : "—");
    el.innerHTML = `<div class="ind">
      <div class="dhead"><span class="code">${H.esc(secName.toUpperCase())}</span><span class="nm">${H.esc(fredIds ? "FRED · " + fredIds.join(" − ") : "YAHOO · " + sym)}</span><span class="dt">${r ? "as of " + tdate(r.t, x) : ""}</span></div>
      <h1 style="margin:4px 0 0">${H.esc(x.name)}</h1>
      ${r ? `<div class="big"><b>${H.fmt(r.v, x)}</b><span class="bdbadge" style="background:${color(r.decile)}${ink(r.decile) ? ";color:#0b0f14" : ""}">D${r.decile}</span><span class="dim">${r.decile >= 6 ? "better" : "worse"} than ${r.decile >= 6 ? Math.round(r.good * 100) : Math.round((1 - r.good) * 100)}% of its history</span></div>
      <div class="bd-pct">${H.ord(Math.max(1, Math.round(r.pct * 100)))} percentile of ${r.n} readings since ${new Date(r.since).getUTCFullYear()} · ${r.dir > 0 ? "higher" : "lower"} is better</div>` : `<div class="dim">No reading by ${mlabel(asOf)}.</div>`}
      ${r?.stale ? `<div class="stale">Stale: the latest reading is from ${tdate(r.t, x)}${r.dropped ? ", too old to count toward the section score" : ""}.</div>` : ""}
      <div class="isec">FULL HISTORY · RECESSIONS SHADED · RANKED RANGE HIGHLIGHTED</div>
      <div class="ichart" id="bdchart"></div>
      <dl class="kv">
        <dt>Prior</dt><dd>${r ? pv(r.prior) : "—"}</dd>
        <dt>Year ago</dt><dd>${r ? pv(r.yearAgo) : "—"}</dd>
        <dt>Ranked</dt><dd>${mlabel(Math.max(from, r?.since ?? from))} – ${asOf >= end ? "latest" : mlabel(asOf)}, one reading per month</dd>
        <dt>Source</dt><dd>${H.esc(srcLabel)}</dd>
      </dl>
      <p style="margin:12px 0 0">${H.esc(x.desc || "")}</p>
      ${fredIds ? `<button type="button" class="open" data-act="fred" data-ids="${H.esc(fredIds.join(","))}">OPEN ON FRED <span>›</span></button>` : ""}
      ${ysym ? `<button type="button" class="open" data-act="inst" data-sym="${H.esc(ysym)}">OPEN PRICE CHART <span>›</span></button>` : ""}
      <p class="ifoot">Readings are month-ends (the last value each month), dated by the period they cover, from today's revised data. The board as of a past date shows what that data says now, not what was known then.</p>
    </div>`;
    chart(x, from, asOf >= end ? Infinity : asOf);
  }

  function chart(x, from, asOf) {
    const box = $("#bdchart"), P = B.data.series[x.id];
    if (!box || !P?.length) { if (box) box.innerHTML = `<div class="iload">No history.</div>`; return; }
    const W = Math.max(280, box.clientWidth), Hc = 200, padL = 4, padR = 54, padT = 8, padB = 20;
    const t0 = P[0][0], t1 = P[P.length - 1][0];
    let lo = Math.min(...P.map((p) => p[1])), hi = Math.max(...P.map((p) => p[1]));
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const X = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (Hc - padT - padB);
    const ai = M.idxAt(P, asOf), a = Math.max(from, t0), b = ai >= 0 ? P[ai][0] : t0;
    let g = `<svg viewBox="0 0 ${W} ${Hc}" width="${W}" height="${Hc}" role="img" aria-label="${H.esc(x.name)} full history">`;
    for (const [ra, rb] of B.data.recessions || []) if (rb >= t0 && ra <= t1) g += `<rect x="${X(Math.max(ra, t0))}" y="${padT}" width="${Math.max(1.5, X(Math.min(rb, t1)) - X(Math.max(ra, t0)))}" height="${Hc - padT - padB}" fill="rgba(255,255,255,.08)"/>`;
    if (b > a) g += `<rect x="${X(a)}" y="${padT}" width="${X(b) - X(a)}" height="${Hc - padT - padB}" fill="rgba(139,147,255,.07)" stroke="rgba(139,147,255,.35)"/>`;
    for (let k = 0; k <= 3; k++) { const v = lo + ((hi - lo) * k) / 3; g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="#22262d"/><text x="${W - padR + 6}" y="${Y(v) + 3}" fill="#8c93a1" font-size="9.5">${H.fmt(v, x)}</text>`; }
    if (lo < 0 && hi > 0) g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(0)}" y2="${Y(0)}" stroke="#323843"/>`;
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear(), every = [1, 2, 5, 10, 20].find((e) => (y1 - y0) / e <= 7) || 20;
    for (let yr = Math.ceil((y0 + 1) / every) * every; yr <= y1; yr += every) g += `<text x="${X(Date.UTC(yr, 0, 1))}" y="${Hc - 5}" fill="#8c93a1" font-size="9.5" text-anchor="middle">${yr}</text>`;
    g += `<polyline points="${P.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--orange)" stroke-width="1.3"/>`;
    if (ai >= 0) g += `<circle cx="${X(P[ai][0])}" cy="${Y(P[ai][1])}" r="3.2" fill="#fff" stroke="var(--orange)"/>`;
    g += `<line id="bdx" x1="0" x2="0" y1="${padT}" y2="${Hc - padB}" stroke="#4a5160" visibility="hidden"/><rect x="0" y="0" width="${W}" height="${Hc}" fill="transparent" id="bdhit"/></svg><div class="tip" id="bdtip" hidden></div>`;
    box.innerHTML = g;
    const hit = box.querySelector("#bdhit"), cross = box.querySelector("#bdx"), tip = box.querySelector("#bdtip");
    hit.addEventListener("mousemove", (e) => {
      const rect = hit.getBoundingClientRect(), t = t0 + ((((e.clientX - rect.left) / rect.width) * W - padL) / (W - padL - padR)) * (t1 - t0);
      const i = Math.max(0, Math.min(P.length - 1, M.idxAt(P, t))), p = P[i];
      cross.setAttribute("x1", X(p[0])); cross.setAttribute("x2", X(p[0])); cross.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.innerHTML = `<div class="tt">${mlabel(p[0])}</div><b>${H.fmt(p[1], x)}</b>`;
      tip.style.left = Math.min(rect.width - 110, (X(p[0]) / W) * rect.width + 10) + "px"; tip.style.top = "10px";
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }

  // ---------- interaction ----------
  function select(id, byUser = true) {
    if (!id) return;
    B.sel = id;
    document.querySelectorAll("#bdgrid .bt").forEach((b) => b.classList.toggle("sel", b.dataset.id === id));
    document.querySelector(`#bdgrid .bt[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
    renderDetail(byUser);
  }
  function setPreset(p) {
    B.preset = p === "all" ? "all" : +p;
    try { localStorage.setItem("wire.board.range", String(B.preset)); } catch {}
    update(); renderDetail();
  }

  // dragging a timeline handle: lo = ranking window start, hi = as-of date (both snap to months)
  let drag = null, raf = 0;
  function dragTo(clientX) {
    const box = $("#bdtl"), m = box?._map;
    if (!m || !drag) return;
    const rect = box.getBoundingClientRect(), px = ((clientX - rect.left) / rect.width) * m.W;
    const t = m.start + ((px - m.pad) / (m.W - 2 * m.pad)) * (m.end - m.start);
    const { from, asOf } = window_();
    if (drag === "lo") {
      B.preset = null;
      B.lo = monthStart(Math.max(m.start, Math.min(t, asOf - 2 * M.YEAR)));
    } else {
      if (B.preset == null) B.lo = from; // a fixed start stays put; a preset window slides with the date
      const hi = monthEnd(Math.max(m.start + 2 * M.YEAR, Math.min(t, m.end)));
      B.hi = hi >= m.end ? null : hi;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { update(); renderDetail(); });
  }
  $("#score").addEventListener("pointerdown", (e) => {
    if (!B.active) return;
    const svg = e.target.closest("#bdsvg");
    if (!svg) return;
    const h = e.target.closest(".bh");
    if (h) drag = h.dataset.h;
    else { // a click on the track moves the nearer handle
      const m = $("#bdtl")._map, rect = svg.getBoundingClientRect(), px = ((e.clientX - rect.left) / rect.width) * m.W, { from, asOf } = window_();
      drag = Math.abs(px - m.X(from)) < Math.abs(px - m.X(asOf)) ? "lo" : "hi";
    }
    $("#bdtl").setPointerCapture(e.pointerId); // the box survives the svg being redrawn mid-drag
    dragTo(e.clientX);
    e.preventDefault();
  });
  $("#score").addEventListener("pointermove", (e) => { if (drag) dragTo(e.clientX); });
  const endDrag = () => { drag = null; };
  $("#score").addEventListener("pointerup", endDrag);
  $("#score").addEventListener("pointercancel", endDrag);
  $("#score").addEventListener("click", (e) => {
    if (!B.active) return;
    const p = e.target.closest("[data-pre]"); if (p) { setPreset(p.dataset.pre); return; }
    if (e.target.closest("[data-act=latest]")) { B.hi = null; update(); renderDetail(); return; }
    const t = e.target.closest(".bt[data-id]"); if (t) select(t.dataset.id);
  });
  $("#sdetail").addEventListener("click", (e) => {
    if (!B.active || window.WireInstrument?.isOpen()) return;
    const f = e.target.closest("[data-act=fred]");
    if (f) api?.open(`https://fred.stlouisfed.org/graph/?id=${f.dataset.ids}`);
  });

  function apply(d) {
    if (!d) return;
    B.data = { ...(B.data || {}), ...d };
    if (!B.active) return;
    if (d.series) render();
    window.WireScore?.info?.();
  }

  // keyboard: ←/→ move between columns, ↑/↓ within a column
  function key(e) {
    const cols = H.sections().map(([k]) => H.defs().filter((x) => x.section === k).map((x) => x.id)).filter((c) => c.length);
    let ci = cols.findIndex((c) => c.includes(B.sel)), ri = ci < 0 ? 0 : cols[ci].indexOf(B.sel);
    if (ci < 0) ci = 0;
    if (e.key === "ArrowDown" || e.key === "j") ri++;
    else if (e.key === "ArrowUp" || e.key === "k") ri--;
    else if (e.key === "ArrowRight" || e.key === "l") ci = Math.min(cols.length - 1, ci + 1);
    else if (e.key === "ArrowLeft" || e.key === "h") ci = Math.max(0, ci - 1);
    else return;
    e.preventDefault();
    const c = cols[ci];
    select(c[Math.max(0, Math.min(c.length - 1, ri))]);
  }

  window.WireBoard = {
    init(h) { H = h; api?.page?.on("board:update", apply); },
    show() { B.active = true; }, // scorecard.js renders right after
    hide() { B.active = false; },
    render, renderDetail, key,
    refresh() { api?.page.invoke("board:refresh"); },
    resize() { if (!B.active || !B.res) return; timeline(); if (!window.WireInstrument?.isOpen()) renderDetail(); },
    status() {
      const d = B.data;
      if (d?.refreshing) return "downloading full histories…";
      if (!d?.fetchedAt) return "";
      const h = Math.round((Date.now() - d.fetchedAt) / 3600e3);
      return `histories updated ${h < 1 ? "within the hour" : h < 48 ? h + "h ago" : Math.round(h / 24) + "d ago"}${d.failed?.length ? ` · ${d.failed.length} series failed, using last copy` : ""}`;
    }
  };
})();
