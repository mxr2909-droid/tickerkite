/* Tickerkite Sector map page: a treemap of US sectors (size = market cap, color = return) that zooms into a sector's
   largest companies, flat or as 3D blocks whose height is the size of the move. One canvas draws both views:
   the "camera" is an orthographic projection that is straight overhead in 2D and tilts and turns in 3D.
   Registers with app.js through window.WirePages; geometry (squarify, depthOrder) is in treemap.js.
   REPLAY plays the last weeks or months back on the same layout (sizes stay today's): per-day colors come from the
   shared daily history (TkMapHistory, src/breadth.js replayFrames), computed once per span; frames only recolor. */
(() => {
  const api = window.wire, T = window.TkTreemap, BR = window.TkBreadth, HS = window.TkMapHistory;
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
  // replay: i = position in trading days (fractional while playing), len days from s+1 to the last; fr = replayFrames()
  const RSCALE = { "1M": 12, "3M": 20, "6M": 30, "1Y": 50 }, RATE = 4; // "since the start" color scale; days per second at 1×
  const R = { on: false, playing: false, i: 0, len: 0, speed: 1, span: "3M", mode: "day", fr: null, P: null, index: null, dates: [], base: 0, ew: null, pending: null };
  try { const v = localStorage.getItem("wire.map.rpspan"); if (RSCALE[v]) R.span = v; if (localStorage.getItem("wire.map.rpmode") === "cum") R.mode = "cum"; } catch {}

  // ---------- DOM (built once; the canvas persists) ----------
  const root = $("#map");
  root.innerHTML = `<div class="mbar sm-bar"></div>
    <div class="sm-rp" hidden>
      <button type="button" class="sm-rp-play" data-rp="play" aria-label="Play" title="Play or pause (Space)">▶</button>
      <div class="sm-rp-date"><b></b><span></span></div>
      <input type="range" class="sm-rp-scrub" min="0" max="0" step="1" value="0" aria-label="Trading day">
      <div class="sm-rp-ctl">
        <span class="mrange" title="Playback speed">${[1, 2, 4].map((v) => `<button type="button" data-rpspeed="${v}">${v}×</button>`).join("")}</span>
        <span class="mrange" title="How far back the replay starts">${Object.keys(RSCALE).map((v) => `<button type="button" data-rpspan="${v}">${v}</button>`).join("")}</span>
        <span class="mrange" title="What the colors show"><button type="button" data-rpmode="day">Each day</button><button type="button" data-rpmode="cum">Since the start</button></span>
        <button type="button" class="mref" data-rp="close" title="Back to live prices (Esc)" aria-label="Leave replay">✕</button>
      </div>
      <div class="sm-rp-ew" title="The average daily move of the companies in view, compounded from the start of the replay"><span>Equal-weight</span><b></b></div>
      <div class="sm-rp-line" title="Click to jump to a day"><svg viewBox="0 0 1000 30" preserveAspectRatio="none" aria-hidden="true"><line class="z" x1="0" x2="1000"/><polyline/></svg><i class="sm-rp-mk"></i></div>
      <div class="sm-rp-note dim">Sizes are today's market values. Space plays or pauses · ← → a day · Home / End · Esc leaves</div>
    </div>
    <div class="sm-stage"><canvas aria-label="Sector map"></canvas><div class="sm-wait"></div><div class="sm-tip" hidden></div><div class="sm-legend"></div></div>`;
  const barEl = root.querySelector(".sm-bar"), stage = root.querySelector(".sm-stage"), cv = root.querySelector("canvas");
  const waitEl = root.querySelector(".sm-wait"), tip = root.querySelector(".sm-tip"), legEl = root.querySelector(".sm-legend");
  const c = cv.getContext("2d");
  const rp = root.querySelector(".sm-rp"), rpScrub = rp.querySelector(".sm-rp-scrub"), rpDate = rp.querySelector(".sm-rp-date b"), rpDay = rp.querySelector(".sm-rp-date span");
  const rpEw = rp.querySelector(".sm-rp-ew b"), rpLineEl = rp.querySelector(".sm-rp-line"), rpMk = rp.querySelector(".sm-rp-mk"), rpPlay = rp.querySelector(".sm-rp-play");

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

  // ---------- replay values ----------
  const rScale = () => (R.mode === "cum" ? RSCALE[R.span] : SCALE["1D"]);
  /** A replay series at the current position: interpolated between days while playing (so colors glide), stepped with reduced motion. */
  function rVal(a) {
    const k = Math.floor(R.i), t = calm ? 0 : R.i - k, x = a[k], y = a[Math.min(R.len - 1, k + 1)];
    if (x !== x) return t > 0.5 && y === y ? y : null;
    return t === 0 || y !== y ? x : x + (y - x) * t;
  }
  /** The labelled value: the day the date shows. */
  const rDay = (a) => { const v = a[Math.round(R.i)]; return v === v ? v : null; };
  const rN = (a, f) => { const v = rVal(a); return v == null ? null : clamp(v / (rScale() * f), -1, 1); };
  const secSeries = (si) => R.fr.sec[si][R.mode], firmSeries = (si, fi) => R.fr.firm[si][fi][R.mode];
  const fmtDay = (d, dow) => { const x = new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100)); return x.toLocaleDateString("en-US", { timeZone: "UTC", weekday: dow ? "short" : undefined, month: "short", day: "numeric", year: "numeric" }); };

  const sectorOf = (id) => M.snap?.sectors?.find((s) => s.id === id) || null;
  const firmOf = (sym) => { for (const s of M.snap?.sectors || []) { const f = s.firms.find((x) => x.sym === sym); if (f) return f; } return null; };

  // ---------- layout: recomputed when the data or the canvas size changes ----------
  function layout() {
    const s = M.snap;
    if (!s?.sectors?.length || M.W < 40 || M.H < 40) { M.lay = null; return; }
    const PW = M.W - 2 * PAD, PH = M.H - 2 * PAD - LEGEND, plane = { x: 0, y: 0, w: PW, h: PH };
    const top = T.squarify(s.sectors.map((x) => x.cap), plane);
    M.lay = { PW, PH, plane, sectors: s.sectors.map((sec, si) => {
      // companies are laid out once, for the whole plane, and squeezed into the sector's rectangle: opening a sector
      // is then one smooth stretch, with every company keeping its place
      const full = T.squarify(sec.firms.map((f) => f.cap), plane), r = top[si], kx = r.w / PW, ky = r.h / PH;
      return { sec, i: si, rect: r, full, nested: full.map((n) => ({ x: r.x + n.x * kx, y: r.y + n.y * ky, w: n.w * kx, h: n.h * ky })) };
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
      const n = R.on ? rN(secSeries(s.i), SECTOR_F) : inten(s.sec.ret, SECTOR_F), v = R.on ? rDay(secSeries(s.i)) : s.sec.ret[M.period];
      layers[0].push({ kind: "sector", s, key: s.sec.id, rect: cam(s.rect), col: colorN(n), h: hgt(n), alpha: F ? 1 - ez : 1, gap: 1, v });
    }
    if (F) {
      const ns = R.on ? rN(secSeries(F.i), SECTOR_F) : inten(F.sec.ret, SECTOR_F), cs0 = colorN(ns), hs = hgt(ns);
      F.sec.firms.forEach((f, i) => {
        const nf = R.on ? rN(firmSeries(F.i, i), 1) : inten(f.ret, 1), v = R.on ? rDay(firmSeries(F.i, i)) : f.ret[M.period];
        layers[1].push({ kind: "firm", s: F, f, key: f.sym, rect: mixRect(F.nested[i], F.full[i], ez), col: mixCol(cs0, colorN(nf), ez), h: lerp(hs, hgt(nf), ez), alpha: 1, gap: 0.6 * ez, v });
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
        sectorLabel(t.s.sec, w, d, ink, t.v);
      } else {
        const a = clamp((ez - 0.35) / 0.45, 0, 1);
        if (a > 0) { c.globalAlpha = a; firmLabel(t.f, w, d, ink, t.v); }
      }
      flat(); c.globalAlpha = 1;
      const on = t.key === M.sel && t.kind === "firm", hov = t.key === M.hover;
      if (on || hov) { poly(top); c.strokeStyle = on ? "#ffffff" : "rgba(255,255,255,.75)"; c.lineWidth = on ? 2.5 : 1.5; c.stroke(); if (on) { c.strokeStyle = "rgba(0,0,0,.6)"; c.lineWidth = 1; c.stroke(); } }
      M.hits.push({ t, polys });
    }

    function sectorLabel(sec, w, d, ink, v) {
      const p = Math.min(9, w * 0.07, d * 0.1), W = w - 2 * p, name = sec.name.toUpperCase(), val = pct(v);
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

    function firmLabel(f, w, d, ink, v) {
      const fs = fit(f.sym, 700, w * 0.84, Math.min(42, d * 0.4));
      if (fs * S * Math.min(1, sp + 0.25) < 6.5) return;
      const val = pct(v), f2 = Math.min(fs * 0.6, fit(val, 500, w * 0.9, 99)), two = f2 * S >= 6.5 && fs + f2 * 1.3 <= d * 0.92;
      const y = d / 2 - (two ? (fs + f2 * 1.25) / 2 : fs / 2);
      c.fillStyle = ink; c.textBaseline = "top"; c.textAlign = "center";
      setFont(700, fs); c.fillText(f.sym, w / 2, y);
      if (two) { setFont(500, f2); c.fillText(val, w / 2, y + fs * 1.2); }
    }

    for (const tiles of layers) for (const i of T.depthOrder(tiles.map((t) => t.rect), sn, cs)) box(tiles[i]);

    if (F && ez < 0.4) { // the sector's own label hands over to its companies
      const u = mixRect(F.rect, L.plane, ez), n = R.on ? rN(secSeries(F.i), SECTOR_F) : inten(F.sec.ret, SECTOR_F);
      onTop(u.x, u.y, hgt(n) * k); c.globalAlpha = 1 - ez / 0.4;
      sectorLabel(F.sec, u.w, u.h, inkOn(colorN(n)), R.on ? rDay(secSeries(F.i)) : F.sec.ret[M.period]);
      flat(); c.globalAlpha = 1;
    }
  }

  // ---------- animation ----------
  let raf = 0, last = 0;
  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame() {
    raf = 0;
    // real elapsed time (not the frame's own timestamp, which stalls in a hidden window), so a throttled window still finishes on schedule
    const now = performance.now(), real = Math.max(0, now - last), dt = calm ? 1e6 : real; last = now;
    let busy = false;
    if (R.playing) { // a steady number of trading days per second (a long stall doesn't jump ahead)
      R.i = Math.min(R.len - 1, R.i + (Math.min(real, 250) / 1000) * RATE * R.speed);
      if (R.i >= R.len - 1) { R.playing = false; rpControls(); } else busy = true;
      rpTick();
    }
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
      <span class="mperiods">${Object.keys(SCALE).map((p, i) => `<button type="button" data-per="${p}" data-k="${i + 1}" aria-pressed="${p === M.period}" title="${R.on ? "Leave the replay to pick a period" : "Key " + (i + 1)}"${R.on ? " disabled" : ""}>${p}</button>`).join("")}</span>
      <span class="dim">${!s?.fetchedAt ? "Loading…" : "Updated " + new Date(s.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + (s.open ? " · market open" : " · market closed") + (s.refsReady ? "" : " · loading price history…")}</span>
      ${replayButton()}
      <span class="mrange sm-mode" title="Flat map or 3D blocks (key D)"><button type="button" data-mode="2d" aria-pressed="${!M.three}">2D</button><button type="button" data-mode="3d" aria-pressed="${M.three}">3D</button></span>
      <button type="button" class="mref" data-ref title="Refresh now (R)">↻</button>`;
    const sc = (R.on ? rScale() : SCALE[M.period]) * (sec ? 1 : SECTOR_F), stops = [-1, -0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6, 1];
    const what = !R.on ? `${M.period} RETURN` : R.mode === "cum" ? `RETURN SINCE THE CLOSE OF ${fmtDay(R.base).toUpperCase()}` : "THAT DAY'S RETURN";
    legEl.innerHTML = `<span class="num">−${+sc.toFixed(1)}%</span><i style="background:linear-gradient(90deg,${stops.map((n) => rgb(colorN(n))).join(",")})"></i><span class="num">+${+sc.toFixed(1)}%</span>
      <span class="sm-key">${R.on ? "REPLAY · SIZE = TODAY'S MARKET CAP" : "SIZE = MARKET CAP"} · COLOR = ${what}${M.three ? " · HEIGHT = SIZE OF THE MOVE · DRAG TO TURN" : ""}${sec ? "" : " · CLICK A SECTOR TO OPEN IT"}</span>`;
    if (s) {
      window.WireChrome?.pulled("map", s.fetchedAt || null);
      window.WireChrome?.status("map", `US MARKET ${s.open ? "OPEN" : "CLOSED"}${s.refsReady ? "" : " · LOADING PRICE HISTORY"}`);
    }
    const have = !!s?.sectors?.length;
    waitEl.hidden = have;
    if (!have) waitEl.innerHTML = s?.error && !s.busy ? window.WireUI.error(s.error, "data-ref") : window.WireUI.skeleton("tiles", { n: 24, label: "Loading sectors and companies…" });
  }

  // ---------- replay ----------
  function replayButton() {
    if (R.on) return `<button type="button" class="mref sm-rpbtn" data-replay aria-pressed="true" title="Back to live prices (Esc)">REPLAY ✕</button>`;
    const H = HS.get(), st = H.status;
    if (HS.ready()) return `<button type="button" class="mref sm-rpbtn" data-replay title="Play the last weeks or months back on the map">▶ REPLAY</button>`;
    if (st.error && !st.loading) return `<button type="button" class="mref sm-rpbtn" data-replay title="${esc("The price history didn't download: " + st.error)}">REPLAY · RETRY</button>`;
    return `<button type="button" class="mref sm-rpbtn" disabled aria-busy="true" title="Downloading a year of daily prices for the replay">REPLAY · LOADING${st.progress ? " " + Math.round(st.progress * 100) + "%" : "…"}</button>`;
  }
  /** Per-day colors for the span, once per span (and per entry): the layout stays as it is. */
  function buildFrames() {
    const H = HS.get(), n = H.data.dates.length, e = n - 1, s = Math.max(0, e - Math.min(BR.SPANS[R.span], n - 1));
    const groups = M.snap.sectors.map((sec) => sec.firms.map((f) => ({ row: H.index.get(f.sym) ?? -1, cap: f.cap })));
    R.fr = BR.replayFrames(H.P, groups, s, e); R.P = H.P; R.index = H.index;
    R.s = s; R.e = e; R.len = R.fr.len; R.dates = H.data.dates.slice(s + 1, e + 1); R.base = H.data.dates[s];
    R.i = 0;
    rpScrub.max = String(Math.max(0, R.len - 1));
  }
  /** The equal-weight line of the companies in view (all, or the open sector's), with its own scale. */
  function rpLine() {
    const secs = M.level ? [sectorOf(M.level)].filter(Boolean) : M.snap.sectors;
    const idx = secs.flatMap((x) => x.firms.map((f) => R.index.get(f.sym))).filter((i) => i != null);
    R.ew = BR.ewPath(R.P, idx, R.s, R.e);
    R.ewN = idx.length;
    const lo = Math.min(0, ...R.ew), hi = Math.max(0, ...R.ew), pad = (hi - lo) * 0.12 || 1, Y = (v) => 28 - ((v - lo + pad) / (hi - lo + 2 * pad)) * 26;
    const X = (k) => (R.len > 1 ? (k / (R.len - 1)) * 1000 : 500);
    rpLineEl.querySelector("polyline").setAttribute("points", Array.from(R.ew, (v, k) => `${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join(" "));
    const z = rpLineEl.querySelector("line.z"); z.setAttribute("y1", Y(0).toFixed(1)); z.setAttribute("y2", Y(0).toFixed(1));
    rp.querySelector(".sm-rp-ew span").textContent = `Equal-weight · ${R.ewN} cos`;
  }
  /** Per-frame updates of the transport (no DOM rebuilt). */
  function rpTick() {
    if (!R.on || !R.len) return;
    const k = Math.round(R.i), d = R.dates[k];
    if (+rpScrub.value !== k) rpScrub.value = String(k);
    if (rpDate.dataset.d !== String(d)) {
      rpDate.dataset.d = String(d); rpDate.textContent = fmtDay(d, true);
      rpDay.textContent = `Day ${k + 1} of ${R.len} · ${R.mode === "cum" ? "since the close of " + fmtDay(R.base) : "each day's own move"}`;
    }
    const v = R.ew?.[k];
    rpEw.textContent = v == null ? "—" : pct(v, 1); rpEw.className = cls(v);
    rpMk.style.left = (R.len > 1 ? (R.i / (R.len - 1)) * 100 : 0) + "%";
  }
  function rpControls() {
    rpPlay.textContent = R.playing ? "❚❚" : "▶"; rpPlay.setAttribute("aria-label", R.playing ? "Pause" : "Play");
    rp.querySelectorAll("[data-rpspeed]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.rpspeed === R.speed)));
    rp.querySelectorAll("[data-rpspan]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rpspan === R.span)));
    rp.querySelectorAll("[data-rpmode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rpmode === R.mode)));
  }
  function play() { if (!R.on) return; if (R.i >= R.len - 1) R.i = 0; R.playing = R.len > 1; rpControls(); kick(); }
  function pause() { if (!R.playing) return; R.playing = false; rpControls(); }
  function seek(i) { if (!R.on) return; R.i = clamp(i, 0, Math.max(0, R.len - 1)); rpTick(); draw(); }
  function enterReplay() {
    if (R.on) return exitReplay();
    if (!HS.ready()) { HS.want(); return; } // the button reads RETRY after a failed download
    if (!M.snap?.sectors?.length) return;
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    R.on = true; R.pending = null; hideTip();
    buildFrames(); rpLine();
    rp.hidden = false; rpDate.dataset.d = "";
    bar(); rpControls(); rpTick(); draw();
    play();
  }
  /** Back to live prices: the snapshot that arrived meanwhile (if any) is applied, exactly as take() would have. */
  function exitReplay() {
    if (!R.on) return;
    R.on = false; R.playing = false; R.fr = null; R.ew = null; rp.hidden = true; hideTip();
    const p = R.pending; R.pending = null;
    if (p) take(p); else refreshAll();
  }
  function setReplay(patch) {
    if (patch.speed) R.speed = patch.speed;
    if (patch.mode) R.mode = patch.mode;
    if (patch.span && patch.span !== R.span) { R.span = patch.span; buildFrames(); rpLine(); }
    try { localStorage.setItem("wire.map.rpspan", R.span); localStorage.setItem("wire.map.rpmode", R.mode); } catch {}
    rpDate.dataset.d = ""; rpControls(); rpTick(); bar(); draw();
    if (R.playing) kick();
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
    if (!SCALE[p] || p === M.period || R.on) return;
    M.prev = M.period; M.period = p; M.pk = 0;
    try { localStorage.setItem("wire.map.period", p); } catch {}
    bar(); detail(); kick();
  }
  function zoomIn(id) {
    if (!sectorOf(id)) return;
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    M.level = M.focus = id; M.zT = 1; M.sel = null; M.hover = null; hideTip();
    if (R.on) { rpLine(); rpTick(); }
    bar(); detail(); kick();
  }
  function zoomOut() {
    if (!M.level) return;
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    M.level = null; M.zT = 0; M.sel = null; M.hover = null; hideTip();
    if (R.on) { rpLine(); rpTick(); }
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
    if (R.on) { R.pending = s; return; } // the replay keeps today's layout; the newest snapshot is applied when it ends
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
      const t = h.t, v = t.v;
      const when = !R.on ? M.period : R.mode === "cum" ? `${fmtDay(R.base)} → ${fmtDay(R.dates[Math.round(R.i)])}` : `on ${fmtDay(R.dates[Math.round(R.i)], true)}`;
      tip.innerHTML = t.kind === "firm"
        ? `<b>${esc(t.f.sym)}</b> ${esc(t.f.name)}<br><span class="${cls(v)}">${pct(v)}</span> ${when} · ${cap(t.f.cap)}${t.f.industry ? `<br><span class="dim">${esc(t.f.industry)}</span>` : ""}`
        : `<b>${esc(t.s.sec.name)}</b><br><span class="${cls(v)}">${pct(v)}</span> ${when} · ${cap(t.s.sec.cap)}<br><span class="dim">Click to open its ${t.s.sec.firms.length} largest companies</span>`;
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
    if (e.target.closest("[data-replay]")) return enterReplay();
    const rb = e.target.closest("[data-rp]");
    if (rb) return rb.dataset.rp === "close" ? exitReplay() : R.playing ? pause() : play();
    const sp = e.target.closest("[data-rpspeed]"); if (sp) return setReplay({ speed: +sp.dataset.rpspeed });
    const sn = e.target.closest("[data-rpspan]"); if (sn) return setReplay({ span: sn.dataset.rpspan });
    const md = e.target.closest("[data-rpmode]"); if (md) return setReplay({ mode: md.dataset.rpmode });
    const ln = e.target.closest(".sm-rp-line");
    if (ln && R.len > 1) { const r = ln.getBoundingClientRect(); return seek(Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * (R.len - 1))); }
    const per = e.target.closest("[data-per]"); if (per) return setPeriod(per.dataset.per);
    const mode = e.target.closest("[data-mode]"); if (mode) return setThree(mode.dataset.mode === "3d");
    if (e.target.closest("[data-up]")) return zoomOut();
    if (e.target.closest("[data-ref]")) return reload();
  });
  // dragging the scrubber takes over from the player
  rpScrub.addEventListener("input", () => { pause(); seek(+rpScrub.value); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  // the replay button follows the download
  HS.on(() => { if (M.visible) bar(); });
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
      HS.want();
    },
    hide() { M.visible = false; hideTip(); pause(); },
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (R.on) {
        const k = e.key, onScrub = e.target === rpScrub;
        if (k === "Escape") { e.preventDefault(); return exitReplay(); }
        if (k === " ") {
          e.preventDefault(); if (e.target.closest?.("button")) e.target.blur(); // so the focused button isn't also pressed on key-up
          return R.playing ? pause() : play();
        }
        if (k === "ArrowLeft" || k === "ArrowRight" || k === "Home" || k === "End") {
          if (onScrub) return; // the range input moves itself and reports it through "input"
          e.preventDefault(); pause();
          return seek(k === "Home" ? 0 : k === "End" ? R.len - 1 : Math.round(R.i) + (k === "ArrowRight" ? 1 : -1));
        }
        if (/^[1-6]$/.test(k)) return; // periods are off while replaying
      }
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
