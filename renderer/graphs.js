/* Tickerkite Graph workspace page. Registers with app.js through window.WirePages (see the "pages" section there).
   Chart any FRED series or Yahoo symbol: several series on shared or dual axes or rebased to 100,
   per-series transforms and moving averages, recession shading, percentile clipping, a hover
   crosshair, trend/horizontal-line annotations, saved charts and CSV/PNG/Excel export.
   The chart math at the top is pure and also loaded by test/graphs.test.js. */
(() => {
  const DAY = 864e5, YEAR = 365.25 * DAY;

  // ---------- math (pure) ----------
  /** Index of the last point at or before t, or -1. Points are [t, v], oldest first. */
  function atOrBefore(P, t) {
    let lo = 0, hi = P.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (P[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }
  /** level | yoy (% change vs a year earlier) | chg (change from the previous observation) */
  function transform(P, tf) {
    if (tf === "chg") return P.slice(1).map(([t, v], i) => [t, v - P[i][1]]);
    if (tf === "yoy") {
      const out = [];
      for (const [t, v] of P) {
        const j = atOrBefore(P, t - YEAR + 2 * DAY); // a couple of days' slack for month/quarter-start dates
        if (j < 0 || t - YEAR - P[j][0] > 40 * DAY || !P[j][1]) continue;
        out.push([t, (v / P[j][1] - 1) * 100]);
      }
      return out;
    }
    return P.slice();
  }
  /** Simple moving average over n observations. */
  function movingAverage(P, n) {
    n = Math.max(1, Math.floor(n));
    const out = [];
    let sum = 0;
    for (let i = 0; i < P.length; i++) {
      sum += P[i][1];
      if (i >= n) sum -= P[i - n][1];
      if (i >= n - 1) out.push([P[i][0], sum / n]);
    }
    return out;
  }
  /** Rebase every series to 100 at the first series' start date (each series' value on or just before it). */
  function normalize(list) {
    const t0 = list.find((P) => P.length)?.[0][0];
    if (t0 == null) return list.map(() => []);
    return list.map((P) => {
      let j = atOrBefore(P, t0);
      if (j < 0) j = 0;
      const base = P[j]?.[1];
      if (!base) return [];
      return P.filter((p) => p[0] >= P[j][0]).map(([t, v]) => [t, (v / base) * 100]);
    });
  }
  /** p-th percentile (0–100) with linear interpolation. */
  function percentile(vals, p) {
    const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
    if (!s.length) return NaN;
    const k = (s.length - 1) * (p / 100), f = Math.floor(k);
    return f + 1 < s.length ? s[f] + (s[f + 1] - s[f]) * (k - f) : s[f];
  }
  /** y-range: full min/max, or 1st–99th percentile when clip is on. */
  function yRange(vals, clip) {
    const v = vals.filter(Number.isFinite);
    if (!v.length) return [0, 1];
    let lo = clip ? percentile(v, 1) : Math.min(...v), hi = clip ? percentile(v, 99) : Math.max(...v);
    if (lo === hi) { lo -= Math.abs(lo) * 0.05 || 1; hi += Math.abs(hi) * 0.05 || 1; }
    return [lo, hi];
  }
  /** Runs of 1s in USREC as [start, end] (end = the next observation's date). */
  function recessionSpans(P) {
    const out = [];
    let s = null;
    P.forEach(([t, v], i) => {
      if (v >= 1 && s == null) s = t;
      if (v < 1 && s != null) { out.push([s, t]); s = null; }
      if (i === P.length - 1 && s != null) out.push([s, t + 31 * DAY]);
    });
    return out;
  }
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  /** Align series on the union of their dates: [[date, v1, v2, …]] with "" where a series has no observation. */
  function toTable(list) {
    const maps = list.map((P) => new Map(P.map(([t, v]) => [iso(t), v])));
    const dates = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();
    return dates.map((d) => [d, ...maps.map((m) => (m.has(d) ? +m.get(d).toPrecision(10) : ""))]);
  }
  /** CSV (sep ",") or TSV (sep "\t") text with a header row. */
  function toDelimited(header, rows, sep = ",") {
    const cell = (c) => {
      const s = String(c);
      if (sep === "\t") return s.replace(/[\t\r\n]+/g, " ");
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [header, ...rows].map((r) => r.map(cell).join(sep)).join("\n") + "\n";
  }
  /** Selected-series stats: latest, prior print, a year ago, and the latest's percentile of the full history. */
  function seriesStats(P) {
    if (!P.length) return null;
    const [t, v] = P[P.length - 1], j = atOrBefore(P, t - YEAR + 2 * DAY);
    const below = P.reduce((n, p) => n + (p[1] <= v ? 1 : 0), 0);
    return {
      latest: [t, v], prior: P.length > 1 ? P[P.length - 2] : null,
      yearAgo: j >= 0 && t - YEAR - P[j][0] <= 40 * DAY ? P[j] : null,
      pct: Math.round((below / P.length) * 100), n: P.length, since: P[0][0]
    };
  }
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  const M = { atOrBefore, seriesStats, ordinal, transform, movingAverage, normalize, percentile, yRange, recessionSpans, toTable, toDelimited };
  if (typeof window === "undefined") { module.exports = M; return; }

  // ---------- page ----------
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLORS = ["#8b93ff", "#7cc4f5", "#3ecf8e", "#f2b34a", "#e88ac0", "#f2706b"];
  const TFS = [["level", "Level"], ["yoy", "% YoY"], ["chg", "Change"]];
  const RANGES = ["6M", "YTD", "1Y", "2Y", "5Y", "10Y", "20Y", "MAX", "CUSTOM"];
  const blank = () => ({ name: "", series: [], range: "5Y", from: "", to: "", mode: "shared", rec: true, clip: false, notes: [] });
  const G = { active: false, spec: blank(), data: {}, rec: [], picks: null, saved: [], tool: "", msg: "", sel: 0, view: null };
  try { G.spec = { ...blank(), ...JSON.parse(localStorage.getItem("wire.graphs.spec") || "{}") }; } catch {}
  const persist = () => { try { localStorage.setItem("wire.graphs.spec", JSON.stringify(G.spec)); } catch {} };

  const label = (s) => { const d = G.data[s.src]; return (d?.title && !d.error ? d.title : s.src.replace(/^\w+:/, "")); };
  const short = (s) => s.src.replace(/^\w+:/, "");
  const tfName = (s) => (s.tf === "level" ? "" : ` (${TFS.find((x) => x[0] === s.tf)[1]})`);

  function fmtNum(v, span = Math.abs(v)) {
    if (!Number.isFinite(v)) return "—";
    const d = span >= 1000 ? 0 : span >= 20 ? 1 : span >= 1 ? 2 : 3;
    return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const dateLbl = (t, daily) => new Date(t).toLocaleDateString("en-US", { month: "short", day: daily ? "numeric" : undefined, year: "numeric", timeZone: "UTC" });

  async function load(src) {
    if (G.data[src] && !G.data[src].error) return;
    G.data[src] = { loading: true };
    const d = await api.page.invoke("graphs:series", src);
    G.data[src] = d;
    if (G.active) render();
  }
  async function add(input) {
    const raw = String(input || "").trim();
    if (!raw) return;
    const src = /^(fred|yahoo):/i.test(raw) ? raw.replace(/^(\w+):(.*)$/, (_m, k, id) => `${k.toLowerCase()}:${id.trim().toUpperCase()}`)
      : /[\^=.\-]/.test(raw) ? "yahoo:" + raw.toUpperCase() : "fred:" + raw.toUpperCase();
    if (G.spec.series.some((s) => s.src === src)) { G.msg = `${short({ src })} is already on the chart`; render(); return; }
    if (G.spec.series.length >= 6) { G.msg = "Up to 6 series per chart"; render(); return; }
    const used = new Set(G.spec.series.map((s) => s.color));
    G.spec.series.push({ src, tf: "level", ma: 0, axis: G.spec.series.length ? "R" : "L", color: COLORS.find((c) => !used.has(c)) || COLORS[0] });
    G.sel = G.spec.series.length - 1;
    G.msg = "";
    persist();
    render();
    await load(src);
    if (G.data[src]?.error) G.msg = G.data[src].error;
    render();
  }

  // ---------- series → what's drawn ----------
  function computed() {
    const S = G.spec.series.filter((s) => G.data[s.src]?.points);
    const full = S.map((s) => transform(G.data[s.src].points, s.tf));
    const ends = full.filter((P) => P.length);
    if (!ends.length) return null;
    const tMax = Math.max(...ends.map((P) => P[P.length - 1][0])), tMin = Math.min(...ends.map((P) => P[0][0]));
    let t0 = tMin, t1 = tMax;
    const yrs = { "6M": 0.5, "1Y": 1, "2Y": 2, "5Y": 5, "10Y": 10, "20Y": 20 }[G.spec.range];
    if (yrs) t0 = Math.max(tMin, tMax - yrs * YEAR);
    if (G.spec.range === "YTD") t0 = Math.max(tMin, Date.UTC(new Date(tMax).getUTCFullYear(), 0, 1));
    if (G.spec.range === "CUSTOM") {
      const f = Date.parse(G.spec.from), e = Date.parse(G.spec.to);
      if (Number.isFinite(f)) t0 = f;
      if (Number.isFinite(e)) t1 = e;
    }
    if (t1 <= t0) t1 = t0 + DAY;
    const cut = (P) => P.filter((p) => p[0] >= t0 && p[0] <= t1);
    let lines = full.map(cut);
    const norm = G.spec.mode === "norm";
    if (norm) lines = normalize(lines);
    const mas = S.map((s, i) => {
      if (!(s.ma > 1)) return null;
      const m = movingAverage(full[i], s.ma);
      if (!norm) return cut(m);
      const base = lines[i][0], j = base ? atOrBefore(full[i], base[0]) : -1;
      return j < 0 ? [] : cut(m).filter((p) => p[0] >= base[0]).map(([t, v]) => [t, (v / full[i][j][1]) * 100]);
    });
    return { S, full, lines, mas, t0, t1 };
  }

  // ---------- render ----------
  function render() {
    const sp = G.spec, box = $("#graphs");
    const picks = G.picks;
    const pickOpts = !picks ? "" : (picks.watch.length ? `<optgroup label="Watchlist">${picks.watch.map((p) => `<option value="${esc(p.src)}">${esc(p.name)} · ${esc(p.src.slice(6))}</option>`).join("")}</optgroup>` : "")
      + [...new Set(picks.indicators.map((p) => p.section))].map((sec) => `<optgroup label="Scorecard · ${esc(sec)}">${picks.indicators.filter((p) => p.section === sec).map((p) => `<option value="${esc(p.src)}">${esc(p.name)}</option>`).join("")}</optgroup>`).join("");
    const b = (attr, val, text, on, title = "") => `<button type="button" ${attr}="${val}" aria-pressed="${on}"${title ? ` title="${esc(title)}"` : ""}>${text}</button>`;
    box.innerHTML = `<div class="gbar">
        <input id="gadd" type="text" placeholder="FRED ID or symbol (UNRATE, ^GSPC)" spellcheck="false" autocomplete="off">
        <button type="button" id="gaddb">ADD</button>
        <select id="gpick" aria-label="Quick picks"><option value="">Quick picks…</option>${pickOpts}</select>
        <span class="gsep"></span>
        ${RANGES.map((r) => b("data-range", r, r, sp.range === r)).join("")}
        ${sp.range === "CUSTOM" ? `<input type="date" id="gfrom" value="${esc(sp.from)}"><input type="date" id="gto" value="${esc(sp.to)}">` : ""}
      </div>
      <div class="gbar">
        ${b("data-mode", "shared", "SHARED", sp.mode === "shared", "All series on one axis")}${b("data-mode", "dual", "DUAL", sp.mode === "dual", "Left and right axes (pick per series)")}${b("data-mode", "norm", "NORMALIZE", sp.mode === "norm", "Rebase to 100 at the start of the range")}
        <span class="gsep"></span>
        <label class="gcheck" title="Shade NBER recessions (FRED USREC)"><input type="checkbox" data-tog="rec"${sp.rec ? " checked" : ""}> NBER RECESSION</label>${b("data-tog", "clip", "CLIP 1–99%", sp.clip, "Fit the y-axis to the 1st–99th percentile")}
        <span class="gsep"></span>
        ${b("data-tool", "trend", "TREND LINE", G.tool === "trend", "Drag on the chart to draw")}${b("data-tool", "hline", "H-LINE", G.tool === "hline", "Click on the chart to add")}
        ${sp.notes.length ? `<button type="button" data-act="clearnotes" title="Click a line on the chart to remove just that one">CLEAR LINES</button>` : ""}
        <span class="gsep"></span>
        <button type="button" data-act="csv">CSV</button><button type="button" data-act="png">PNG</button><button type="button" data-act="copy" title="Tab-separated, paste into Excel">COPY FOR EXCEL</button>
        <span class="gsep"></span>
        <button type="button" data-act="save" class="gsave">SAVE</button><button type="button" data-act="new">NEW</button>
      </div>
      <div class="gchips">${sp.series.map((s, i) => {
        const d = G.data[s.src] || {};
        return `<div class="gchip${i === G.sel ? " sel" : ""}" data-i="${i}">
          <i style="background:${s.color}"></i><button type="button" class="gname" data-act="sel" title="${esc(s.src)}">${esc(short(s))}</button>
          ${d.loading ? `<span class="dim">loading…</span>` : d.error ? `<span class="dn">${esc(d.error)}</span>` : ""}
          <select data-f="tf" aria-label="Transform">${TFS.map(([k, n]) => `<option value="${k}"${s.tf === k ? " selected" : ""}>${n}</option>`).join("")}</select>
          <label title="Moving average length in observations (0 = off)">MA <input data-f="ma" type="number" min="0" max="999" value="${s.ma || 0}"></label>
          ${sp.mode === "dual" ? `<button type="button" data-act="axis" title="Axis">${s.axis === "L" ? "◀ L" : "R ▶"}</button>` : ""}
          <button type="button" data-act="rm" title="Remove">×</button></div>`;
      }).join("")}${G.msg ? `<span class="gmsg">${esc(G.msg)}</span>` : ""}</div>
      <div id="gchart"></div>`;
    draw();
    renderDetail();
  }

  function draw() {
    const box = $("#gchart");
    if (!box) return;
    const c = computed();
    G.view = null;
    if (!c) {
      box.innerHTML = G.spec.series.length ? window.WireUI.skeleton("chart", { label: "Loading series…" }) : `<div class="empty">Add a FRED series ID or a market symbol above, or pick from the scorecard indicators and your watchlist.<br>Try
        ${["UNRATE", "T10Y2Y", "CPIAUCSL", "^GSPC", "CL=F"].map((x) => `<button type="button" class="gtry" data-try="${x}">${x}</button>`).join(" ")}</div>`;
      return;
    }
    const W = Math.max(360, box.clientWidth - 62), H = Math.max(300, Math.min(640, window.innerHeight - box.getBoundingClientRect().top - 24));
    const dual = G.spec.mode === "dual";
    const padL = dual ? 58 : 8, padR = 62, padT = 30, padB = 22;
    const { S, full, lines, mas, t0, t1 } = c;
    const side = (i) => (dual ? S[i].axis : "R");
    const scales = {};
    for (const ax of dual ? ["L", "R"] : ["R"]) {
      const vals = [];
      S.forEach((s, i) => { if (side(i) === ax) { for (const p of lines[i]) vals.push(p[1]); for (const p of mas[i] || []) vals.push(p[1]); } });
      if (!vals.length) continue;
      let [lo, hi] = yRange(vals, G.spec.clip);
      const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
      scales[ax] = { lo, hi, Y: (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB), V: (y) => lo + (1 - (y - padT) / (H - padT - padB)) * (hi - lo) };
    }
    const axisOf = (k) => scales[k] || scales.R || scales.L;
    const X = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
    const T = (x) => t0 + ((x - padL) / (W - padL - padR)) * (t1 - t0);
    const pl = (P, Y) => { // at most ~2 points per pixel: keep each pixel column's min and max
      const out = [];
      let col = null, mn = null, mx = null;
      const flush = () => { if (mn) { out.push(mn[0] <= mx[0] ? mn : mx); if (mn !== mx) out.push(mn[0] <= mx[0] ? mx : mn); } };
      for (const p of P) {
        const cx = Math.round(X(p[0]));
        if (cx !== col) { flush(); col = cx; mn = mx = p; } else { if (p[1] < mn[1]) mn = p; if (p[1] > mx[1]) mx = p; }
      }
      flush();
      return out.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    };
    let g = `<svg id="gsvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Chart"><defs><clipPath id="gclip"><rect x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}"/></clipPath></defs>
      <rect width="${W}" height="${H}" fill="var(--bg)"/>`;
    if (G.spec.rec) for (const [a, b] of G.rec) {
      if (b < t0 || a > t1) continue;
      g += `<rect x="${X(Math.max(a, t0))}" y="${padT}" width="${Math.max(2, X(Math.min(b, t1)) - X(Math.max(a, t0)))}" height="${H - padT - padB}" fill="rgba(255,255,255,.08)"/>`;
    }
    for (const [ax, sc] of Object.entries(scales)) {
      for (let k = 0; k <= 4; k++) {
        const v = sc.lo + ((sc.hi - sc.lo) * k) / 4, y = sc.Y(v);
        if (ax === "R" || !scales.R) g += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#22262d"/>`;
        g += ax === "R" ? `<text x="${W - padR + 6}" y="${y + 3}" fill="#8c93a1" font-size="10">${fmtNum(v, sc.hi - sc.lo)}</text>`
          : `<text x="${padL - 6}" y="${y + 3}" fill="#8c93a1" font-size="10" text-anchor="end">${fmtNum(v, sc.hi - sc.lo)}</text>`;
      }
      if (sc.lo < 0 && sc.hi > 0 && G.spec.mode !== "norm") g += `<line x1="${padL}" x2="${W - padR}" y1="${sc.Y(0)}" y2="${sc.Y(0)}" stroke="#323843"/>`;
    }
    if (G.spec.mode === "norm" && scales.R) g += `<line x1="${padL}" x2="${W - padR}" y1="${scales.R.Y(100)}" y2="${scales.R.Y(100)}" stroke="#323843" stroke-dasharray="3 3"/>`;
    const span = (t1 - t0) / YEAR;
    if (span <= 2.2) {
      const d = new Date(t0), step = span <= 1.2 ? 1 : 3;
      for (let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; ; m += step) {
        const t = Date.UTC(y, m, 1); if (t > t1) break;
        const dt = new Date(t);
        g += `<text x="${X(t)}" y="${H - 6}" fill="#8c93a1" font-size="10" text-anchor="middle">${dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}${dt.getUTCMonth() === 0 ? " " + dt.getUTCFullYear() : ""}</text>`;
      }
    } else {
      const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear(), every = Math.max(1, Math.ceil((y1 - y0 + 1) / 10));
      for (let yr = y0 + 1; yr <= y1; yr++) if (!(yr % every)) g += `<text x="${X(Date.UTC(yr, 0, 1))}" y="${H - 6}" fill="#8c93a1" font-size="10" text-anchor="middle">${yr}</text>`;
    }
    g += `<g clip-path="url(#gclip)">`;
    S.forEach((s, i) => {
      const Y = axisOf(side(i)).Y;
      if (mas[i]?.length) g += `<polyline points="${pl(mas[i], Y)}" fill="none" stroke="${s.color}" stroke-width="1.2" stroke-dasharray="4 3" opacity=".75"/>`;
      if (lines[i].length) g += `<polyline points="${pl(lines[i], Y)}" fill="none" stroke="${s.color}" stroke-width="1.5"/>`;
    });
    G.spec.notes.forEach((n, k) => {
      const Y = axisOf(n.axis).Y;
      const [x1, y1, x2, y2] = n.type === "h" ? [padL, Y(n.v), W - padR, Y(n.v)] : [X(n.t1), Y(n.v1), X(n.t2), Y(n.v2)];
      g += `<g class="gnote" data-note="${k}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#e4e7ec" stroke-width="1.2"${n.type === "h" ? ` stroke-dasharray="6 3"` : ""}/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="9"><title>Click to remove</title></line></g>`;
      if (n.type === "h") g += `<text x="${W - padR - 4}" y="${Y(n.v) - 4}" fill="#e4e7ec" font-size="10" text-anchor="end" paint-order="stroke" stroke="#000" stroke-width="3">${fmtNum(n.v)}</text>`;
    });
    g += `</g>`;
    S.forEach((s, i) => { // latest value as a colored tag on its axis
      const P = lines[i]; if (!P.length) return;
      const sc = axisOf(side(i)), v = P[P.length - 1][1], y = Math.max(padT, Math.min(H - padB, sc.Y(v)));
      const x = side(i) === "L" && dual ? 2 : W - padR + 2, w = padR - 4;
      g += `<rect x="${x}" y="${y - 7}" width="${dual && side(i) === "L" ? padL - 4 : w}" height="14" fill="${s.color}"/><text x="${x + 4}" y="${y + 3.5}" fill="#000" font-size="10" font-weight="600">${fmtNum(v, sc.hi - sc.lo)}</text>`;
    });
    let lx = padL + 4;
    S.forEach((s, i) => {
      const P = full[i], last = P[P.length - 1];
      const daily = /daily/i.test(G.data[s.src]?.freq || "");
      const when = last ? new Date(last[0]).toLocaleDateString("en-US", { month: "2-digit", ...(daily ? { day: "2-digit" } : { year: "2-digit" }), timeZone: "UTC" }) : "";
      const txt = `${short(s)}${tfName(s)} ${last ? fmtNum(last[1]) + (pctUnit(s) ? "%" : "") : "—"} ${when}${s.ma > 1 ? ` · ${s.ma} MA` : ""}${dual ? (side(i) === "L" ? " (L)" : " (R)") : ""}`;
      const w = 22 + txt.length * 6.6;
      g += `<g><title>${esc(label(s))}</title><rect x="${lx}" y="5" width="${w}" height="17" fill="#13161b" stroke="${s.color}"/><rect x="${lx + 5}" y="10" width="7" height="7" fill="${s.color}"/><text x="${lx + 17}" y="17.5" fill="#e4e7ec" font-size="11">${esc(txt)}</text></g>`;
      lx += w + 6;
    });
    g += `<line id="gx" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="#4a5160" visibility="hidden"/><line id="gdraft" stroke="#8b93ff" stroke-width="1.2" visibility="hidden"/></svg><div class="tip" id="gtip" hidden></div>${statsHtml(c)}`;
    box.innerHTML = g;
    G.view = { W, H, padL, padR, padT, padB, X, T, scales, S, lines, side, axisOf, dual };
    box.dataset.tool = G.tool;
  }

  // ---------- chart interaction ----------
  function pt(e) {
    const svg = $("#gsvg"), r = svg.getBoundingClientRect(), v = G.view;
    return { x: ((e.clientX - r.left) / r.width) * v.W, y: ((e.clientY - r.top) / r.height) * v.H, rect: r };
  }
  const inPlot = (p) => { const v = G.view; return p.x >= v.padL && p.x <= v.W - v.padR && p.y >= v.padT && p.y <= v.H - v.padB; };
  const noteAxis = () => (G.view.dual ? G.spec.series[G.sel]?.axis || "L" : "R");
  let drag = null;
  function hover(e) {
    const v = G.view, p = pt(e), cross = $("#gx"), tip = $("#gtip");
    if (!inPlot(p)) { cross.setAttribute("visibility", "hidden"); tip.hidden = true; return; }
    const t = v.T(p.x);
    cross.setAttribute("x1", p.x); cross.setAttribute("x2", p.x); cross.setAttribute("visibility", "visible");
    const daily = v.S.some((s) => /daily/i.test(G.data[s.src]?.freq || ""));
    tip.innerHTML = `<div class="tt">${dateLbl(t, daily)}</div>` + v.S.map((s, i) => {
      const P = v.lines[i], j = atOrBefore(P, t);
      return `<div><i style="background:${s.color}"></i>${esc(short(s))} <b>${j < 0 ? "—" : fmtNum(P[j][1], Math.abs(P[j][1]))}</b>${j >= 0 && t - P[j][0] > 40 * DAY ? ` <span class="dim">${dateLbl(P[j][0])}</span>` : ""}</div>`;
    }).join("");
    tip.hidden = false;
    const left = (p.x / v.W) * p.rect.width;
    tip.style.left = (left > p.rect.width - 200 ? left - tip.offsetWidth - 12 : left + 12) + "px";
    tip.style.top = "34px";
  }
  document.addEventListener("mousemove", (e) => {
    if (!G.active || !G.view || !$("#gsvg")) return;
    if (drag) {
      const p = pt(e), d = $("#gdraft");
      d.setAttribute("x1", drag.x); d.setAttribute("y1", drag.y); d.setAttribute("x2", p.x); d.setAttribute("y2", p.y); d.setAttribute("visibility", "visible");
      return;
    }
    if (e.target.closest?.("#gchart")) hover(e);
  });
  document.addEventListener("mouseup", (e) => {
    if (!drag) return;
    const p = pt(e), a = drag, sc = G.view.axisOf(a.axis);
    drag = null;
    if (Math.hypot(p.x - a.x, p.y - a.y) > 6) {
      G.spec.notes.push({ type: "t", axis: a.axis, t1: G.view.T(a.x), v1: sc.V(a.y), t2: G.view.T(p.x), v2: sc.V(p.y) });
      persist();
    }
    render();
  });
  function chartDown(e) {
    if (!G.view || e.button !== 0) return;
    const note = e.target.closest(".gnote");
    if (note && !G.tool) { G.spec.notes.splice(+note.dataset.note, 1); persist(); render(); return; }
    const p = pt(e);
    if (!inPlot(p)) return;
    if (G.tool === "trend") { e.preventDefault(); drag = { x: p.x, y: p.y, axis: noteAxis() }; }
    else if (G.tool === "hline") { const ax = noteAxis(); G.spec.notes.push({ type: "h", axis: ax, v: G.view.axisOf(ax).V(p.y) }); persist(); render(); }
  }

  const pctUnit = (s) => s.tf === "yoy" || (s.tf !== "chg" && /percent/i.test(G.data[s.src]?.units || ""));
  function statsHtml(c) {
    const i = Math.max(0, c.S.indexOf(G.spec.series[G.sel])), s = c.S[i];
    if (!s) return "";
    const d = G.data[s.src], st = seriesStats(c.full[i]);
    if (!st) return "";
    const daily = /daily/i.test(d.freq || ""), u = pctUnit(s) ? "%" : "";
    const v = (p) => (p ? `<b>${fmtNum(p[1])}${u}</b> <span class="dim">${dateLbl(p[0], daily)}</span>` : "—");
    const id = short(s), fred = s.src.startsWith("fred:");
    return `<div class="gstats">
      <div class="gfreq">Frequency: ${esc((d.freq || "—").toLowerCase())} · <span style="color:${s.color}">${esc(label(s))}</span></div>
      <dl class="kv">
        <dt>Percentile</dt><dd><b>${ordinal(st.pct)}</b> of ${st.n.toLocaleString()} readings since ${new Date(st.since).getUTCFullYear()}</dd>
        <dt>Transform</dt><dd>${esc(TFS.find((x) => x[0] === s.tf)[1])}${s.ma > 1 ? ` · ${s.ma}-observation MA` : ""}${G.spec.mode === "norm" ? " · chart rebased to 100" : ""}</dd>
        <dt>Latest</dt><dd>${v(st.latest)}</dd>
        <dt>Prior</dt><dd>${v(st.prior)}</dd>
        <dt>1 year ago</dt><dd>${v(st.yearAgo)}</dd>
        <dt>Source</dt><dd>${fred ? "FRED" : "Yahoo"} · ${esc(id)}</dd>
      </dl>
      ${fred ? `<button type="button" class="gfred" data-url="https://fred.stlouisfed.org/series/${encodeURIComponent(id)}">OPEN ON FRED ↗</button>` : `<button type="button" class="gfred" data-inst="${esc(id)}">OPEN INSTRUMENT VIEW</button>`}
      ${G.spec.clip ? `<p class="gclipnote">Y-axis clipped to the 1st–99th percentile so one spike does not flatten the rest.</p>` : ""}
    </div>`;
  }

  // ---------- export ----------
  function exportTable() {
    const c = computed();
    if (!c) return null;
    const head = ["date"];
    const cols = [];
    c.S.forEach((s, i) => {
      head.push(`${short(s)}${tfName(s)}${G.spec.mode === "norm" ? " (=100)" : ""}`); cols.push(c.lines[i]);
      if (c.mas[i]?.length) { head.push(`${short(s)} ${s.ma} MA`); cols.push(c.mas[i]); }
    });
    return { head, rows: toTable(cols) };
  }
  const fname = () => G.spec.name || G.spec.series.map(short).join(" vs ") || "graph";
  async function doExport(kind) {
    const tb = exportTable();
    if (!tb) { G.msg = "Nothing to export yet"; render(); return; }
    if (kind === "copy") { await api.page.invoke("graphs:copy", toDelimited(tb.head, tb.rows, "\t")); G.msg = `Copied ${tb.rows.length} rows: paste into Excel`; }
    else if (kind === "csv") { G.lastFile = await api.page.invoke("graphs:csv", fname(), toDelimited(tb.head, tb.rows, ",")); G.msg = "Saved " + G.lastFile.split("/").pop(); }
    else {
      $("#gtip").hidden = true; $("#gx")?.setAttribute("visibility", "hidden");
      const r = $("#gsvg").getBoundingClientRect();
      G.lastFile = await api.page.invoke("graphs:png", fname(), { x: r.left, y: r.top, width: r.width, height: r.height });
      G.msg = "Saved " + G.lastFile.split("/").pop();
    }
    render();
  }

  // ---------- detail pane: series info + MY GRAPHS ----------
  function renderDetail() {
    const el = $("#gdetail");
    if (!el || window.WireInstrument?.isOpen()) return;
    const s = G.spec.series[G.sel], d = s && G.data[s.src];
    let info = `<p class="dim">Select a series to see its details.</p>`;
    if (s && d?.points) {
      const P = d.points, [lt, lv] = P[P.length - 1];
      info = `<h1>${esc(d.title)}</h1><dl class="kv gmeta">
        <dt>Source</dt><dd>${s.src.startsWith("fred:") ? `FRED · ${esc(short(s))}` : `Yahoo · ${esc(short(s))}`}${d.stale ? ` <span class="dn">offline copy</span>` : ""}</dd>
        ${d.units ? `<dt>Units</dt><dd>${esc(d.units)}</dd>` : ""}${d.freq ? `<dt>Frequency</dt><dd>${esc(d.freq)}</dd>` : ""}
        <dt>Latest</dt><dd><b>${fmtNum(lv)}</b> <span class="dim">${dateLbl(lt, /daily/i.test(d.freq))}</span></dd>
        <dt>History</dt><dd>${dateLbl(P[0][0])} – ${dateLbl(lt)} · ${P.length.toLocaleString()} obs</dd></dl>
        ${s.src.startsWith("fred:") ? `<button type="button" class="glink" data-url="https://fred.stlouisfed.org/series/${encodeURIComponent(short(s))}">Open on FRED ↗</button>` : `<button type="button" class="glink" data-inst="${esc(short(s))}">Open instrument view</button>`}`;
    } else if (d?.error) info = `<h1>${esc(short(s))}</h1><p class="dn">${esc(d.error)}</p>`;
    el.innerHTML = `${info}<div class="gsavedh">MY GRAPHS</div>${G.saved.length ? G.saved.map((x) => `<div class="gsaved${x.name === G.spec.name ? " on" : ""}"><button type="button" class="go" data-open="${esc(x.name)}"><span>${esc(x.name)}</span><span class="dim">${esc((x.spec.series || []).map(short).join(", "))}</span></button><button type="button" class="gdel" data-del="${esc(x.name)}" title="Delete">×</button></div>`).join("") : `<p class="dim">No saved graphs. Build a chart and press SAVE.</p>`}`;
  }
  function openSpec(spec) {
    G.spec = { ...blank(), ...JSON.parse(JSON.stringify(spec)) };
    G.sel = 0; G.tool = ""; G.msg = "";
    persist();
    render();
    for (const s of G.spec.series) load(s.src);
  }

  // ---------- events ----------
  $("#graphs").addEventListener("click", async (e) => {
    const t = e.target;
    const tr = t.closest("[data-try]"); if (tr) { add(tr.dataset.try); return; }
    const inst = t.closest("[data-inst]"); if (inst) { window.WireApp.openInstrument(inst.dataset.inst); return; }
    if (t.id === "gaddb") { add($("#gadd").value); return; }
    const r = t.closest("[data-range]"); if (r) { G.spec.range = r.dataset.range; persist(); render(); return; }
    const m = t.closest("[data-mode]"); if (m) { G.spec.mode = m.dataset.mode; persist(); render(); return; }
    const tg = t.closest("[data-tog]"); if (tg && tg.tagName !== "INPUT") { G.spec[tg.dataset.tog] = !G.spec[tg.dataset.tog]; persist(); render(); return; }
    const tl = t.closest("[data-tool]"); if (tl) { G.tool = G.tool === tl.dataset.tool ? "" : tl.dataset.tool; render(); return; }
    const a = t.closest("[data-act]"); if (!a) return;
    const i = +a.closest("[data-i]")?.dataset.i;
    const act = a.dataset.act;
    if (act === "rm") { G.spec.series.splice(i, 1); G.sel = Math.max(0, Math.min(G.sel, G.spec.series.length - 1)); persist(); render(); }
    else if (act === "sel") { G.sel = i; render(); }
    else if (act === "axis") { const s = G.spec.series[i]; s.axis = s.axis === "L" ? "R" : "L"; persist(); render(); }
    else if (act === "clearnotes") { G.spec.notes = []; persist(); render(); }
    else if (act === "csv" || act === "png" || act === "copy") doExport(act);
    else if (act === "new") { G.spec = blank(); G.sel = 0; G.msg = ""; persist(); render(); }
    else if (act === "save") {
      const box = a.closest(".gbar");
      if (box.querySelector("#gname")) return;
      a.insertAdjacentHTML("beforebegin", `<input id="gname" type="text" placeholder="Graph name" value="${esc(G.spec.name || fname())}">`);
      const inp = $("#gname"); inp.focus(); inp.select();
      inp.addEventListener("keydown", async (ev) => {
        if (ev.key === "Escape") { render(); return; }
        if (ev.key !== "Enter" || !inp.value.trim()) return;
        G.spec.name = inp.value.trim().slice(0, 80);
        G.saved = await api.page.invoke("graphs:save", G.spec.name, { ...G.spec });
        G.msg = `Saved “${G.spec.name}”`; persist(); render();
      });
    }
  });
  $("#graphs").addEventListener("mousedown", (e) => { if (e.target.closest("#gsvg")) chartDown(e); });
  $("#graphs").addEventListener("keydown", (e) => { if (e.target.id === "gadd" && e.key === "Enter") add(e.target.value); });
  $("#graphs").addEventListener("mouseleave", () => { $("#gx")?.setAttribute("visibility", "hidden"); const tip = $("#gtip"); if (tip) tip.hidden = true; });
  $("#graphs").addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "gpick") { add(t.value); return; }
    if (t.dataset.tog) { G.spec[t.dataset.tog] = t.checked; persist(); render(); return; }
    if (t.id === "gfrom" || t.id === "gto") { G.spec[t.id === "gfrom" ? "from" : "to"] = t.value; persist(); render(); return; }
    const i = +t.closest("[data-i]")?.dataset.i, s = G.spec.series[i];
    if (!s) return;
    if (t.dataset.f === "tf") s.tf = t.value;
    if (t.dataset.f === "ma") s.ma = Math.max(0, Math.min(999, Math.floor(+t.value || 0)));
    G.sel = i; persist(); render();
  });
  $("#gdetail").addEventListener("click", async (e) => {
    const o = e.target.closest("[data-open]");
    if (o) { const x = G.saved.find((g) => g.name === o.dataset.open); if (x) openSpec({ ...x.spec, name: x.name }); return; }
    const d = e.target.closest("[data-del]");
    if (d) { G.saved = await api.page.invoke("graphs:delete", d.dataset.del); if (G.spec.name === d.dataset.del) G.spec.name = ""; renderDetail(); return; }
    const inst = e.target.closest("[data-inst]"); if (inst) window.WireApp.openInstrument(inst.dataset.inst);
  });
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (G.active) draw(); }, 150); });

  (window.WirePages ||= {}).graphs = {
    async show() {
      G.active = true;
      render();
      for (const s of G.spec.series) load(s.src);
      const [picks, saved, rec] = await Promise.all([
        G.picks || api.page.invoke("graphs:picks"), api.page.invoke("graphs:list"), G.rec.length ? null : api.page.invoke("graphs:recessions")
      ]);
      G.picks = picks; G.saved = saved || [];
      if (rec) G.rec = recessionSpans(rec);
      if (G.active) render();
    },
    hide() { G.active = false; G.tool = ""; drag = null; },
    key(e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === "/") { e.preventDefault(); $("#gadd")?.focus(); }
      else if (e.key === "Escape" && G.tool) { G.tool = ""; render(); }
    },
    restore() { renderDetail(); },
    detail: () => $("#gdetail")
  };
})();
