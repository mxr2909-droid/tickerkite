/* Tickerkite Sector map page: a treemap of US sectors (size = market cap, color = return) that zooms into a sector's
   largest companies, flat or as 3D blocks whose height is the size of the move. One canvas draws both views:
   the "camera" is an orthographic projection that is straight overhead in 2D and tilts and turns in 3D.
   Registers with app.js through window.WirePages; geometry (squarify, depthOrder) is in treemap.js. */
(() => {
  const api = window.wire, T = window.TkTreemap;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // a company moving ±SCALE % over the period is fully saturated and full height; sectors move less, so they use half
  const SCALE = { "1D": 3, "1W": 6, "1M": 12, "3M": 20, YTD: 35, "1Y": 50 };
  const SECTOR_F = 0.5;
  const RAD = Math.PI / 180, PAD = 10, LEGEND = 30;
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const M = {
    snap: null, period: "1D", prev: null, pk: 1, visible: false,
    level: null,          // sector id the page is on, or null for all sectors
    focus: null,          // sector being drawn zoomed (stays set while zooming back out)
    z: 0, zT: 0,          // zoom progress 0 (all sectors) → 1 (inside one)
    three: false, k: 0,   // 3D on/off and its progress
    yaw: 24, pitch: 50,   // 3D camera, degrees (pitch 90 = straight overhead)
    sel: null, hover: null, lay: null, hits: [], W: 0, H: 0, dpr: 1
  };
  try { M.period = localStorage.getItem("wire.map.period") || "1D"; M.three = localStorage.getItem("wire.map.3d") === "1"; } catch {}
  if (!SCALE[M.period]) M.period = "1D";
  M.k = M.three ? 1 : 0;

  // ---------- DOM (built once; the canvas persists) ----------
  const root = $("#map");
  root.innerHTML = `<div class="mbar sm-bar"></div>
    <div class="sm-stage"><canvas aria-label="Sector map"></canvas><div class="sm-wait"></div><div class="sm-tip" hidden></div><div class="sm-legend"></div></div>`;
  const barEl = root.querySelector(".sm-bar"), stage = root.querySelector(".sm-stage"), cv = root.querySelector("canvas");
  const waitEl = root.querySelector(".sm-wait"), tip = root.querySelector(".sm-tip"), legEl = root.querySelector(".sm-legend");
  const c = cv.getContext("2d");

  // ---------- numbers and colors ----------
  const pct = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
  const cap = (v) => (v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : v >= 1e9 ? "$" + (v / 1e9).toFixed(v >= 1e11 ? 0 : 1) + "B" : "$" + Math.round(v / 1e6) + "M");
  const px = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mixRect = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });
  const mixCol = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
  const rgb = (col, f = 1) => `rgb(${col.map((v) => Math.round(v * f)).join(",")})`;
  const terminal = () => !!window.TkTheme?.isTerminal();

  /** Color for an intensity n in −1…1 (null = no data). Matches the Markets page: pale → deep in the terminal theme, dark → vivid in classic. */
  function colorN(n) {
    if (n == null) return terminal() ? [22, 28, 37] : [34, 38, 46];
    if (terminal()) {
      const k = Math.abs(n) ** 0.7, [a, b] = n >= 0 ? [[214, 238, 208], [27, 110, 43]] : [[247, 205, 200], [168, 26, 30]];
      return mixCol(a, b, k);
    }
    const k = Math.abs(n) ** 0.8;
    return mixCol([27, 30, 37], n >= 0 ? [38, 166, 110] : [214, 74, 80], k);
  }
  const inkOn = (col) => (0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2] > 150 ? "#0b0f14" : "#ffffff");
  const norm = (ret, p, f) => (ret?.[p] == null ? null : clamp(ret[p] / (SCALE[p] * f), -1, 1));
  /** Intensity for the current period, gliding from the previous period's after a switch. */
  function inten(ret, f) {
    const b = norm(ret, M.period, f);
    if (M.pk >= 1 || !M.prev || b == null) return b;
    const a = norm(ret, M.prev, f);
    return a == null ? b : lerp(a, b, ease(M.pk));
  }

  const sectorOf = (id) => M.snap?.sectors?.find((s) => s.id === id) || null;
  const firmOf = (sym) => { for (const s of M.snap?.sectors || []) { const f = s.firms.find((x) => x.sym === sym); if (f) return f; } return null; };

  // ---------- layout: recomputed when the data or the canvas size changes ----------
  function layout() {
    const s = M.snap;
    if (!s?.sectors?.length || M.W < 40 || M.H < 40) { M.lay = null; return; }
    const PW = M.W - 2 * PAD, PH = M.H - 2 * PAD - LEGEND, plane = { x: 0, y: 0, w: PW, h: PH };
    const top = T.squarify(s.sectors.map((x) => x.cap), plane);
    M.lay = { PW, PH, plane, sectors: s.sectors.map((sec, i) => {
      // companies are laid out once, for the whole plane, and squeezed into the sector's rectangle: opening a sector
      // is then one smooth stretch, with every company keeping its place
      const full = T.squarify(sec.firms.map((f) => f.cap), plane), r = top[i], kx = r.w / PW, ky = r.h / PH;
      return { sec, rect: r, full, nested: full.map((n) => ({ x: r.x + n.x * kx, y: r.y + n.y * ky, w: n.w * kx, h: n.h * ky })) };
    }) };
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    M.W = r.width; M.H = r.height; M.dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(M.W * M.dpr); cv.height = Math.round(M.H * M.dpr);
    layout(); draw();
  }
  new ResizeObserver(() => { if (M.visible) resize(); }).observe(stage);

  // ---------- drawing ----------
  function draw() {
    const L = M.lay, dpr = M.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, M.W, M.H);
    M.hits = [];
    if (!L || !M.visible) return;
    const k = ease(M.k), ez = ease(M.z);
    const th = M.yaw * RAD * k, ph = lerp(90, M.pitch, k) * RAD;
    const sn = Math.sin(th), cs = Math.cos(th), sp = Math.sin(ph), cp = Math.max(0, Math.cos(ph));
    const HMAX = Math.min(L.PW, L.PH) * 0.22;
    // fit the turned, tilted plane (and its tallest block) into the stage
    const extW = L.PW * cs + L.PH * Math.abs(sn), extH = (L.PW * Math.abs(sn) + L.PH * cs) * sp + HMAX * cp;
    const S = Math.min(L.PW / extW, L.PH / extH);
    const cx = PAD + L.PW / 2, cy = PAD + L.PH / 2 + (S * HMAX * cp) / 2;
    const proj = (x, y, z) => { const X = x - L.PW / 2, Y = y - L.PH / 2; return [cx + S * (X * cs - Y * sn), cy + S * ((X * sn + Y * cs) * sp - z * cp)]; };
    const hgt = (n) => (n == null ? 0 : HMAX * (0.03 + 0.97 * Math.abs(n) ** 0.9));
    const font = getComputedStyle(root).fontFamily;
    const setFont = (weight, size) => { c.font = `${weight} ${size}px ${font}`; };
    /** Largest size ≤ max at which `text` is no wider than `w`. */
    const fit = (text, weight, w, max) => { setFont(weight, 100); return Math.min(max, (w / Math.max(1, c.measureText(text).width)) * 100); };
    const poly = (pts) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); };
    /** Draw in the plane of a block's top face: after this, 1 unit = 1 plane pixel and (0,0) is the rect's corner. */
    const onTop = (x, y, z) => { const o = proj(x, y, z); c.setTransform(dpr * S * cs, dpr * S * sn * sp, -dpr * S * sn, dpr * S * cs * sp, dpr * o[0], dpr * o[1]); };
    const flat = () => c.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (k > 0) { // the ground the blocks stand on
      poly([proj(0, 0, 0), proj(L.PW, 0, 0), proj(L.PW, L.PH, 0), proj(0, L.PH, 0)]);
      c.fillStyle = `rgba(128,140,160,${0.07 * k})`; c.fill();
    }

    const F = M.focus ? L.sectors.find((s) => s.sec.id === M.focus) : null;
    const cam = (r) => { // other sectors slide outward as the focused one grows to fill the plane
      if (!F) return r;
      const sx = L.PW / F.rect.w, sy = L.PH / F.rect.h;
      return mixRect(r, { x: (r.x - F.rect.x) * sx, y: (r.y - F.rect.y) * sy, w: r.w * sx, h: r.h * sy }, ez);
    };
    const layers = [[], []];
    for (const s of L.sectors) {
      if (s === F || (F && ez >= 1)) continue;
      const n = inten(s.sec.ret, SECTOR_F);
      layers[0].push({ kind: "sector", s, key: s.sec.id, rect: cam(s.rect), col: colorN(n), h: hgt(n), alpha: F ? 1 - ez : 1, gap: 1 });
    }
    if (F) {
      const ns = inten(F.sec.ret, SECTOR_F), cs0 = colorN(ns), hs = hgt(ns);
      F.sec.firms.forEach((f, i) => {
        const nf = inten(f.ret, 1);
        layers[1].push({ kind: "firm", s: F, f, key: f.sym, rect: mixRect(F.nested[i], F.full[i], ez), col: mixCol(cs0, colorN(nf), ez), h: lerp(hs, hgt(nf), ez), alpha: 1, gap: 0.6 * ez });
      });
    }

    function box(t) {
      const r = t.rect, g = t.gap / S, x0 = r.x + g, y0 = r.y + g, x1 = r.x + r.w - g, y1 = r.y + r.h - g;
      if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return;
      const h = t.h * k, w = x1 - x0, d = y1 - y0;
      const top = [proj(x0, y0, h), proj(x1, y0, h), proj(x1, y1, h), proj(x0, y1, h)];
      const polys = [top];
      c.globalAlpha = t.alpha;
      if (h * S * cp > 0.4) {
        const front = [proj(x0, y1, 0), proj(x1, y1, 0), top[2], top[3]];
        poly(front); c.fillStyle = rgb(t.col, 0.66); c.fill(); polys.push(front);
        const side = sn > 0.002 ? [proj(x1, y0, 0), proj(x1, y1, 0), top[2], top[1]] : sn < -0.002 ? [proj(x0, y0, 0), proj(x0, y1, 0), top[3], top[0]] : null;
        if (side) { poly(side); c.fillStyle = rgb(t.col, 0.48); c.fill(); polys.push(side); }
      }
      poly(top); c.fillStyle = rgb(t.col); c.fill();
      if (k > 0) { c.strokeStyle = `rgba(0,0,0,${0.35 * k})`; c.lineWidth = 1; c.stroke(); }
      const ink = inkOn(t.col);
      onTop(x0, y0, h);
      if (t.kind === "sector") {
        // faint outlines of the companies inside: a hint that the block opens
        c.strokeStyle = ink; c.globalAlpha = t.alpha * 0.13; c.lineWidth = 1 / S; c.beginPath();
        const kx = w / t.s.rect.w, ky = d / t.s.rect.h;
        for (const n of t.s.nested) c.rect((n.x - t.s.rect.x) * kx, (n.y - t.s.rect.y) * ky, n.w * kx, n.h * ky);
        c.stroke(); c.globalAlpha = t.alpha;
        sectorLabel(t.s.sec, w, d, ink);
      } else {
        const a = clamp((ez - 0.35) / 0.45, 0, 1);
        if (a > 0) { c.globalAlpha = a; firmLabel(t.f, w, d, ink); }
      }
      flat(); c.globalAlpha = 1;
      const on = t.key === M.sel && t.kind === "firm", hov = t.key === M.hover;
      if (on || hov) { poly(top); c.strokeStyle = on ? "#ffffff" : "rgba(255,255,255,.75)"; c.lineWidth = on ? 2.5 : 1.5; c.stroke(); if (on) { c.strokeStyle = "rgba(0,0,0,.6)"; c.lineWidth = 1; c.stroke(); } }
      M.hits.push({ t, polys });
    }

    function sectorLabel(sec, w, d, ink) {
      const p = Math.min(9, w * 0.07, d * 0.1), W = w - 2 * p, name = sec.name.toUpperCase(), val = pct(sec.ret[M.period]);
      const small = (v) => v * S * Math.min(1, sp + 0.25) < 6.5; // too small to read on screen
      let fn = fit(name, 700, W, Math.min(15, d * 0.2));
      const fp = fit(val, 800, W, Math.min(38, d * 0.3, w * 0.2));
      c.fillStyle = ink; c.textBaseline = "top"; c.textAlign = "left";
      let y = p;
      if (small(fn)) fn = 0; else { setFont(700, fn); c.fillText(name, p, y); y += fn * 1.3; }
      if (!small(fp) && y + fp <= d - p * 0.5) { setFont(800, fp); c.fillText(val, p, y); y += fp * 1.2; }
      const sub = `${cap(sec.cap)} · ${sec.firms.length} COS`, fsub = Math.min(11, fn || 11);
      if (fn && !small(fsub) && y + fsub <= d - p && fit(sub, 400, W, fsub) >= fsub) { setFont(400, fsub); c.globalAlpha *= 0.75; c.fillText(sub, p, y); }
    }

    function firmLabel(f, w, d, ink) {
      const fs = fit(f.sym, 700, w * 0.84, Math.min(42, d * 0.4));
      if (fs * S * Math.min(1, sp + 0.25) < 6.5) return;
      const val = pct(f.ret[M.period]), f2 = Math.min(fs * 0.6, fit(val, 500, w * 0.9, 99)), two = f2 * S >= 6.5 && fs + f2 * 1.3 <= d * 0.92;
      const y = d / 2 - (two ? (fs + f2 * 1.25) / 2 : fs / 2);
      c.fillStyle = ink; c.textBaseline = "top"; c.textAlign = "center";
      setFont(700, fs); c.fillText(f.sym, w / 2, y);
      if (two) { setFont(500, f2); c.fillText(val, w / 2, y + fs * 1.2); }
    }

    for (const tiles of layers) for (const i of T.depthOrder(tiles.map((t) => t.rect), sn, cs)) box(tiles[i]);

    if (F && ez < 0.4) { // the sector's own label hands over to its companies
      const u = mixRect(F.rect, L.plane, ez), n = inten(F.sec.ret, SECTOR_F);
      onTop(u.x, u.y, hgt(n) * k); c.globalAlpha = 1 - ez / 0.4;
      sectorLabel(F.sec, u.w, u.h, inkOn(colorN(n)));
      flat(); c.globalAlpha = 1;
    }
  }

  // ---------- animation ----------
  let raf = 0, last = 0;
  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame() {
    raf = 0;
    // real elapsed time (not the frame's own timestamp, which stalls in a hidden window), so a throttled window still finishes on schedule
    const now = performance.now(), dt = calm ? 1e6 : Math.max(0, now - last); last = now;
    let busy = false;
    const go = (cur, target, ms) => { if (cur === target) return cur; busy = true; return cur < target ? Math.min(target, cur + dt / ms) : Math.max(target, cur - dt / ms); };
    M.z = go(M.z, M.zT, 560); M.k = go(M.k, M.three ? 1 : 0, 700); M.pk = go(M.pk, 1, 420);
    if (M.z === 0 && M.zT === 0) M.focus = null;
    draw();
    if (busy && M.visible) kick();
  }

  // ---------- toolbar, legend, loading ----------
  function bar() {
    const s = M.snap, sec = sectorOf(M.level);
    barEl.innerHTML = `<span class="sm-crumb">${sec ? `<button type="button" data-up title="Back to all sectors (Esc)">‹ ALL SECTORS</button><b>${esc(sec.name)}</b>` : `<b>ALL SECTORS</b>`}</span>
      <span class="mperiods">${Object.keys(SCALE).map((p, i) => `<button type="button" data-per="${p}" data-k="${i + 1}" aria-pressed="${p === M.period}" title="Key ${i + 1}">${p}</button>`).join("")}</span>
      <span class="dim">${!s?.fetchedAt ? "Loading…" : "Updated " + new Date(s.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + (s.open ? " · market open" : " · market closed") + (s.refsReady ? "" : " · loading price history…")}</span>
      <span class="mrange sm-mode" title="Flat map or 3D blocks (key D)"><button type="button" data-mode="2d" aria-pressed="${!M.three}">2D</button><button type="button" data-mode="3d" aria-pressed="${M.three}">3D</button></span>
      <button type="button" class="mref" data-ref title="Refresh now (R)">↻</button>`;
    const sc = SCALE[M.period] * (sec ? 1 : SECTOR_F), stops = [-1, -0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6, 1];
    legEl.innerHTML = `<span class="num">−${sc}%</span><i style="background:linear-gradient(90deg,${stops.map((n) => rgb(colorN(n))).join(",")})"></i><span class="num">+${sc}%</span>
      <span class="sm-key">SIZE = MARKET CAP · COLOR = ${M.period} RETURN${M.three ? " · HEIGHT = SIZE OF THE MOVE · DRAG TO TURN" : ""}${sec ? "" : " · CLICK A SECTOR TO OPEN IT"}</span>`;
    if (s) {
      window.WireChrome?.pulled("map", s.fetchedAt || null);
      window.WireChrome?.status("map", `US MARKET ${s.open ? "OPEN" : "CLOSED"}${s.refsReady ? "" : " · LOADING PRICE HISTORY"}`);
    }
    const have = !!s?.sectors?.length;
    waitEl.hidden = have;
    if (!have) waitEl.innerHTML = s?.error && !s.busy ? window.WireUI.error(s.error, "data-ref") : window.WireUI.skeleton("tiles", { n: 24, label: "Loading sectors and companies…" });
  }

  // ---------- right-hand pane ----------
  function rows(items, attr, selKey) {
    const max = Math.max(0.01, ...items.map((x) => Math.abs(x.v ?? 0)));
    return `<div class="sm-rows">${items.map((x) => `<button type="button" class="sm-row${x.key === selKey ? " sel" : ""}" ${attr}="${esc(x.key)}" title="${esc(x.title || "")}">
      <span class="sm-n"><b>${esc(x.label)}</b>${x.sub ? `<span>${esc(x.sub)}</span>` : ""}</span>
      <span class="sm-b"><i class="${cls(x.v)}" style="width:${x.v == null ? 0 : (Math.abs(x.v) / max) * 50}%;${x.v >= 0 ? "left:50%" : "right:50%"}"></i></span>
      <span class="sm-v ${cls(x.v)}">${pct(x.v)}</span><span class="sm-c">${cap(x.cap)}</span></button>`).join("")}</div>`;
  }
  const retTable = (ret) => `<table class="mret"><tr class="hd"><th></th><th>Return</th></tr>${Object.keys(SCALE).map((p) =>
    `<tr${p === M.period ? ' class="cur"' : ""}><td>${p}</td><td class="${cls(ret[p])}">${pct(ret[p])}</td></tr>`).join("")}</table>`;

  function detail() {
    const el = $("#mapdetail");
    if (window.WireInstrument?.isOpen()) return;
    const s = M.snap, p = M.period;
    if (!s?.sectors?.length) { el.innerHTML = `<div class="empty">The map appears here once prices have loaded.</div>`; return; }
    const sec = sectorOf(M.level);
    if (!sec) {
      const firms = s.sectors.flatMap((x) => x.firms), tot = firms.reduce((a, f) => a + f.cap, 0);
      let now = 0, then = 0, up = 0, dn = 0;
      for (const f of firms) { const r = f.ret[p]; if (r == null) continue; now += f.cap; then += f.cap / (1 + r / 100); if (r > 0) up++; else if (r < 0) dn++; }
      const all = then > 0 ? (now / then - 1) * 100 : null;
      el.innerHTML = `<div class="msum"><h2>All sectors</h2>
        <div class="dim">${firms.length} companies · ${cap(tot)} · the ${s.top} largest US-listed companies of each sector</div>
        <p class="sm-big"><span class="${cls(all)}">${pct(all)}</span> <span class="dim">${p} · ${up} up · ${dn} down</span></p>
        <h4>Sectors · ${p} return</h4>
        ${rows([...s.sectors].sort((a, b) => (b.ret[p] ?? -1e9) - (a.ret[p] ?? -1e9)).map((x) => ({ key: x.id, label: x.name, v: x.ret[p], cap: x.cap })), "data-sec")}
        <p class="dim sm-how">Each rectangle's area is market value and its color is the return over the period you pick. Click a sector (or a row above) to open it into its companies; Esc comes back. 3D stands the map up: the taller the block, the bigger the move, up or down.</p></div>`;
      return;
    }
    const f = sec.firms.find((x) => x.sym === M.sel);
    const card = f ? `<div class="sm-card"><h2>${esc(f.name)}</h2>
        <div class="dim">${esc(f.sym)} · ${esc(f.industry || sec.name)}${f.country && f.country !== "United States" ? " · " + esc(f.country) : ""}</div>
        <p>${px(f.price)} <span class="${cls(f.ret["1D"])}">${pct(f.ret["1D"])}</span> <span class="dim">today · ${cap(f.cap)} · ${((f.cap / sec.cap) * 100).toFixed(1)}% of the sector shown</span></p>
        ${retTable(f.ret)}
        <button type="button" class="mopen" data-open="${esc(f.sym)}">Open chart ↗</button> <button type="button" class="mopen" data-co="${esc(f.sym)}">Company page</button></div>` : "";
    el.innerHTML = `<div class="msum">${card}
      ${f ? `<h4>${esc(sec.name)}</h4>` : `<h2>${esc(sec.name)}</h2>`}
      <div class="dim">${sec.firms.length} largest companies · ${cap(sec.cap)}</div>
      ${f ? "" : retTable(sec.ret)}
      <h4>Companies · ${p} return</h4>
      ${rows(order(sec).map((x) => ({ key: x.sym, label: x.sym, sub: x.name, v: x.ret[p], cap: x.cap, title: x.industry })), "data-firm", M.sel)}</div>`;
  }
  /** A sector's companies best to worst for the current period (the order ↑ ↓ walk). */
  const order = (sec) => [...sec.firms].sort((a, b) => (b.ret[M.period] ?? -1e9) - (a.ret[M.period] ?? -1e9));

  // ---------- actions ----------
  function refreshAll() { bar(); detail(); draw(); }
  function setPeriod(p) {
    if (!SCALE[p] || p === M.period) return;
    M.prev = M.period; M.period = p; M.pk = 0;
    try { localStorage.setItem("wire.map.period", p); } catch {}
    bar(); detail(); kick();
  }
  function zoomIn(id) {
    if (!sectorOf(id)) return;
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    M.level = M.focus = id; M.zT = 1; M.sel = null; M.hover = null; hideTip();
    bar(); detail(); kick();
  }
  function zoomOut() {
    if (!M.level) return;
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    M.level = null; M.zT = 0; M.sel = null; M.hover = null; hideTip();
    bar(); detail(); kick();
  }
  function select(sym) {
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    M.sel = sym; detail(); draw();
    $("#mapdetail .sm-row.sel")?.scrollIntoView({ block: "nearest" });
  }
  function setThree(on) {
    M.three = on;
    try { localStorage.setItem("wire.map.3d", on ? "1" : "0"); } catch {}
    bar(); kick();
  }
  function reload() {
    api.page.invoke("map:refresh").then(take).catch(() => {});
    if (M.snap) { M.snap = { ...M.snap, busy: true }; bar(); }
  }
  function take(s) {
    M.snap = s;
    if (M.level && !sectorOf(M.level)) { M.level = M.focus = null; M.z = M.zT = 0; }
    if (M.sel && !sectorOf(M.level)?.firms.some((f) => f.sym === M.sel)) M.sel = null;
    layout(); refreshAll();
  }

  // ---------- pointer ----------
  const inside = (pt, q) => { // point in a convex polygon
    let sign = 0;
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length], cr = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
      if (cr !== 0) { if (sign && Math.sign(cr) !== sign) return false; sign = Math.sign(cr); }
    }
    return true;
  };
  function hitAt(e) {
    const r = cv.getBoundingClientRect(), pt = [e.clientX - r.left, e.clientY - r.top];
    for (let i = M.hits.length - 1; i >= 0; i--) if (M.hits[i].t.alpha > 0.5 && M.hits[i].polys.some((q) => inside(pt, q))) return { t: M.hits[i].t, pt };
    return null;
  }
  function hideTip() { tip.hidden = true; }
  function hover(e) {
    const h = M.z === M.zT ? hitAt(e) : null, key = h?.t.key ?? null;
    cv.style.cursor = h ? "pointer" : M.three ? "grab" : "default";
    if (h) {
      const t = h.t, v = (t.f || t.s.sec).ret[M.period];
      tip.innerHTML = t.kind === "firm"
        ? `<b>${esc(t.f.sym)}</b> ${esc(t.f.name)}<br><span class="${cls(v)}">${pct(v)}</span> ${M.period} · ${cap(t.f.cap)}${t.f.industry ? `<br><span class="dim">${esc(t.f.industry)}</span>` : ""}`
        : `<b>${esc(t.s.sec.name)}</b><br><span class="${cls(v)}">${pct(v)}</span> ${M.period} · ${cap(t.s.sec.cap)}<br><span class="dim">Click to open its ${t.s.sec.firms.length} largest companies</span>`;
      tip.hidden = false;
      const tw = tip.offsetWidth, thh = tip.offsetHeight;
      tip.style.left = clamp(h.pt[0] + 14, 4, M.W - tw - 4) + "px";
      tip.style.top = (h.pt[1] + 18 + thh > M.H ? h.pt[1] - thh - 10 : h.pt[1] + 18) + "px";
    } else hideTip();
    if (key !== M.hover) { M.hover = key; draw(); }
  }
  let drag = null, wheelAt = 0;
  cv.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, yaw: M.yaw, pitch: M.pitch, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch {} });
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return hover(e);
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    if (!M.three) return;
    hideTip(); cv.style.cursor = "grabbing";
    M.yaw = clamp(drag.yaw - dx * 0.25, -55, 55); M.pitch = clamp(drag.pitch + dy * 0.25, 26, 82);
    draw();
  });
  cv.addEventListener("pointerup", (e) => {
    const d = drag; drag = null;
    if (!d || d.moved) return hover(e);
    const h = hitAt(e); if (!h || M.z !== M.zT) return;
    if (h.t.kind === "sector") zoomIn(h.t.key);
    else if (M.sel === h.t.key && !window.WireInstrument?.isOpen()) window.WireApp.openInstrument(h.t.key); // second click: the full chart
    else select(h.t.key);
  });
  cv.addEventListener("pointercancel", () => { drag = null; });
  cv.addEventListener("pointerleave", () => { if (!drag) { hideTip(); if (M.hover) { M.hover = null; draw(); } } });
  // scroll in over a sector to open it, scroll out to come back (one step per gesture)
  cv.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) < 12 || Date.now() - wheelAt < 900 || M.z !== M.zT) return;
    if (e.deltaY > 0 && M.level) { wheelAt = Date.now(); zoomOut(); }
    else if (e.deltaY < 0 && !M.level) { const h = hitAt(e); if (h?.t.kind === "sector") { wheelAt = Date.now(); zoomIn(h.t.key); } }
  }, { passive: true });

  root.addEventListener("click", (e) => {
    const per = e.target.closest("[data-per]"); if (per) return setPeriod(per.dataset.per);
    const mode = e.target.closest("[data-mode]"); if (mode) return setThree(mode.dataset.mode === "3d");
    if (e.target.closest("[data-up]")) return zoomOut();
    if (e.target.closest("[data-ref]")) return reload();
  });
  $("#mapdetail").addEventListener("click", (e) => {
    const sec = e.target.closest("[data-sec]"); if (sec) return zoomIn(sec.dataset.sec);
    const firm = e.target.closest("[data-firm]"); if (firm) return select(firm.dataset.firm);
    const open = e.target.closest("[data-open]"); if (open) return window.WireApp.openInstrument(open.dataset.open);
    const co = e.target.closest("[data-co]"); if (co) return window.WireCompanyPage?.open(co.dataset.co);
  });
  api.page.on("map:update", (s) => take(s));

  (window.WirePages ||= {}).map = {
    show() {
      M.visible = true; bar(); detail();
      requestAnimationFrame(resize); // the stage has no size until the page is displayed
      api.page.invoke("map:get").then(take).catch(() => {});
    },
    hide() { M.visible = false; hideTip(); },
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const p = Object.keys(SCALE)[+e.key - 1];
      if (p) { e.preventDefault(); return setPeriod(p); }
      const k = e.key.toLowerCase(), sec = sectorOf(M.level);
      if (k === "d") setThree(!M.three);
      else if (k === "r") reload();
      else if (e.key === "Escape" || e.key === "Backspace") { if (M.sel) { M.sel = null; detail(); draw(); } else zoomOut(); }
      else if (e.key === "Enter" && M.sel) window.WireApp.openInstrument(M.sel);
      else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && M.snap?.sectors?.length) {
        const list = M.snap.sectors, i = list.findIndex((x) => x.id === M.level);
        e.preventDefault(); zoomIn(list[(i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length].id);
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && sec) {
        const list = order(sec), i = list.findIndex((x) => x.sym === M.sel);
        e.preventDefault(); select(list[clamp(i + (e.key === "ArrowDown" ? 1 : -1), 0, list.length - 1)].sym);
      }
    },
    restore() { detail(); },
    detail: () => $("#mapdetail")
  };
})();
