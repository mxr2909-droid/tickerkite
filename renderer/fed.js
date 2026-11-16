/* Tickerkite Fed path page. Registers with app.js through window.WirePages (see the "pages" section there).
   Where fed funds futures say the Fed's rate is going, meeting by meeting, against the Fed's own dots;
   how that path moved over the last week and month, and the fan of how far it has swung over 1W / 1M / 3M;
   the Treasury curve and a money-market strip. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const F = { active: false, data: null, sel: null };

  // ---------- formatting ----------
  const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d) + "%");
  const bp = (v, sign = true) => (v == null || !Number.isFinite(v) ? "—" : `${sign && v > 0.05 ? "+" : ""}${v.toFixed(0) === "-0" ? "0" : v.toFixed(0)}bp`);
  const cls = (v, eps = 0.5) => (v == null ? "" : v > eps ? "up" : v < -eps ? "dn" : "");
  const odd = (p) => `${Math.round(p * 100)}%`;
  const day = (d, o = { month: "short", day: "numeric", year: "numeric" }) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  function meetingLabel(r) {
    const a = new Date(r.start + "T12:00:00Z"), b = new Date(r.date + "T12:00:00Z");
    const mo = (x) => x.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    return mo(a) === mo(b) ? `${mo(a)} ${a.getUTCDate()}–${b.getUTCDate()}` : `${mo(a)} ${a.getUTCDate()}–${mo(b)} ${b.getUTCDate()}`;
  }
  const yr = (r) => r.date.slice(0, 4);
  const moveWord = (r) => (r.dir === "hold" ? "hold" : `${Math.abs(r.move) > 37.5 ? 50 : 25}bp ${r.dir}`);
  const was = (path, date) => path?.rows.find((x) => x.date === date) || null;

  const PRIME = 3.12; // prime rate over fed funds, as in the reference layout
  const hikeCls = (v, eps = 0.5) => (v == null ? "" : v > eps ? "hk" : v < -eps ? "ct" : "");
  const short = (d) => day(d, { month: "short", day: "numeric" });
  const age = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 2 ? "just now" : m < 90 ? `${m} min ago` : `${Math.round(m / 60)}h ago`; };

  // ---------- charts ----------
  // series: { pts, cls, step, dots }; marks: diamonds at (i, v) with a label
  function lineChart({ w = 760, h = 210, xs, series, marks = [], fmtY = (v) => v.toFixed(2), pad = [44, 16, 22, 26] }) {
    const [L, R, T, B] = pad;
    const all = [...series.flatMap((s) => s.pts.filter((p) => p != null)), ...marks.map((m) => m.v)];
    if (!all.length) return "";
    let lo = Math.min(...all), hi = Math.max(...all);
    const span = Math.max(hi - lo, 0.25);
    lo -= span * 0.12; hi += span * 0.12;
    const X = (i) => L + (xs.length < 2 ? 0 : (i * (w - L - R)) / (xs.length - 1));
    const Y = (v) => T + ((hi - v) * (h - T - B)) / (hi - lo);
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      g += `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" class="fgrid"/><text x="${L - 6}" y="${Y(v) + 4}" class="fax" text-anchor="end">${fmtY(v)}</text>`;
    }
    xs.forEach((x, i) => { if (x) g += `<text x="${X(i)}" y="${h - 6}" class="fax" text-anchor="middle">${esc(x)}</text>`; });
    for (const s of series) {
      let d = "", last = null;
      s.pts.forEach((p, i) => {
        if (p == null) return;
        const x = X(i).toFixed(1), y = Y(p).toFixed(1);
        d += !d ? `M${x},${y}` : s.step ? `H${x}V${y}` : `L${x},${y}`;
        last = i;
      });
      if (s.step && last != null && last < xs.length - 1) d += `H${X(xs.length - 1).toFixed(1)}`;
      g += `<path d="${d}" class="fline ${s.cls}"/>`;
      if (s.dots) s.pts.forEach((p, i) => { if (p != null) g += `<circle cx="${X(i)}" cy="${Y(p)}" r="2.4" class="fpt ${s.cls}"/>`; });
    }
    for (const m of marks) {
      const x = X(m.i), y = Y(m.v), right = x > w * 0.7;
      g += `<g class="fdot"><path d="M${x},${y - 6}L${x + 6},${y}L${x},${y + 6}L${x - 6},${y}Z"/><text x="${x + (right ? -9 : 9)}" y="${y + 17}" text-anchor="${right ? "end" : "start"}">${esc(m.label)}</text></g>`;
    }
    return `<svg class="fchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
  }

  function pathChart(d) {
    const rows = d.path.rows;
    const xs = ["now", ...rows.map((r, i) => (i === 0 || yr(r) !== yr(rows[i - 1]) ? day(r.date, { month: "short", year: "2-digit" }) : day(r.date, { month: "short" })))];
    const pts = (p) => [p ? p.start : null, ...rows.map((r) => was(p, r.date)?.post ?? null)];
    const sepDay = short(d.sep.asOf).toUpperCase();
    const marks = [];
    for (const x of d.dots) {
      const i = rows.map((r) => yr(r)).lastIndexOf(x.year);
      if (i >= 0 && x.dot != null) marks.push({ i: i + 1, v: x.dot, label: `${sepDay} DOT, END-${x.year.slice(2)}: ${x.dot.toFixed(2)}` });
    }
    return lineChart({ xs, marks, series: [
      { pts: pts(d.m1), cls: "m1", step: true }, { pts: pts(d.w1), cls: "w1", step: true }, { pts: [d.path.start, ...rows.map((r) => r.post)], cls: "now", step: true }
    ] });
  }

  function curveChart(c) {
    const s = (row) => (row ? c.tenors.map((t) => row.y[t] ?? null) : []);
    return lineChart({ w: 420, h: 200, pad: [36, 10, 14, 24], xs: c.tenors.map((t, i) => (i % 2 ? "" : t)), series: [{ pts: s(c.y1), cls: "m1" }, { pts: s(c.m1), cls: "w1" }, { pts: s(c.now), cls: "now" }] });
  }

  // ---------- the fan: how the expected path has moved ----------
  // Bands: min–max of each meeting's implied rate over the last 3M (lightest), 1M, 1W (darkest); lines: today and 1W/1M/3M ago.
  const FAN_KEYS = [["w1", "1W", "1 week", "#a3aab8", "5 3"], ["m1", "1M", "1 month", "#7cc4f5", "4 3"], ["m3", "3M", "3 months", "#e88ac0", "2 3"]];
  const FAN = { show: { w1: true, m1: true, m3: true, dots: true }, key: null, t0: 0, w: 0, geo: null, hover: -1 };
  try { Object.assign(FAN.show, JSON.parse(localStorage.getItem("wire.fed.fan") || "{}")); } catch {}
  const f1 = (v) => v.toFixed(1);
  const bpS = (v) => (v == null || !Number.isFinite(v) ? "—" : `${Math.round(v) > 0 ? "+" : Math.round(v) < 0 ? "−" : ""}${Math.abs(Math.round(v))}bp`);
  const monthYear = (iso) => day(iso, { month: "long", year: "numeric" });
  const quarters = (bpv) => { const n = Math.abs(bpv) / 25; return `${n.toFixed(1) === "1.0" ? "1" : n.toFixed(1)} ${bpv < 0 ? (n.toFixed(1) === "1.0" ? "cut" : "cuts") : n.toFixed(1) === "1.0" ? "hike" : "hikes"}`; };
  const hasAgo = (fan, k) => fan.rows.some((r) => r.ago[k] != null);
  const hasBand = (fan, k) => fan.rows.some((r) => r.range[k]?.n > 1);
  // bands worth drawing, narrowest first: a wider window that reaches no further back (short history) would only repeat one
  const bandKeys = (fan) => {
    const out = [];
    for (const [k] of FAN_KEYS) { const w = fan.windows.find((x) => x.key === k); if (hasBand(fan, k) && !out.some((o) => o.since === w.since)) out.push(w); }
    return out.map((w) => w.key);
  };
  // Fed's own projection (SEP median) at the last meeting of each year in today's path
  const fanDots = (d) => (d.dots || []).map((x) => ({ ...x, i: d.fan.rows.map((r) => yr(r)).lastIndexOf(x.year) })).filter((x) => x.i >= 0 && x.dot != null);
  const windowName = (w) => (w.full ? `the last ${w.label}` : `the ${w.span} day${w.span === 1 ? "" : "s"} of saved prices`);

  /** Monotone cubic through the points (no overshoot between meetings); the same curve whichever way it is walked. */
  function smooth(p, move = "M") {
    const n = p.length, F2 = (v) => v.toFixed(1);
    if (!n) return "";
    let d = `${move}${F2(p[0][0])},${F2(p[0][1])}`;
    if (n < 2) return d;
    const dx = [], sl = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; sl[i] = (p[i + 1][1] - p[i][1]) / (dx[i] || 1e-9); }
    const m = [sl[0]];
    for (let i = 1; i < n - 1; i++) m[i] = sl[i - 1] * sl[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / sl[i - 1] + (dx[i] + 2 * dx[i - 1]) / sl[i]);
    m[n - 1] = sl[n - 2];
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${F2(p[i][0] + h)},${F2(p[i][1] + m[i] * h)} ${F2(p[i + 1][0] - h)},${F2(p[i + 1][1] - m[i + 1] * h)} ${F2(p[i + 1][0])},${F2(p[i + 1][1])}`;
    }
    return d;
  }

  /** The fan chart as SVG at width W. anim: null, or ms already elapsed in the entrance (re-renders mid-way pick it up). */
  function fanSvg(d, W, anim) {
    const fan = d.fan, rows = fan.rows, show = FAN.show;
    const H = 300, pl = 46, pr = 78, pt = 16, pb = 30, x0 = pl + 18;
    const t0 = Date.parse(fan.asOf), t1 = Date.parse(rows[rows.length - 1].date);
    const X = (iso) => x0 + ((Date.parse(iso) - t0) / (t1 - t0 || 1)) * (W - pr - x0);
    const dots = fanDots(d);
    const vals = [fan.start, ...(d.target || [])];
    for (const r of rows) { vals.push(r.now); for (const [k] of FAN_KEYS) { if (r.ago[k] != null) vals.push(r.ago[k]); if (r.range[k]) vals.push(r.range[k].lo, r.range[k].hi); } }
    for (const w of fan.windows) if (w.start?.lo != null) vals.push(w.start.lo, w.start.hi);
    dots.forEach((x) => vals.push(x.dot)); // scale doesn't jump when a toggle changes
    const lo = Math.floor((Math.min(...vals) - 0.04) / 0.25) * 0.25, hi = Math.ceil((Math.max(...vals) + 0.04) / 0.25) * 0.25;
    const Y = (v) => pt + ((hi - v) * (H - pt - pb)) / (hi - lo || 1);
    const xs = rows.map((r) => X(r.date));
    const delay = (ms) => `--d:${ms}ms`;
    let g = `<svg class="ffan-svg${anim != null ? " ffan-anim" : ""}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="How the market-implied fed funds path has moved"${anim != null ? ` style="--ago:-${Math.round(anim)}ms"` : ""}>`;
    // 25bp gridlines, every one labeled unless the range is wide
    const steps = Math.round((hi - lo) / 0.25), every = steps > 12 ? 2 : 1;
    for (let k = 0; k <= steps; k++) {
      const v = lo + k * 0.25, y = Y(v).toFixed(1);
      g += `<line x1="${pl}" x2="${W - pr + 8}" y1="${y}" y2="${y}" class="ffan-grid${Math.abs(v % 1) < 1e-9 ? " whole" : ""}"/>`;
      if (k % every === 0) g += `<text x="${pl - 6}" y="${+y + 3.5}" class="ffan-ax" text-anchor="end">${v.toFixed(2)}%</text>`;
    }
    // the Fed's current target range, as a shaded strip on the left edge
    if (d.target) g += `<rect x="${pl}" y="${Y(d.target[1]).toFixed(1)}" width="${x0 - pl - 3}" height="${Math.max(1, Y(d.target[0]) - Y(d.target[1])).toFixed(1)}" class="ffan-target"><title>Fed's target range ${d.target[0].toFixed(2)}–${d.target[1].toFixed(2)}%</title></rect>`;
    // x axis: today, then each meeting (thinned so labels don't collide)
    // x axis: today, then each meeting's month ("Dec ’26" at a new year), skipping any that would collide
    const labels = [{ x: x0, t: "today" }];
    rows.forEach((r, i) => labels.push({ x: xs[i], t: day(r.date, { month: "short" }) + (i === 0 || yr(r) !== yr(rows[i - 1]) ? ` ’${yr(r).slice(2)}` : "") }));
    const gap = (a, b) => ((a.t.length + b.t.length) / 2) * 6.6 + 8;
    const keep = [labels[0]];
    for (const l of labels.slice(1)) if (l.x - keep[keep.length - 1].x >= gap(l, keep[keep.length - 1])) keep.push(l);
    const end = labels[labels.length - 1]; // the last meeting always gets its label
    if (keep[keep.length - 1] !== end) { while (keep.length > 1 && end.x - keep[keep.length - 1].x < gap(end, keep[keep.length - 1])) keep.pop(); keep.push(end); }
    for (const l of keep) g += `<text x="${l.x.toFixed(1)}" y="${H - 10}" class="ffan-ax" text-anchor="middle">${esc(l.t)}</text>`;
    // the fan: widest band first so the narrower, darker ones sit on top
    const bk = bandKeys(fan);
    FAN_KEYS.map(([k]) => k).reverse().forEach((k, j) => {
      if (!bk.includes(k)) return;
      const w = fan.windows.find((x) => x.key === k), st = w.start?.lo != null ? w.start : { lo: fan.start, hi: fan.start };
      const up = [[x0, Y(st.hi)], ...rows.map((r, i) => [xs[i], Y(r.range[k].hi)])];
      const dn = [[x0, Y(st.lo)], ...rows.map((r, i) => [xs[i], Y(r.range[k].lo)])].reverse();
      g += `<path d="${smooth(up)}${smooth(dn, "L")}Z" class="ffan-band ${k}" style="${delay((2 - j) * 140)}"/>`;
    });
    // lines a week, a month and three months ago (dashed), then today's
    const line = (pts) => smooth(pts.filter((p) => p[1] != null).map(([x, v]) => [x, Y(v)]));
    FAN_KEYS.forEach(([k, , , color, dash], j) => {
      if (!show[k] || !hasAgo(fan, k)) return;
      const w = fan.windows.find((x) => x.key === k);
      const pts = [[x0, w.start?.ago ?? null], ...rows.map((r, i) => [xs[i], r.ago[k]])];
      // stop at the first meeting that had no contract yet (later ones are null too)
      const cut = pts.findIndex((p, i) => i > 0 && p[1] == null);
      g += `<path d="${line(cut > 0 ? pts.slice(0, cut) : pts)}" class="ffan-ago" stroke="${color}" stroke-dasharray="${dash}" style="${delay(450 + j * 80)}"/>`;
    });
    const nowPts = [[x0, fan.start], ...rows.map((r, i) => [xs[i], r.now])];
    g += `<path d="${line(nowPts)}" class="ffan-now" pathLength="1" style="${delay(380)}"/>`;
    g += `<circle cx="${x0}" cy="${Y(fan.start).toFixed(1)}" r="3.6" class="ffan-start"/><text x="${x0 + 7}" y="${(Y(fan.start) - 7).toFixed(1)}" class="ffan-ax">EFFR ${pct(fan.start)}</text>`;
    rows.forEach((r, i) => { g += `<circle cx="${xs[i].toFixed(1)}" cy="${Y(r.now).toFixed(1)}" r="3" class="ffan-pt" style="${delay(380 + Math.round(((xs[i] - x0) / (W - pr - x0 || 1)) * 900))}"/>`; });
    // Fed's own projection: year-end median dots
    if (show.dots) for (const x of dots) {
      const cx = xs[x.i], cy = Y(x.dot);
      g += `<g class="ffan-dot"><path d="M${f1(cx)},${f1(cy - 5.5)}L${f1(cx + 5.5)},${f1(cy)}L${f1(cx)},${f1(cy + 5.5)}L${f1(cx - 5.5)},${f1(cy)}Z"/><text x="${f1(cx)}" y="${f1(cy - 9)}" text-anchor="middle">Fed ${pct(x.dot)}</text><title>Fed's own projection for end-${esc(x.year)}: ${pct(x.dot)}</title></g>`;
    }
    // cuts / hikes priced by the last meeting, at the right end of today's line
    const last = rows[rows.length - 1], cum = (last.now - fan.start) * 100;
    g += `<text x="${(xs[xs.length - 1] + 9).toFixed(1)}" y="${(Y(last.now) + 4).toFixed(1)}" class="ffan-end ${cum < -2.5 ? "ct" : cum > 2.5 ? "hk" : ""}">${Math.abs(cum) < 2.5 ? "no move" : quarters(cum)}</text>`;
    // hover: crosshair snapped to the nearest meeting (moved in place by the mousemove handler)
    g += `<line class="ffan-x" x1="0" x2="0" y1="${pt}" y2="${H - pb}"/><circle class="ffan-ring" r="5.5" cx="0" cy="0"/>`;
    g += `<rect class="ffan-hit" x="${pl}" y="${pt}" width="${W - pl - 4}" height="${H - pt - pb}"/></svg>`;
    FAN.geo = { W, xs, ys: rows.map((r) => Y(r.now)) };
    return g;
  }

  /** Plain-English reading of the fan, from the data. */
  function fanReading(d) {
    const fan = d.fan, rows = fan.rows;
    const refK = ["m1", "w1", "m3"].find((k) => hasAgo(fan, k));
    const r = refK ? [...rows].reverse().find((x) => x.ago[refK] != null) : rows[rows.length - 1];
    const cum = (r.now - fan.start) * 100;
    let t = `By the ${monthYear(r.date)} meeting the market expects the rate at ${pct(r.now)}, ${Math.abs(cum) < 3 ? "about where it is now" : `about ${quarters(cum).replace(/(cuts?|hikes?)$/, "quarter-point $1")} from here`}.`;
    if (!refK) return t + " Tickerkite hasn't saved prices from a week ago yet, so it can't say how this has moved.";
    const ago = { m1: "a month ago", w1: "a week ago", m3: "three months ago" }[refK], ch = (r.now - r.ago[refK]) * 100;
    if (Math.abs(ch) < 5) t += ` That is about the same as ${ago} (${bpS(ch)}): the path has barely moved.`;
    else {
      const tilt = ch < 0 ? (cum > 3 ? "fewer hikes are priced in" : "more cuts have been priced in") : cum < -3 ? "fewer cuts are priced in" : "more hikes have been priced in";
      t += ` That is ${Math.abs(Math.round(ch))}bp ${ch < 0 ? "lower" : "higher"} than ${ago}: ${tilt}.`;
    }
    const w = [...fan.windows].reverse().find((x) => r.range[x.key]?.n > 1);
    if (w) {
      const g = r.range[w.key];
      t += g.hi - g.lo < 0.05 ? ` Over ${windowName(w)} it has stayed within ${pct(g.lo)}–${pct(g.hi)}.` : ` Over ${windowName(w)} the expectation for that meeting has ranged from ${pct(g.lo)} to ${pct(g.hi)}.`;
    }
    return t;
  }

  function fanTip(d, i) {
    const fan = d.fan, r = fan.rows[i], w3 = fan.windows.find((w) => w.key === "m3"), g = r.range.m3;
    const ch = FAN_KEYS.map(([k, s]) => `${s} ago ${r.ago[k] != null ? bpS((r.now - r.ago[k]) * 100) : "—"}`).join(" · ");
    const dot = FAN.show.dots && fanDots(d).find((x) => x.i === i);
    return `<b>${esc(day(r.date))} meeting${r.sep ? " · new projections" : ""}</b>
      <div>Implied rate today <b>${pct(r.now)}</b></div>
      <div class="tt">vs ${esc(ch)}</div>
      ${g && g.n > 1 ? `<div class="tt">${w3.full ? "3-month" : `${w3.span}-day`} range ${pct(g.lo)}–${pct(g.hi)}</div>` : ""}
      ${dot ? `<div class="tt">Fed's own projection, end-${esc(dot.year)}: ${pct(dot.dot)}</div>` : ""}`;
  }

  function fanCard(d) {
    const fan = d.fan;
    if (!fan?.rows?.length) return "";
    const tog = FAN_KEYS.map(([k, , label, color]) => {
      const ok = hasAgo(fan, k);
      return `<button type="button" class="ffan-tog" data-fan="${k}" aria-pressed="${ok && !!FAN.show[k]}"${ok ? "" : ` disabled title="No saved prices from ${label} ago yet"`}><i style="border-color:${color}"></i>${label} ago</button>`;
    }).join("") + (fanDots(d).length ? `<button type="button" class="ffan-tog" data-fan="dots" aria-pressed="${!!FAN.show.dots}"><i class="dia"></i>Fed's own projection</button>` : "");
    const bk = bandKeys(fan), bands = FAN_KEYS.filter(([k]) => bk.includes(k)).map(([k, , label]) => { const w = fan.windows.find((x) => x.key === k); return `<span><i class="ffan-sw ${k}"></i>range over ${w.full ? label : `${w.span} days`}</span>`; }).join("");
    const short3 = fan.windows.filter((w) => !w.full);
    const note = short3.length ? ` Tickerkite has ${short3[0].span ? `saved prices going back ${short3[0].span} day${short3[0].span === 1 ? "" : "s"}` : "no saved prices before today"}, so the ${short3.map((w) => w.label.replace(/s$/, "").replace(" ", "-")).join(" and ")} ${short3.length > 1 ? "views are" : "view is"} partial for now; they fill in as it keeps daily prices.` : "";
    return `<div class="ffan">
      <div class="isec fsec">HOW THE EXPECTED PATH HAS MOVED <span class="ffan-togs">${tog}</span></div>
      <div class="ffan-plot"></div><div class="tip ffan-tip" hidden></div>
      <div class="ffan-leg"><span><i class="ffan-ln"></i>today</span>${bands}${d.target ? `<span><i class="ffan-sw tgt"></i>Fed's target range</span>` : ""}</div>
      <p class="ffan-read">${esc(fanReading(d))}</p>
      <p class="fcap">Each band runs from the lowest to the highest rate the market priced for that meeting on any trading day in the window: a wide band means the expectation has swung around. Changes are in basis points (1bp = 0.01%).${esc(note)}</p></div>`;
  }

  /** Draw (or redraw) the fan into its card at the card's real width. Animates once per page show / new data date. */
  function drawFan() {
    const box = $("#fed .ffan-plot"), d = F.data;
    if (!box || !d?.fan?.rows?.length) return;
    const W = Math.max(320, Math.round(box.clientWidth || 700));
    const key = d.fan.asOf, now = performance.now();
    if (key !== FAN.key) { FAN.key = key; FAN.t0 = now; }
    const el = now - FAN.t0;
    FAN.w = W; FAN.hover = -1;
    box.innerHTML = fanSvg(d, W, el < 1800 ? el : null);
  }

  function fanHover(e) {
    const svg = e.target.closest?.(".ffan-svg"), tip = $("#fed .ffan-tip"), d = F.data;
    if (!tip) return;
    if (!svg || !FAN.geo || !d?.fan) {
      if (!tip.hidden || FAN.hover >= 0) { tip.hidden = true; $("#fed .ffan-svg")?.classList.remove("hov"); FAN.hover = -1; }
      return;
    }
    const box = svg.getBoundingClientRect(), x = ((e.clientX - box.left) * FAN.geo.W) / (box.width || 1);
    let i = 0;
    FAN.geo.xs.forEach((v, j) => { if (Math.abs(v - x) < Math.abs(FAN.geo.xs[i] - x)) i = j; });
    if (i !== FAN.hover) {
      FAN.hover = i;
      const cx = FAN.geo.xs[i].toFixed(1), cy = FAN.geo.ys[i].toFixed(1);
      svg.querySelector(".ffan-x")?.setAttribute("x1", cx); svg.querySelector(".ffan-x")?.setAttribute("x2", cx);
      svg.querySelector(".ffan-ring")?.setAttribute("cx", cx); svg.querySelector(".ffan-ring")?.setAttribute("cy", cy);
      svg.classList.add("hov");
      tip.innerHTML = fanTip(d, i);
      tip.hidden = false;
    }
    // place the tip beside the snapped meeting, inside the card
    const card = tip.parentElement.getBoundingClientRect(), sx = box.left - card.left + (FAN.geo.xs[i] * box.width) / FAN.geo.W, w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(0, sx + 14 + w > card.width ? sx - w - 14 : sx + 14)}px`;
    tip.style.top = `${Math.max(0, e.clientY - card.top - h - 12 < 0 ? e.clientY - card.top + 16 : e.clientY - card.top - h - 12)}px`;
  }

  // ---------- list ----------
  function tiles(d) {
    const p = d.path, rows = p.rows, next = rows[0], last = rows[rows.length - 1];
    const t = (label, big, sub, c = "") => `<div class="ftile"><span class="fl">${label}</span><b class="${c}">${big}</b><span>${sub}</span></div>`;
    let h = "";
    if (next) {
      const mv = Math.min(1, Math.abs(next.move) / 25), dir = next.move >= 0 ? "hike" : "cut";
      h += t(`NEXT FOMC · ${esc(short(next.date).toUpperCase())}`, odd(mv), `odds of a 25bp ${dir}`, mv >= 0.5 ? hikeCls(next.move) : "");
      h += t(`PRICED BY ${esc(day(last.date).toUpperCase())}`, bp(last.cum), `≈ ${Math.abs(last.cum / 25).toFixed(1)} ${last.cum >= 0 ? "hikes" : "cuts"}`, hikeCls(last.cum, 2));
    }
    h += p.extreme
      ? t(p.extreme.kind === "peak" ? "PEAK IMPLIED RATE" : "TROUGH IMPLIED RATE", pct(p.extreme.rate), `after the ${esc(day(p.extreme.date))} meeting`)
      : t("PEAK IMPLIED RATE", pct(p.start), "no move priced");
    const gap = [...d.dots].reverse().find((x) => x.gap != null);
    h += gap
      ? t(`MARKET VS. FED DOT (${esc(short(d.sep.asOf).toUpperCase())})`, bp(gap.gap), `market ${pct(gap.market)} vs. ${esc(short(d.sep.asOf))} median (end-${esc(gap.year.slice(2))})`, hikeCls(gap.gap, 2))
      : t("MARKET VS. FED DOT", "—", "no overlapping year");
    return `<div class="fsum">${h}</div>`;
  }

  function table(d) {
    const p = d.path;
    let h = `<div class="isec fsec">MEETING BY MEETING</div>
      <div class="frow fhead"><span>MEETING</span><span>IMPLIED RATE</span><span>MOVE (BP)</span><span>ODDS OF A 25BP MOVE</span><span>CUMULATIVE (BP)</span><span># HIKES</span><span>PRIME</span></div>
      <div class="frow ftoday"><span class="fm">Today <em>EFFR</em></span><span>${pct(p.start)}</span><span class="dim">—</span><span></span><span class="dim">—</span><span class="dim">—</span><span>${pct(p.start + PRIME)}</span></div>`;
    for (const r of p.rows) {
      const mv = Math.min(1, Math.abs(r.move) / 25), dir = r.move >= 0 ? "HIKE" : "CUT";
      h += `<button type="button" class="row frow" data-date="${r.date}" aria-selected="${r.date === F.sel}">
        <span class="fm">${esc(day(r.date))}${r.sep ? `<span class="x" title="Comes with new projections (dots)">SEP</span>` : ""}</span>
        <span>${pct(r.post)}</span>
        <span class="${hikeCls(r.move, 2)}">${bp(r.move)}</span>
        <span class="fodds" title="${odd(r.hold)} hold · ${odd(r.p25)} 25bp · ${odd(r.p50)} 50bp"><i class="${r.move >= 0 ? "hk" : "ct"}" style="width:${(mv * 100).toFixed(0)}%"></i><b>${odd(mv)} ${dir}</b></span>
        <span class="${hikeCls(r.cum, 2)}">${bp(r.cum)}</span>
        <span>${r.cum >= 0 ? "+" : "−"}${Math.abs(r.cum / 25).toFixed(2)}</span>
        <span>${pct(r.post + PRIME)}</span>
      </button>`;
    }
    return h;
  }

  function moved(d) {
    const p = d.path, ch = (o) => (o?.rows.length ? bp((p.end - o.end) * 100) : null);
    const w = ch(d.w1), m = ch(d.m1);
    const cap = w || m ? `End-of-path rate ${[w && `${w} vs. a week ago`, m && `${m} vs. a month ago`].filter(Boolean).join(", ")}.` : "Builds up as Tickerkite saves daily prices.";
    return `<div class="isec fsec">HOW THE PATH MOVED <span class="flegend"><i class="now"></i>today <i class="w1"></i>1 week ago <i class="m1"></i>1 month ago <i class="dot"></i>Fed median dot</span></div>
      ${pathChart(d)}<p class="fcap">${esc(cap)}</p>`;
  }

  function dotsTable(d) {
    return `<div class="isec fsec">MARKET VS FED DOTS <span class="dim">median fed funds projection, SEP of ${esc(day(d.sep.asOf))}${d.sep.live ? "" : ` · Tickerkite's checked copy (${esc(d.sepChecked)})`}</span></div>
      <div class="frow fdots fhead"><span>YEAR-END</span><span>FED DOT</span><span>PRIOR SEP</span><span>MARKET</span><span>MKT − DOT</span></div>
      ${d.dots.map((x) => `<div class="frow fdots"><span>${esc(x.year)}</span><span>${pct(x.dot)}</span><span class="dim">${pct(x.prior)}</span><span>${x.market == null ? `<span class="dim">${x.year === "Longer run" ? "—" : "past futures"}</span>` : pct(x.market)}</span><span class="${hikeCls(x.gap, 2)}">${x.gap == null ? "—" : bp(x.gap)}</span></div>`).join("")}`;
  }

  function side(d) {
    let h = "";
    const c = d.curve;
    if (c) {
      const row = (t) => {
        const v = c.now.y[t], m = c.m1?.y[t], y = c.y1?.y[t], dd = (a) => (a != null && v != null ? (v - a) * 100 : null);
        return `<div class="fcrow"><span>${t}</span><span>${pct(v)}</span><span class="${hikeCls(dd(m), 1)}">${bp(dd(m))}</span><span class="${hikeCls(dd(y), 1)}">${bp(dd(y))}</span></div>`;
      };
      h += `<div class="isec">TREASURY CURVE</div>
        <div class="flegend fl2"><i class="now"></i>${esc(short(c.now.date))} ${c.m1 ? `<i class="w1"></i>1 month ago` : ""} ${c.y1 ? `<i class="m1"></i>1 year ago` : ""}</div>
        ${curveChart(c)}
        <div class="fcrow fhead"><span></span><span>LEVEL</span><span>1M</span><span>1Y</span></div>${["3M", "2Y", "10Y", "30Y"].map(row).join("")}`;
    }
    h += `<div class="isec">MONEY MARKETS</div>${d.strip.map((s) => `<div class="fcrow fmm"><span>${esc(s.name)}</span><span>${pct(s.v)}</span><span class="${hikeCls(s.chg, 0.5)}">${bp(s.chg)}</span><span class="dim">1M</span></div>`).join("")}`;
    return `<div class="fside">${h}</div>`;
  }

  function render() {
    const el = $("#fed");
    const d = F.data;
    if (!d || d.loading) { el.innerHTML = window.WireUI.skeleton("chart", { label: "Loading fed funds futures, Fed projections and Treasury yields…" }); return; }
    const errs = Object.keys(d.errors || {});
    const right = [d.effr != null ? `EFFR <b>${pct(d.effr)}</b>` : "", d.quoteAt ? `futures ${esc(new Date(d.quoteAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}` : "",
      d.fetchedAt ? `data ${age(d.fetchedAt)}` : "", errs.length ? `unavailable: ${esc(errs.join(", "))}` : "", d.meetingsLive ? "" : "FOMC dates from Tickerkite's checked list"].filter(Boolean).join(" · ");
    let h = `<div class="fedbar"><span class="ftitle">FED FUNDS PATH, MARKET-IMPLIED</span>${d.target ? `<span class="dim">target ${d.target[0].toFixed(2)}–${d.target[1].toFixed(2)}%</span>` : ""}
      <span class="fnote">${right}</span><button type="button" class="frefresh" title="Refresh (r)">↻</button></div>`;
    let main = "";
    if (!d.path) main = `<div class="empty">Fed funds futures aren't available right now${d.errors?.futures ? ` (${esc(d.errors.futures)})` : ""}, so there's no market-implied path. Tickerkite won't guess one; press r to try again.</div>`;
    else main = tiles(d) + table(d) + moved(d) + fanCard(d);
    main += dotsTable(d);
    h += `<div class="fcols"><div class="fmain">${main}</div>${side(d)}</div>
      <p class="fsrc">CBOT 30-day fed funds futures via Yahoo Finance (delayed); implied rate = 100 − price, split around each meeting by days in the month (CME FedWatch method; odds are for one 25bp move). Dots = FOMC median year-end projection (Summary of Economic Projections). Prime = fed funds + ${PRIME.toFixed(2)}%. Yields: U.S. Treasury par yield curve. Rates: FRED.</p>`;
    const y = el.scrollTop;
    el.innerHTML = h;
    drawFan(); // before restoring the scroll, so the page keeps its height
    el.scrollTop = y;
    if (d.path && !d.path.rows.some((r) => r.date === F.sel)) F.sel = d.path.rows[0]?.date || null;
    mark();
    renderDetail();
  }
  function mark() { document.querySelectorAll("#fed .frow[data-date]").forEach((r) => r.setAttribute("aria-selected", String(r.dataset.date === F.sel))); }
  function select(date) {
    F.sel = date; mark();
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    renderDetail();
  }
  function move(k) {
    const rows = F.data?.path?.rows || [];
    const i = rows.findIndex((r) => r.date === F.sel);
    const n = rows[Math.max(0, Math.min(rows.length - 1, i + k))];
    if (n) { select(n.date); $("#fed").querySelector(`.frow[data-date="${n.date}"]`)?.scrollIntoView({ block: "nearest" }); }
  }

  // ---------- detail ----------
  let hlToken = 0;
  function renderDetail() {
    if (!F.active || window.WireInstrument?.isOpen()) return;
    const el = $("#fdetail"), d = F.data;
    const r = d?.path?.rows.find((x) => x.date === F.sel);
    if (!r) { el.innerHTML = `<div class="empty">${d?.path ? "Pick a meeting." : "No futures-implied path right now."}</div>`; return; }
    const w = was(d.w1, r.date), m = was(d.m1, r.date);
    const dirW = r.move >= 0 ? "hike" : "cut";
    const dot = d.dots.find((x) => x.year === yr(r));
    el.innerHTML = `
      <div class="dhead"><span class="code">FOMC</span><span class="nm">${r.sep ? "decision + projections" : "rate decision"}</span><span class="dt">${esc(day(r.date))}</span></div>
      <h1>${esc(meetingLabel(r))}, ${yr(r)}: market prices ${esc(r.dir === "hold" ? "a hold" : `a ${moveWord(r)}`)}</h1>
      <dl class="kv fkv">
        <dt>Decision</dt><dd>${esc(day(r.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }))} · 2:00 PM ET</dd>
        <dt>Rate before</dt><dd>${pct(r.pre, 3)}</dd>
        <dt>Rate after</dt><dd>${pct(r.post, 3)} <span class="${cls(r.move, 2)}">(${bp(r.move)})</span></dd>
        <dt>Vs today</dt><dd class="${cls(r.cum, 2)}">${bp(r.cum)} cumulative</dd>
        <hr>
        <dt>Hold</dt><dd>${odd(r.hold)}</dd>
        <dt>25BP ${dirW.toUpperCase()}</dt><dd>${odd(r.p25)}</dd>
        <dt>50BP ${dirW.toUpperCase()}</dt><dd>${odd(r.p50)}</dd>
        <hr>
        <dt>1 week ago</dt><dd>${w ? `${pct(w.post, 3)} <span class="${cls((r.post - w.post) * 100, 1)}">(${bp((r.post - w.post) * 100)} since)</span>` : `<span class="dim">no data yet</span>`}</dd>
        <dt>1 month ago</dt><dd>${m ? `${pct(m.post, 3)} <span class="${cls((r.post - m.post) * 100, 1)}">(${bp((r.post - m.post) * 100)} since)</span>` : `<span class="dim">no data yet</span>`}</dd>
        ${dot?.dot != null ? `<dt>${esc(dot.year)} DOT</dt><dd>${pct(dot.dot)} <span class="dim">Fed median for year-end</span></dd>` : ""}
      </dl>
      <p class="fnote2">Odds use the usual simplification: the expected move is split between the two nearest 25bp steps.</p>
      <div class="isec">RELATED TICKERKITE HEADLINES</div><div class="fhl"><p class="none">Searching…</p></div>`;
    const tok = ++hlToken;
    api.page.invoke("fed:headlines").then((hs) => {
      const box = el.querySelector(".fhl");
      if (tok !== hlToken || !box) return;
      box.innerHTML = hs.length ? hs.map((s) => `<button type="button" class="fstory" data-sid="${esc(s.id)}" data-url="${esc(s.url || "")}"><span class="h">${esc(s.title)}</span><span class="dim">${esc(s.publisher || "")}${s.ts ? " · " + esc(new Date(s.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) : ""}</span></button>`).join("")
        : `<p class="none">No Fed headlines in Tickerkite's current news.</p>`;
    });
  }

  // ---------- events ----------
  const refresh = () => { $("#fed .frefresh")?.classList.add("spin"); api.page.invoke("fed:refresh").then(apply); };
  $("#fed").addEventListener("click", (ev) => {
    if (ev.target.closest(".frefresh")) return refresh();
    const t = ev.target.closest(".ffan-tog");
    if (t) { if (t.disabled) return; FAN.show[t.dataset.fan] = !FAN.show[t.dataset.fan]; t.setAttribute("aria-pressed", String(FAN.show[t.dataset.fan])); try { localStorage.setItem("wire.fed.fan", JSON.stringify(FAN.show)); } catch {} return drawFan(); }
    if (ev.target.closest(".ffan-svg") && FAN.hover >= 0) { const r = F.data?.fan?.rows[FAN.hover]; if (r) select(r.date); return; } // picks the meeting for the detail pane, page stays put
    const r = ev.target.closest(".frow[data-date]"); if (r) select(r.dataset.date);
  });
  $("#fed").addEventListener("mousemove", fanHover);
  $("#fed").addEventListener("mouseleave", (e) => fanHover({ target: e.currentTarget }));
  // redraw just the fan at the new width when the pane is resized
  new ResizeObserver(() => { const b = $("#fed .ffan-plot"); if (F.active && b && Math.abs(b.clientWidth - FAN.w) > 24) drawFan(); }).observe($("#fed"));
  $("#fdetail").addEventListener("click", (ev) => {
    const s = ev.target.closest(".fstory");
    if (s && !window.WireInstrument.onStory?.(s.dataset.sid) && s.dataset.url) api.open?.(s.dataset.url);
  });
  function apply(d) { if (!d) return; F.data = d; window.WireChrome?.pulled("fed", d.fetchedAt); if (F.active) render(); }
  if (api?.page) {
    api.page.on("fed:update", apply);
    api.page.invoke("fed:get").then(apply);
  }

  (window.WirePages ||= {}).fed = {
    show() { F.active = true; FAN.key = null; render(); if (api?.page) api.page.invoke("fed:get").then(apply); },
    hide() { F.active = false; },
    key(e) {
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
      else if (e.key === "r") refresh();
    },
    restore() { renderDetail(); },
    detail: () => $("#fdetail")
  };
})();
