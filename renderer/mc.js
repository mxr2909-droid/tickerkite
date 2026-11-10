/* Tickerkite Portfolio Monte Carlo page (Equity › MC). Registers with app.js through window.WirePages.
   Three headline stats, the Simulated Portfolio Paths chart (percentile bands, median, benchmark median, a sample of
   100 runs) and the Ending Outperformance vs. Benchmark histogram. src/montecarlo.js runs the 10,000 simulations and
   sends back everything drawn here; this file only draws. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const M = { active: false, res: null, busy: false, seq: 0, horizon: "1Y", capital: null, benchmark: "SPY", paths: true, mode: "usd" };
  try { Object.assign(M, JSON.parse(localStorage.getItem("wire.mc") || "{}")); } catch {}
  const save = () => { try { localStorage.setItem("wire.mc", JSON.stringify({ horizon: M.horizon, capital: M.capital, benchmark: M.benchmark, paths: M.paths, mode: M.mode })); } catch {} };
  const HORIZONS = [["6M", "6 months"], ["1Y", "1 year"], ["3Y", "3 years"], ["5Y", "5 years"], ["10Y", "10 years"]];

  const usd = (v) => (v == null || !isFinite(v) ? "—" : (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 }));
  const usdShort = (v) => { const a = Math.abs(v), s = v < 0 ? "−$" : "$"; return a >= 1e9 ? s + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B" : a >= 1e6 ? s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e4 ? s + (a / 1e3).toFixed(0) + "K" : a >= 1e3 ? s + (a / 1e3).toFixed(1) + "K" : s + a.toFixed(0); };
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%");
  const pts = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const share = (v) => (v > 0 && v < 0.1 ? "<0.1" : v.toFixed(1)) + "%";
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const date = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const chartW = () => Math.max(420, Math.min(1050, ($("#mc").clientWidth || 800) - 48 - 30));
  let lastW = 0;
  new ResizeObserver(() => { const w = chartW(); if (M.active && M.res?.ok && Math.abs(w - lastW) > 30) drawCharts(); }).observe($("#mc"));

  /** Round axis steps: about n ticks covering lo..hi. */
  function ticks(lo, hi, n = 5) {
    const raw = (hi - lo) / n || 1, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }

  // ---------- page ----------
  function render() {
    if (!M.active) return;
    const el = $("#mc"), r = M.res;
    if (!r) { el.innerHTML = window.WireUI.skeleton("chart", { label: "Running 10,000 simulations of your portfolio…" }); return; }
    if (r.empty) {
      el.innerHTML = window.WireUI.empty("Add your holdings first", "The simulation runs on what you own. Add holdings on the Portfolio page, then come back.", `<button type="button" class="es-btn" data-go="portfolio">Open Portfolio</button>`);
      return;
    }
    const cap = M.capital != null ? String(M.capital) : "";
    const head = `<div class="yc-head"><div><h2>Portfolio Monte Carlo</h2>
        <p class="dim">10,000 possible futures for your holdings at today's weights, against a benchmark · resampled from real trading days</p></div></div>
      <form class="mc-ctl" id="mcForm" autocomplete="off">
        <span class="mc-lab">Time frame</span>
        <span class="yc-spans mc-h">${HORIZONS.map(([k, l]) => `<button type="button" data-h="${k}" aria-pressed="${k === M.horizon}" title="${l}">${k}</button>`).join("")}</span>
        <label>Starting capital <span class="mc-in"><i>$</i><input name="capital" value="${esc(cap)}" placeholder="${r.portfolioValue ? esc(Math.round(r.portfolioValue).toLocaleString("en-US")) : "10,000"}" inputmode="decimal" aria-label="Starting capital in dollars" title="Leave empty to start from your portfolio's value today"></span></label>
        <label>Benchmark <input name="bench" class="mc-b" value="${esc(M.benchmark)}" spellcheck="false" maxlength="15" aria-label="Benchmark ticker" title="Any ticker Yahoo Finance carries: SPY, QQQ, VT, AGG…"></label>
        <button type="submit" class="yc-btn mc-run" ${M.busy ? "disabled" : ""}>${M.busy ? "Running…" : "↻ Run"}</button>
      </form>`;
    if (!r.ok) { el.innerHTML = `<div class="yc mc">${head}${window.WireUI.error(r.error || "The simulation didn't run.", "data-run")}</div>`; return; }
    const e = r.end, o = r.out, c = r.capital, med = e.port.p50, bn = esc(r.benchmark);
    const tiles = `<div class="yc-sps mc-tiles">
      <div class="yc-sp"><span>Median ending value</span><b>${usd(med)}</b><em><i class="${cls(med - c)}">${pct((med / c - 1) * 100)}</i><i>${bn} ${usd(e.bench.p50)}</i></em></div>
      <div class="yc-sp"><span>Chance of beating ${bn}</span><b>${o.ahead.toFixed(0)}<small>%</small></b><em><i>median gap ${pts(o.median)} pts</i></em></div>
      <div class="yc-sp"><span>Chance of ending below ${usd(c)}</span><b>${e.probLoss.toFixed(0)}<small>%</small></b><em><i>${bn} ${e.benchProbLoss.toFixed(0)}%</i></em></div></div>`;
    el.innerHTML = `<div class="yc mc${M.busy ? " mc-busy" : ""}">${head}${tiles}
      <div class="yc-card" id="mcPaths">
        <div class="yc-ct mc-ct"><b>Simulated Portfolio Paths</b>
          <span class="mc-meta num">${esc(r.horizonLabel)} · starting capital <b>${usd(c)}</b> · <b>${r.runs.toLocaleString("en-US")}</b> runs</span>
          <span class="yc-spans"><button type="button" data-mode="usd" aria-pressed="${M.mode === "usd"}" title="Vertical axis: portfolio value in dollars (V)">Value $</button><button type="button" data-mode="ret" aria-pressed="${M.mode === "ret"}" title="Vertical axis: cumulative return since the start (V)">Return %</button></span>
          <button type="button" class="yc-tog" data-paths aria-pressed="${M.paths}" title="Show or hide the ${r.sample} individual runs (P)">Individual runs</button></div>
        <div class="mc-plot" id="mcPlot"></div></div>
      <div class="yc-card" id="mcOut">
        <div class="yc-ct mc-ct"><b>Ending Outperformance vs. Benchmark</b>
          <span class="mc-meta">each run's ending return minus ${bn}'s, in percentage points</span></div>
        <div class="mc-plot" id="mcHist"></div></div>
      <p class="yc-src">History used: ${date(r.history.from)} to ${date(r.history.to)} (${r.history.days.toLocaleString("en-US")} trading days of Yahoo Finance dividend-adjusted closes). Weights are held at today's mix. Same holdings, prices and settings give the same result. A simulation of what history makes plausible, not a forecast and not investment advice.</p></div>`;
    drawCharts();
  }
  function drawCharts() { lastW = chartW(); drawPaths(); drawHist(); }

  /** A tooltip that follows the pointer inside a .mc-plot box. */
  function tipFor(box) {
    const tip = document.createElement("div");
    tip.className = "mc-tip num"; tip.hidden = true; box.appendChild(tip);
    return {
      show(html, xFrac) { tip.innerHTML = html; tip.hidden = false; const right = xFrac > 0.6; tip.style.left = right ? "" : `calc(${xFrac * 100}% + 14px)`; tip.style.right = right ? `calc(${(1 - xFrac) * 100}% + 14px)` : ""; },
      hide() { tip.hidden = true; }
    };
  }

  // ---------- Simulated Portfolio Paths ----------
  function drawPaths() {
    const box = $("#mcPlot"), r = M.res; if (!box || !r?.ok) return;
    const W = chartW(), H = Math.round(Math.max(300, Math.min(400, W * 0.4))), pl = 56, pr = 132, pt = 14, pb = 28;
    const cap = r.capital, ret = M.mode === "ret", n = r.t.length;
    const tv = (v) => (ret ? (v / cap - 1) * 100 : v);
    const fmtAx = (v) => (ret ? pct(v, 0) : usdShort(v));
    const fmt = (v) => (ret ? pct((v / cap - 1) * 100) : usd(v));
    // the scale covers the 1st to 99th percentile; the few sample runs beyond it are clipped at the frame
    let lo = Math.min(tv(cap), ...r.port.p1.map(tv), ...r.bench.p50.map(tv)), hi = Math.max(tv(cap), ...r.port.p99.map(tv), ...r.bench.p50.map(tv));
    const pad = (hi - lo) * 0.04 || 1; lo -= pad; hi += pad;
    const t0 = r.t[0], t1 = r.t[n - 1];
    const X = (t) => pl + ((t - t0) / (t1 - t0)) * (W - pl - pr), Y = (v) => pt + (1 - (tv(v) - lo) / (hi - lo)) * (H - pt - pb);
    const line = (arr) => arr.map((v, i) => `${X(r.t[i]).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const band = (a, b) => `${line(a)} ${b.map((v, i) => `${X(r.t[i]).toFixed(1)},${Y(v).toFixed(1)}`).reverse().join(" ")}`;

    let g = `<svg viewBox="0 0 ${W} ${H}" class="yc-svg mc-svg" role="img" aria-label="Simulated portfolio value over ${esc(r.horizonLabel)}: median ${fmt(r.end.port.p50)}, 5th to 95th percentile ${fmt(r.end.port.p5)} to ${fmt(r.end.port.p95)}, ${esc(r.benchmark)} median ${fmt(r.end.bench.p50)}">
      <defs><clipPath id="mcClip"><rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}"/></clipPath></defs>`;
    for (const v of ticks(lo, hi, 7)) { const y = pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="yc-grid"/><text x="${pl - 7}" y="${y + 3.5}" class="yc-ax" text-anchor="end">${fmtAx(v)}</text>`; }
    // date labels follow the horizon: months for 6 months and a year, half-years for 3 years, years beyond
    const stepM = r.days <= 130 ? 1 : r.days <= 260 ? 2 : r.days <= 760 ? 6 : r.days <= 1300 || W > 700 ? 12 : 24;
    const d = new Date(t0); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    let first = true;
    for (d.setUTCMonth(d.getUTCMonth() + 1); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const mi = d.getUTCFullYear() * 12 + d.getUTCMonth(); if (mi % stepM) continue;
      const x = X(d.getTime()); if (x < pl + 44 || x > W - pr - 6) continue;
      const mon = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), yy = "’" + String(d.getUTCFullYear()).slice(2);
      const lab = stepM >= 12 ? String(d.getUTCFullYear()) : stepM === 6 || first || d.getUTCMonth() === 0 ? `${mon} ${yy}` : mon;
      g += `<line x1="${x}" x2="${x}" y1="${H - pb}" y2="${H - pb + 4}" class="yc-grid"/><text x="${x}" y="${H - 8}" class="yc-ax" text-anchor="middle">${lab}</text>`;
      first = false;
    }
    g += `<text x="${pl}" y="${H - 8}" class="yc-ax" text-anchor="middle">Today</text>`;
    g += `<g clip-path="url(#mcClip)"><polygon points="${band(r.port.p95, r.port.p5)}" class="mc-b90"/><polygon points="${band(r.port.p75, r.port.p25)}" class="mc-b50"/>`;
    if (M.paths) g += `<g class="mc-runs">${r.paths.map((p) => `<polyline points="${line(p)}"/>`).join("")}</g>`;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(cap)}" y2="${Y(cap)}" class="mc-start"/>
      <polyline points="${line(r.bench.p50)}" class="mc-bench"/><polyline points="${line(r.port.p50)}" class="mc-med"/></g>`;
    g += `<text x="${pl + 6}" y="${Y(cap) + 13}" class="yc-ax mc-startl">Start ${ret ? "0%" : usd(cap)}</text>`;
    // median ending values, readable without hovering; nudged apart when the two lines end close together
    const xe = W - pr;
    let yp = Y(r.end.port.p50), yb = Y(r.end.bench.p50);
    if (Math.abs(yp - yb) < 30) { const mid = (yp + yb) / 2, up = yp <= yb ? -1 : 1; yp = mid + up * 15; yb = mid - up * 15; }
    const endLab = (y0, y, c, name, v) => `<path d="M${xe} ${y0.toFixed(1)}L${xe + 8} ${y.toFixed(1)}h5" class="${c} mc-lead"/><circle cx="${xe}" cy="${y0.toFixed(1)}" r="3.5" class="${c}-dot"/>
      <text x="${xe + 17}" y="${y - 2}" class="mc-endv">${fmt(v)}</text><text x="${xe + 17}" y="${y + 10}" class="yc-ax">${name}</text>`;
    g += endLab(Y(r.end.port.p50), yp, "mc-med", "portfolio median", r.end.port.p50) + endLab(Y(r.end.bench.p50), yb, "mc-bench", `${esc(r.benchmark)} median`, r.end.bench.p50);
    g += `<g id="mcHover" style="display:none"><line class="fx-cross" y1="${pt}" y2="${H - pb}" x1="0" x2="0"/><circle r="4" class="mc-med-dot mc-ring"/><circle r="4" class="mc-bench-dot mc-ring"/></g>
      <rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent" id="mcHit"/></svg>`;
    box.innerHTML = g + `<div class="yc-leg mc-leg"><span><i class="mc-k-med"></i>Portfolio median</span><span><i class="mc-k-b50"></i>25th–75th percentile</span><span><i class="mc-k-b90"></i>5th–95th percentile</span>
      <span><i class="mc-k-bench"></i>${esc(r.benchmark)} median</span><span><i class="mc-k-start"></i>Starting capital</span>${M.paths ? `<span><i class="mc-k-run"></i>${r.sample} of the ${r.runs.toLocaleString("en-US")} runs</span>` : ""}</div>`;

    const svg = box.querySelector("svg"), hov = box.querySelector("#mcHover"), tip = tipFor(box);
    const [xl, dp, db] = hov.children;
    svg.addEventListener("mousemove", (e) => {
      const b = svg.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * W;
      if (x < pl - 4 || x > W - pr + 4) { hov.style.display = "none"; tip.hide(); return; }
      const t = t0 + ((x - pl) / (W - pl - pr)) * (t1 - t0);
      let i = 0; while (i < n - 1 && Math.abs(r.t[i + 1] - t) <= Math.abs(r.t[i] - t)) i++;
      const px = X(r.t[i]), p = r.port, both = (v) => `<b>${usd(v)}</b> <span class="dim">${pct((v / cap - 1) * 100)}</span>`;
      xl.setAttribute("x1", px); xl.setAttribute("x2", px);
      dp.setAttribute("cx", px); dp.setAttribute("cy", Y(p.p50[i])); db.setAttribute("cx", px); db.setAttribute("cy", Y(r.bench.p50[i]));
      hov.style.display = "";
      tip.show(`<div class="mc-tt">${i === 0 ? "Today" : date(r.t[i])}</div>
        <div><i class="mc-k-med"></i><span>Portfolio median</span>${both(p.p50[i])}</div>
        <div><i class="mc-k-b90"></i><span>5th–95th percentile</span><b>${fmt(p.p5[i])} to ${fmt(p.p95[i])}</b></div>
        <div><i class="mc-k-bench"></i><span>${esc(r.benchmark)} median</span>${both(r.bench.p50[i])}</div>`, px / W);
    });
    svg.addEventListener("mouseleave", () => { hov.style.display = "none"; tip.hide(); });
  }

  // ---------- Ending Outperformance vs. Benchmark ----------
  function drawHist() {
    const box = $("#mcHist"), r = M.res; if (!box || !r?.ok) return;
    const o = r.out, bins = o.bins, W = chartW(), H = 200, pl = 56, pr = 132, pt = 26, pb = 40;
    const lo = bins[0].lo, hi = bins[bins.length - 1].hi, top = Math.max(...bins.map((b) => b.n)) || 1;
    const X = (v) => pl + ((v - lo) / (hi - lo)) * (W - pl - pr), Y = (c) => pt + (1 - c / top) * (H - pt - pb), base = H - pb;
    const bw = X(bins[0].hi) - X(bins[0].lo), gap = bw > 6 ? 2 : 1;
    let g = `<svg viewBox="0 0 ${W} ${H}" class="yc-svg mc-svg" role="img" aria-label="Ending outperformance against ${esc(r.benchmark)}: ahead in ${share(o.ahead)} of runs, behind in ${share(o.behind)}, tied in ${share(o.tied)}">`;
    for (const v of ticks(0, (top / r.runs) * 100, 3).slice(1)) { const y = Y((v / 100) * r.runs); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="yc-grid"/><text x="${pl - 7}" y="${y + 3.5}" class="yc-ax" text-anchor="end">${v}%</text>`; }
    g += `<text x="${pl - 7}" y="${pt - 12}" class="yc-ax" text-anchor="end">of runs</text>`;
    bins.forEach((b, i) => {
      const h = b.n ? Math.max(1.5, base - Y(b.n)) : 0, side = b.hi <= 0 ? "mc-neg" : "mc-pos";
      if (h) g += `<path d="M${(X(b.lo) + gap / 2).toFixed(1)} ${base}v${(-h + Math.min(2, h)).toFixed(1)}q0 ${-Math.min(2, h)} ${Math.min(2, bw / 2)} ${-Math.min(2, h)}h${(bw - gap - 2 * Math.min(2, bw / 2)).toFixed(1)}q${Math.min(2, bw / 2)} 0 ${Math.min(2, bw / 2)} ${Math.min(2, h)}v${(h - Math.min(2, h)).toFixed(1)}z" class="${side}" data-i="${i}"/>`;
    });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${base}" y2="${base}" class="yc-zero"/>`;
    const step = ticks(lo, hi, Math.max(4, Math.floor((W - pl - pr) / 90)));
    for (const v of step) { if (v === 0) continue; const x = X(v); g += `<line x1="${x}" x2="${x}" y1="${base}" y2="${base + 4}" class="yc-grid"/><text x="${x}" y="${base + 15}" class="yc-ax" text-anchor="middle">${pts(v, Math.abs(v) < 1 || v % 1 ? 1 : 0)}</text>`; }
    // zero, marked clearly: a full-height line with the split of runs on either side
    const xz = X(0), xc = Math.max(pl + 118, Math.min(W - pr - 118, xz));
    g += `<line x1="${xz}" x2="${xz}" y1="${pt - 8}" y2="${base + 5}" class="mc-zero"/><text x="${xz}" y="${base + 15}" class="mc-zl" text-anchor="middle">0</text>
      <text x="${xc - 8}" y="${pt - 12}" class="mc-side" text-anchor="end"><tspan class="mc-sn">${share(o.behind)}</tspan> behind</text>
      <text x="${xc + 8}" y="${pt - 12}" class="mc-side"><tspan class="mc-sn">${share(o.ahead)}</tspan> ahead</text>
      <text x="${(pl + W - pr) / 2}" y="${H - 6}" class="yc-ax" text-anchor="middle">← behind ${esc(r.benchmark)} · percentage points · ahead of ${esc(r.benchmark)} →</text>`;
    // hit targets: the full column, wider than the bar
    bins.forEach((b, i) => { g += `<rect x="${X(b.lo).toFixed(1)}" y="${pt}" width="${bw.toFixed(1)}" height="${base - pt}" fill="transparent" data-i="${i}" class="mc-hit"/>`; });
    g += `</svg>`;
    const d = (v) => pts(v) + " pts";
    box.innerHTML = g + `<div class="yc-leg mc-leg mc-split"><span><i class="mc-k-pos"></i>Ahead <b>${share(o.ahead)}</b></span><span><i class="mc-k-neg"></i>Behind <b>${share(o.behind)}</b></span><span>Tied <b>${share(o.tied)}</b> <em class="dim">(within ±${o.tie} pts)</em></span>
      <span class="dim">Median gap <b>${d(o.median)}</b> · 9 runs in 10 land between <b>${d(o.p5)}</b> and <b>${d(o.p95)}</b></span></div>`;
    const svg = box.querySelector("svg"), tip = tipFor(box);
    let on = null;
    const clear = () => { if (on) on.classList.remove("on"); on = null; tip.hide(); };
    svg.addEventListener("mousemove", (e) => {
      const hit = e.target.closest?.(".mc-hit"); if (!hit) return clear();
      const i = +hit.dataset.i, b = bins[i];
      if (on) on.classList.remove("on");
      on = svg.querySelector(`path[data-i="${i}"]`); on?.classList.add("on");
      const e = (v) => pts(v, o.width >= 1 ? 0 : 1) + " pts";
      const edge = i === 0 && o.under ? `${e(b.hi)} or worse` : i === bins.length - 1 && o.over ? `${e(b.lo)} or better` : `${e(b.lo)} to ${e(b.hi)}`;
      tip.show(`<div class="mc-tt">${edge}</div><div><i class="${b.hi <= 0 ? "mc-k-neg" : "mc-k-pos"}"></i><span>${b.hi <= 0 ? "Behind" : "Ahead of"} ${esc(r.benchmark)}</span><b>${b.n.toLocaleString("en-US")} runs</b> <span class="dim">${share((b.n / r.runs) * 100)}</span></div>`, (X(b.lo) + bw / 2) / W);
    });
    svg.addEventListener("mouseleave", clear);
  }

  // ---------- side panel ----------
  function renderDetail() {
    if (!M.active || window.WireInstrument?.isOpen()) return;
    const el = $("#mcdetail"), r = M.res;
    if (!r) { el.innerHTML = window.WireUI.skeleton("detail"); return; }
    if (!r.ok) { el.innerHTML = `<h1>Portfolio Monte Carlo</h1><p class="dim">${r.empty ? "Add holdings on the Portfolio page to run it." : esc(r.error || "")}</p>`; return; }
    const e = r.end, c = r.capital, row = (label, k) => `<tr><td>${label}</td><td><b>${usd(e.port[k])}</b> <span class="${cls(e.port[k] - c)}">${pct((e.port[k] / c - 1) * 100, 0)}</span></td><td>${usd(e.bench[k])} <span class="${cls(e.bench[k] - c)}">${pct((e.bench[k] / c - 1) * 100, 0)}</span></td></tr>`;
    el.innerHTML = `<h1>After ${esc(r.horizonLabel)}</h1>
      <p class="dim">Where ${usd(c)} ends up across ${r.runs.toLocaleString("en-US")} runs</p>
      <table class="yc-tab mc-tab num"><thead><tr><th>Outcome</th><th>Portfolio</th><th>${esc(r.benchmark)}</th></tr></thead><tbody>
        ${row("Good (95th)", "p95")}${row("75th", "p75")}${row("Median", "p50")}${row("25th", "p25")}${row("Bad (5th)", "p5")}</tbody></table>
      <div class="isec">WHAT WAS SIMULATED</div>
      <dl class="kv num mc-kv">${r.holdings.map((h) => `<dt title="${esc(h.name || h.sym)}">${esc(h.sym)}</dt><dd><b>${h.weight.toFixed(1)}%</b>${h.flat ? ' <span class="dim">· held flat (cash)</span>' : ""}</dd>`).join("")}
        <dt>Benchmark</dt><dd>${esc(r.benchmark)} <span class="dim">· ${esc(r.benchName || "")}</span></dd></dl>
      ${r.excluded.length ? `<p class="yc-note"><b>Left out:</b> ${r.excluded.map((x) => `${esc(x.sym)} (${esc(x.why)})`).join(", ")}. The other holdings were scaled up to 100%.</p>` : ""}
      ${r.history.days < 1800 && r.history.limitedBy ? `<p class="yc-note">Only ${(r.history.days / 252).toFixed(1)} years of history are used because ${esc(r.history.limitedBy)} has no prices before ${date(r.history.from)}.</p>` : ""}
      <div class="isec">HOW TO READ IT</div>
      <p class="yc-note">Each run builds a possible future out of 20-day stretches of real past trading days, picked at random. Your portfolio and the benchmark always get the same days, so they rise and fall together the way they really have.</p>
      <p class="yc-note">The bold line is the middle run at each date. Half of all runs sit inside the darker band and nine in ten inside the lighter one. The thin lines are ${r.sample} individual runs, the same ${r.sample} every time.</p>
      <p class="yc-note">It assumes the future draws from the last ${(r.history.days / 252).toFixed(0)} years, that you keep today's mix (rebalanced daily), and no deposits, withdrawals, fees or taxes. Foreign holdings are simulated in their own currency.</p>`;
  }

  // ---------- running ----------
  async function run() {
    const seq = ++M.seq;
    M.busy = true; render();
    window.WireChrome?.pulled("mc", "RUNNING…");
    const res = await api.page.invoke("mc:run", { horizon: M.horizon, capital: M.capital, benchmark: M.benchmark }).catch((e) => ({ ok: false, error: String(e.message || e) }));
    if (seq !== M.seq) return;
    M.busy = false; M.res = res;
    if (res.benchmark) M.benchmark = res.benchmark;
    window.WireChrome?.pulled("mc", res.ok ? res.at : null);
    window.WireChrome?.status("mc", res.ok ? `${res.horizon} · ${res.runs.toLocaleString("en-US")} RUNS` : "");
    render(); renderDetail();
  }
  const setHorizon = (h) => { if (h === M.horizon && M.res?.ok) return; M.horizon = h; save(); run(); };
  const setMode = (m) => { M.mode = m; save(); render(); };
  const togglePaths = () => { M.paths = !M.paths; save(); render(); };

  $("#mc").addEventListener("submit", (e) => {
    if (e.target.id !== "mcForm") return;
    e.preventDefault();
    const f = new FormData(e.target), cap = Number(String(f.get("capital") || "").replace(/[$,\s]/g, ""));
    M.capital = cap > 0 && isFinite(cap) ? cap : null;
    M.benchmark = String(f.get("bench") || "").trim().toUpperCase() || "SPY";
    save(); run();
  });
  $("#mc").addEventListener("click", (e) => {
    const h = e.target.closest("[data-h]"); if (h) return setHorizon(h.dataset.h);
    const m = e.target.closest("[data-mode]"); if (m) return setMode(m.dataset.mode);
    if (e.target.closest("[data-paths]")) return togglePaths();
    if (e.target.closest("[data-run]")) return run();
    const go = e.target.closest("[data-go]"); if (go) window.WireApp?.setPage(go.dataset.go);
  });

  (window.WirePages ||= {}).mc = {
    show() { M.active = true; render(); renderDetail(); if (!M.busy && (!M.res?.ok || Date.now() - M.res.at > 5 * 60e3)) run(); },
    hide() { M.active = false; },
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (/^[1-5]$/.test(e.key)) setHorizon(HORIZONS[+e.key - 1][0]);
      else if (e.key === "r") run();
      else if (e.key === "p" && M.res?.ok) togglePaths();
      else if (e.key === "v" && M.res?.ok) setMode(M.mode === "usd" ? "ret" : "usd");
    },
    restore() { renderDetail(); },
    detail: () => $("#mcdetail")
  };
})();
