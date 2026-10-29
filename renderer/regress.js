/* Tickerkite Regression page (REG). Registers with app.js through window.WirePages.
   Data: market/economic series lined up on one frequency, or a table you paste or type.
   Models: simple linear, multiple linear and polynomial (ordinary least squares, fitted in src/regress.js). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const call = (ch, ...a) => api.page.invoke(ch, ...a);

  const TRANSFORMS = [["level", "Level"], ["pct", "% change"], ["yoy", "% vs a year ago"], ["diff", "Change"], ["log", "Log"]];
  const FREQS = [["D", "Daily"], ["W", "Weekly"], ["M", "Monthly"], ["Q", "Quarterly"]];
  const RANGES = [["5", "5Y"], ["10", "10Y"], ["20", "20Y"], ["0", "Max"]];
  const MODELS = [["linear", "Linear"], ["multiple", "Multiple"], ["poly", "Polynomial"]];

  const defaults = () => ({
    mode: "series",
    series: [{ key: "yahoo:^GSPC", transform: "pct", lag: 0 }, { key: "fred:DGS10", transform: "diff", lag: 0 }],
    freq: "M", range: "10", paste: "", yCol: null, xCols: [], model: "linear", degree: 2, holdout: 0
  });
  let R = defaults();
  try { R = { ...R, ...JSON.parse(localStorage.getItem("wire.regress") || "{}") }; } catch {}
  const K = { active: false, picks: null, table: null, data: null, res: null, err: null, busy: false, pred: null, seq: 0 };
  const save = () => { try { localStorage.setItem("wire.regress", JSON.stringify(R)); } catch {} };

  // ---------- formatting ----------
  function num(v, sig = 4) {
    if (v == null || !Number.isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a >= 1e4) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (a >= 100) return v.toFixed(1);
    if (a === 0) return "0";
    return Number(v.toPrecision(sig)).toString();
  }
  const pval = (p) => (p == null ? "—" : p < 0.001 ? "<0.001" : p.toFixed(3));
  const stars = (p) => (p == null ? "" : p < 0.01 ? "**" : p < 0.05 ? "*" : "");
  const r2cls = (r) => (r == null ? "" : r >= 0.5 ? "up" : r >= 0.2 ? "" : "dn");

  // ---------- page ----------
  function seriesRows() {
    const opts = (sel, list) => list.map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${l}</option>`).join("");
    return `<div class="rg-vars">
      <div class="rg-vh"><span>ROLE</span><span>SERIES (FRED ID OR TICKER)</span><span>TRANSFORM</span><span>LAG</span><span></span></div>
      ${R.series.map((s, i) => `<div class="rg-v" data-i="${i}">
        <span class="rg-role ${i ? "" : "y"}">${i ? `X${R.series.length > 2 ? i : ""}` : "Y"}</span>
        <input data-f="key" list="rgpicks" value="${esc(s.key)}" placeholder="e.g. UNRATE, NVDA, fred:CPIAUCSL" spellcheck="false">
        <select data-f="transform">${opts(s.transform, TRANSFORMS)}</select>
        <input data-f="lag" type="number" min="0" max="36" value="${s.lag || 0}" title="Periods to shift this series back: lag 3 on monthly data compares y today with x three months earlier">
        ${i > 1 ? `<button type="button" class="rg-x" data-act="rm" data-i="${i}" title="Remove">×</button>` : "<span></span>"}
      </div>`).join("")}
      <div class="rg-row"><button type="button" class="rg-btn" data-act="addx">+ ADD X</button>
        <label>FREQUENCY <select data-g="freq">${opts(R.freq, FREQS)}</select></label>
        <label>RANGE <select data-g="range">${opts(R.range, RANGES)}</select></label></div>
      <datalist id="rgpicks">${(K.picks?.indicators || []).map((p) => `<option value="${esc(p.src)}">${esc(p.name)}</option>`).join("")}${(K.picks?.watch || []).map((p) => `<option value="${esc(p.src)}">${esc(p.name)}</option>`).join("")}</datalist>
    </div>`;
  }

  function pasteArea() {
    const t = K.table;
    const cols = t?.ok ? t.names : [];
    const pick = cols.length ? `<div class="rg-row rg-cols">
        <label>Y <select data-g="yCol">${cols.map((c) => `<option${c === R.yCol ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
        <span class="rg-xs">X ${cols.filter((c) => c !== R.yCol).map((c) => `<label class="rg-chk"><input type="checkbox" data-x="${esc(c)}"${R.xCols.includes(c) ? " checked" : ""}> ${esc(c)}</label>`).join("")}</span>
        <span class="dim">${t.rows} rows${t.skipped ? ` · ${t.skipped} skipped (not all numbers)` : ""}</span></div>` : "";
    return `<textarea id="rgpaste" spellcheck="false" placeholder="Paste from Excel or Sheets, or type: one row per observation, columns separated by tabs, commas or spaces. The first row can be column names.&#10;&#10;Hours  Score&#10;1      52&#10;2      58&#10;4      71">${esc(R.paste)}</textarea>
      ${t && !t.ok ? `<p class="rg-err">${esc(t.error)}</p>` : ""}${pick}`;
  }

  function render() {
    if (!K.active) return;
    const tab = (v, l, key) => `<button type="button" data-${key}="${v}" aria-pressed="${R[key] === v}">${l}</button>`;
    $("#regress").innerHTML = `<div class="rg">
      <div class="rg-sec">DATA</div>
      <div class="rg-toggle">${tab("series", "MARKET SERIES", "mode")}${tab("paste", "MY DATA", "mode")}</div>
      ${R.mode === "series" ? seriesRows() : pasteArea()}
      <div class="rg-sec">MODEL</div>
      <div class="rg-row">
        <div class="rg-toggle">${MODELS.map(([v, l]) => tab(v, l, "model")).join("")}</div>
        ${R.model === "poly" ? `<label>DEGREE <select data-g="degree">${[2, 3, 4].map((d) => `<option${+R.degree === d ? " selected" : ""}>${d}</option>`).join("")}</select></label>` : ""}
        <label title="Fit on the first part of the data and test on the rest (the most recent stretch, for time series)">HOLD OUT <select data-g="holdout">${[[0, "None"], [20, "Last 20%"], [30, "Last 30%"]].map(([v, l]) => `<option value="${v}"${+R.holdout === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <button type="button" class="rg-fit" data-act="fit"${K.busy ? " disabled" : ""}>${K.busy ? "FITTING…" : "FIT ↵"}</button>
      </div>
      <p class="rg-hint">${({ linear: "Simple linear: y = a + b·x, using the first X.", multiple: "Multiple: y = a + b₁x₁ + b₂x₂ + …, using every X.", poly: "Polynomial: a curve in the first X, y = a + b·x + c·x² (+ …)." })[R.model]}</p>
      <div id="rgout">${results()}</div>
    </div>`;
    drawCharts();
    renderDetail();
  }

  function results() {
    if (K.err) return `<p class="rg-err">${esc(K.err)}</p>`;
    if (K.busy && !K.res) return window.WireUI?.skeleton ? window.WireUI.skeleton("rows", { n: 6, label: "Loading data and fitting…" }) : `<p class="dim">Loading data and fitting…</p>`;
    const r = K.res;
    if (!r) return `<p class="rg-empty">Pick a Y and at least one X, then press <b>FIT</b> (or Enter).</p>`;
    const eq = `${esc(r.equation.y)} = ${r.equation.terms.map((t, i) => `${i && t.coef >= 0 ? "+ " : i ? "− " : ""}${num(i ? Math.abs(t.coef) : t.coef)}${t.x ? ` · ${esc(t.x)}` : ""}`).join(" ")}`;
    const tile = (l, v, c = "", sub = "") => `<div class="rg-tile"><span>${l}</span><b class="${c}">${v}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
    return `<div class="rg-sec">RESULTS · ${esc(MODELS.find(([m]) => m === r.model)[1].toUpperCase())}${r.degree ? ` (DEGREE ${r.degree})` : ""}</div>
      <div class="rg-tiles">
        ${tile("R²", r.r2.toFixed(3), r2cls(r.r2), `explains ${(r.r2 * 100).toFixed(0)}% of the variation`)}
        ${tile("ADJ. R²", r.adjR2.toFixed(3), r2cls(r.adjR2), "penalized for extra terms")}
        ${tile("OBSERVATIONS", r.n, "", r.oos ? `+ ${r.oos.n} held out` : "")}
        ${tile("STD ERROR", num(r.se), "", "typical miss, in y's units")}
        ${tile("F-TEST p", pval(r.Fp), r.Fp != null && r.Fp < 0.05 ? "up" : "dn", r.Fp != null && r.Fp < 0.05 ? "model is significant" : "not significant")}
        ${r.oos ? tile("HELD-OUT R²", r.oos.r2 == null ? "—" : r.oos.r2.toFixed(3), r2cls(r.oos.r2), "on data it never saw") : ""}
      </div>
      <div class="rg-eq num">${eq}</div>
      <table class="rg-coef num"><thead><tr><th>TERM</th><th>COEFFICIENT</th><th>STD ERROR</th><th>t</th><th>p-VALUE</th>${r.vif?.length ? "<th>VIF</th>" : ""}</tr></thead><tbody>
        ${r.coefs.map((c, i) => `<tr><td>${esc(c.term)}</td><td>${num(c.coef)}${stars(c.p)}</td><td>${num(c.se)}</td><td>${c.t == null ? "—" : c.t.toFixed(2)}</td><td class="${c.p != null && c.p < 0.05 ? "up" : ""}">${pval(c.p)}</td>${r.vif?.length ? `<td class="${i && r.vif[i - 1] > 10 ? "dn" : ""}">${i ? num(r.vif[i - 1], 3) : ""}</td>` : ""}</tr>`).join("")}
      </tbody></table>
      <p class="rg-note">* p &lt; 0.05, ** p &lt; 0.01: unlikely to be zero by chance.${r.poly ? " Polynomial terms overlap with each other, so judge the curve by R² and the held-out test more than by each term's p-value." : ""}</p>
      ${formulas(r)}
      ${r.warnings.length ? `<ul class="rg-warn">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      <div class="rg-sec">${r.model === "multiple" ? "ACTUAL VS PREDICTED" : `${esc(r.equation.y)} VS ${esc(r.xNames[0])}`}</div>
      <div class="rg-chart" id="rgchart"></div>
      <div class="rg-sec">RESIDUALS <span class="dim">(actual − fitted; patterns or drift mean the model is missing something)</span></div>
      <div class="rg-chart small" id="rgresid"></div>`;
  }

  // ---------- formulas: the math behind every number above, with this fit's values ----------
  function formulas(r) {
    const k = r.k, n = r.n, df = r.df, yN = esc(r.equation.y);
    const general = r.model === "poly"
      ? `ŷ = a + b₁·x + b₂·x²${r.degree >= 3 ? " + b₃·x³" : ""}${r.degree >= 4 ? " + b₄·x⁴" : ""}`
      : r.model === "multiple" ? `ŷ = a + ${r.xNames.map((_, i) => `b${"₁₂₃₄₅₆₇"[i]}·x${"₁₂₃₄₅₆₇"[i]}`).join(" + ")}` : "ŷ = a + b·x";
    const vars = r.model === "multiple" ? r.xNames.map((x, i) => `x${"₁₂₃₄₅₆₇"[i]} = ${esc(x)}`).join(", ") : `x = ${esc(r.xNames[0])}`;
    const fitted = r.equation.terms.map((t, i) => `${i && t.coef >= 0 ? " + " : i ? " − " : ""}${num(i ? Math.abs(t.coef) : t.coef)}${t.x ? `·${esc(t.x)}` : ""}`).join("");
    const b1 = r.coefs[1];
    const row = (name, formula, value) => `<tr><th>${name}</th><td class="f">${formula}</td><td class="v">${value}</td></tr>`;
    let open = true; try { open = localStorage.getItem("wire.regress.formulas") !== "0"; } catch {}
    return `<details class="rg-f"${open ? " open" : ""}><summary>FORMULAS · HOW THESE NUMBERS ARE CALCULATED</summary>
      <table class="num"><tbody>
        ${row("Model", `${general}`, `${vars}, y = ${yN}`)}
        ${row("Fitted", `ŷ = ${fitted}`, `${n} observations`)}
        ${row("Estimation", "Ordinary least squares: choose the coefficients that make Σ(yᵢ − ŷᵢ)² as small as possible.<br>In matrix form <b>β̂ = (XᵀX)⁻¹ Xᵀy</b>" + (r.model === "linear" ? "; for one x: b = Σ(xᵢ − x̄)(yᵢ − ȳ) / Σ(xᵢ − x̄)², a = ȳ − b·x̄" : ""), `ȳ = ${num(r.ybar)}`)}
        ${row("Sum of squares", "SST = Σ(yᵢ − ȳ)² (total variation) · SSE = Σ(yᵢ − ŷᵢ)² (unexplained)", `SST = ${num(r.sst)}, SSE = ${num(r.sse)}`)}
        ${row("R²", "R² = 1 − SSE / SST", `1 − ${num(r.sse)} / ${num(r.sst)} = <b>${r.r2.toFixed(3)}</b>`)}
        ${row("Adjusted R²", "1 − (1 − R²)·(n − 1) / (n − k − 1), k = number of x terms", `1 − ${(1 - r.r2).toFixed(3)}·${n - 1}/${df} = <b>${r.adjR2.toFixed(3)}</b>`)}
        ${row("Std error", "s = √( SSE / (n − k − 1) ), the typical miss", `√(${num(r.sse)} / ${df}) = <b>${num(r.se)}</b>`)}
        ${row("Coef. std error", "SE(bⱼ) = s·√[ (XᵀX)⁻¹ ]ⱼⱼ", b1?.se != null ? `${esc(b1.term)}: ${num(b1.se)}` : "see table")}
        ${row("t-stat", "t = bⱼ / SE(bⱼ), with n − k − 1 degrees of freedom", b1?.se != null ? `${num(b1.coef)} / ${num(b1.se)} = <b>${b1.t.toFixed(2)}</b>, df = ${df}` : `df = ${df}`)}
        ${row("p-value", "p = P(|T| ≥ |t|) for a t-distribution with n − k − 1 df", b1 ? `${esc(b1.term)}: ${pval(b1.p)}` : "")}
        ${row("F-test", "F = (R² / k) / ((1 − R²) / (n − k − 1)), on k and n − k − 1 df", r.F != null ? `<b>${r.F.toFixed(2)}</b> on ${k} and ${df} df, p = ${pval(r.Fp)}` : "—")}
        ${row("Prediction", "ŷ₀ ± t₀.₉₇₅ · s · √( 1 + x₀ᵀ (XᵀX)⁻¹ x₀ ), the 95% range in the right pane", `t₀.₉₇₅ = ${r.tcrit.toFixed(3)} for ${df} df`)}
        ${r.vif?.length ? row("VIF", "VIFⱼ = 1 / (1 − Rⱼ²), Rⱼ² from regressing xⱼ on the other x's; above 10 = trouble", r.vif.map((v) => num(v, 3)).join(", ")) : ""}
        ${r.oos ? row("Held-out R²", "1 − Σ(yᵢ − ŷᵢ)² / Σ(yᵢ − ȳ_test)² over the held-out points, using the fitted coefficients", `<b>${r.oos.r2 == null ? "—" : r.oos.r2.toFixed(3)}</b> on ${r.oos.n} points`) : ""}
        ${r.poly ? row("Polynomial note", "Fitted on standardized x, z = (x − x̄)/σ, so the powers don't swamp each other, then expanded back into powers of x", `x̄ = ${num(r.poly.m)}, σ = ${num(r.poly.s)}`) : ""}
      </tbody></table></details>`;
  }

  // ---------- charts ----------
  function drawCharts() {
    const r = K.res, d = K.data;
    if (!r || !d) return;
    const box = $("#rgchart"), rbox = $("#rgresid");
    if (!box) return;
    const W = Math.max(320, box.clientWidth), H = 260, pad = { l: 56, r: 14, t: 10, b: 26 };
    const y = d.y, isMulti = r.model === "multiple";
    const xs = isMulti ? [...r.fitted, ...(r.oos?.pred || [])] : d.X.map((row) => row[0]);
    const all = y.map((v, i) => [xs[i], v, i >= r.nTrain]);
    const xr = ext(all.map((p) => p[0])), yr = ext(all.map((p) => p[1]));
    const X = (v) => pad.l + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yr[0]) / (yr[1] - yr[0] || 1)) * (H - pad.t - pad.b);
    let g = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` + axes(X, Y, xr, yr, W, H, pad, isMulti ? "predicted" : r.xNames[0], r.equation.y);
    if (isMulti) g += `<line x1="${X(Math.max(xr[0], yr[0]))}" y1="${Y(Math.max(xr[0], yr[0]))}" x2="${X(Math.min(xr[1], yr[1]))}" y2="${Y(Math.min(xr[1], yr[1]))}" stroke="var(--dim)" stroke-dasharray="4 3"/>`;
    else {
      const f = (x) => r.equation.terms.reduce((s, t, i) => s + t.coef * x ** i, 0);
      const pts = Array.from({ length: 80 }, (_, i) => { const x = xr[0] + ((xr[1] - xr[0]) * i) / 79; return `${X(x).toFixed(1)},${Y(f(x)).toFixed(1)}`; });
      g += `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
    }
    for (const [px, py, test] of all) g += `<circle cx="${X(px).toFixed(1)}" cy="${Y(py).toFixed(1)}" r="${all.length > 400 ? 2 : 3}" fill="${test ? "var(--warn)" : "var(--fg)"}" opacity="${test ? 0.9 : 0.55}"/>`;
    g += `</svg>${r.oos ? `<div class="rg-legend"><span><i style="background:var(--fg)"></i>fitted on</span><span><i style="background:var(--warn)"></i>held out</span></div>` : ""}`;
    box.innerHTML = g;

    const res = r.resid, RH = 120, rr = ext(res.concat([0]));
    const RY = (v) => 8 + (1 - (v - rr[0]) / (rr[1] - rr[0] || 1)) * (RH - 16);
    const bw = (W - pad.l - pad.r) / res.length;
    let s = `<svg viewBox="0 0 ${W} ${RH}" width="${W}" height="${RH}"><line x1="${pad.l}" x2="${W - pad.r}" y1="${RY(0)}" y2="${RY(0)}" stroke="var(--line-2)"/>`;
    res.forEach((e, i) => { const x = pad.l + i * bw, y0 = RY(0), y1 = RY(e); s += `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${Math.abs(y1 - y0).toFixed(1)}" fill="${e >= 0 ? "var(--up)" : "var(--down)"}" opacity=".75"/>`; });
    s += `<text x="${pad.l - 6}" y="${RY(rr[1]) + 4}" text-anchor="end" font-size="10" fill="var(--dim)">${num(rr[1], 3)}</text><text x="${pad.l - 6}" y="${RY(rr[0])}" text-anchor="end" font-size="10" fill="var(--dim)">${num(rr[0], 3)}</text></svg>`;
    rbox.innerHTML = s;
  }
  function ext(v) { const f = v.filter(Number.isFinite); let lo = Math.min(...f), hi = Math.max(...f); const p = (hi - lo) * 0.06 || 1; return [lo - p, hi + p]; }
  function axes(X, Y, xr, yr, W, H, pad, xl, yl) {
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const yv = yr[0] + ((yr[1] - yr[0]) * k) / 4, xv = xr[0] + ((xr[1] - xr[0]) * k) / 4;
      g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(yv)}" y2="${Y(yv)}" stroke="var(--line)"/><text x="${pad.l - 6}" y="${Y(yv) + 3}" text-anchor="end" font-size="10" fill="var(--dim)">${num(yv, 3)}</text>`;
      g += `<text x="${X(xv)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--dim)">${num(xv, 3)}</text>`;
    }
    return g + `<text x="${W - pad.r}" y="${H - 18}" text-anchor="end" font-size="10" fill="var(--dimmer)">${esc(xl)} →</text><text x="${pad.l + 4}" y="${pad.t + 10}" font-size="10" fill="var(--dimmer)">↑ ${esc(yl)}</text>`;
  }

  // ---------- right pane: predict, out-of-sample, export ----------
  function renderDetail() {
    const el = $("#rgdetail"), r = K.res;
    if (!el) return;
    if (!r) { el.innerHTML = `<div class="rg-d"><div class="dhead"><span class="code">REG</span><span class="nm">REGRESSION</span></div>
      <p class="dim">Fit a model to predict new values here, check it on held-out data, and export the results.</p>
      <p class="rg-note">Tip: regress changes or returns, not price levels. Two series that both trend up will show a high R² even when they're unrelated.</p></div>`; return; }
    const inputs = (r.poly ? [r.xNames[0]] : r.model === "linear" ? [r.xNames[0]] : r.xNames).map((n, i) => `<label class="rg-pin"><span>${esc(n)}</span><input type="number" step="any" data-pi="${i}" value="${esc(K.pred?.xs?.[i] ?? "")}"></label>`).join("");
    const p = K.pred?.out;
    el.innerHTML = `<div class="rg-d">
      <div class="dhead"><span class="code">REG</span><span class="nm">PREDICT</span></div>
      <form id="rgpredict">${inputs}<button type="submit" class="open">PREDICT ${esc(r.equation.y).toUpperCase()} <span>›</span></button></form>
      ${p ? (p.ok ? `<div class="rg-pred"><b class="num">${num(p.yhat)}</b><span>95% range ${num(p.lo)} to ${num(p.hi)}</span></div>` : `<p class="rg-err">${esc(p.error)}</p>`) : ""}
      ${r.oos ? `<div class="isec">HELD-OUT TEST</div><dl class="kv"><dt>R²</dt><dd>${r.oos.r2 == null ? "—" : r.oos.r2.toFixed(3)} <span class="dim">vs ${r.r2.toFixed(3)} fitted</span></dd><dt>RMSE</dt><dd>${num(r.oos.rmse)}</dd><dt>POINTS</dt><dd>${r.oos.n}, the last ${Math.round((r.oos.n / (r.n + r.oos.n)) * 100)}% of the data</dd></dl>` : ""}
      <div class="isec">DATA</div>
      <dl class="kv"><dt>RANGE</dt><dd>${K.data?.periods?.length ? `${esc(K.data.periods[0])} to ${esc(K.data.periods[K.data.periods.length - 1])}` : `${r.n + (r.oos?.n || 0)} rows`}</dd>
        <dt>Y</dt><dd>${esc(r.equation.y)}</dd><dt>X</dt><dd>${r.xNames.map(esc).join(" · ")}</dd></dl>
      <div class="rg-exp"><button type="button" class="rg-btn" data-act="csv">EXPORT CSV</button><button type="button" class="rg-btn" data-act="copy">COPY FOR EXCEL</button><span class="dim" id="rgexp"></span></div>
    </div>`;
  }

  function table(sep) {
    const r = K.res, d = K.data;
    const head = [d.periods ? "Period" : "Row", r.equation.y, ...r.xNames, "Fitted", "Residual"];
    const fittedAll = [...r.fitted, ...(r.oos?.pred || [])];
    const rows = d.y.map((v, i) => [d.periods ? d.periods[i] : i + 1, v, ...d.X[i], fittedAll[i], i < r.nTrain ? r.resid[i] : v - fittedAll[i]]);
    const q = (c) => (sep === "," && /[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c);
    return [head, ...rows].map((row) => row.map(q).join(sep)).join("\n");
  }

  // ---------- data + fit ----------
  async function loadSeries() {
    const keys = R.series.map((s) => s.key.trim()).filter(Boolean);
    if (keys.length < 2) throw new Error("Enter a Y series and at least one X series.");
    const got = await Promise.all(R.series.map((s) => call("graphs:series", s.key.trim())));
    got.forEach((g, i) => { if (g?.error || !g?.points?.length) throw new Error(`${R.series[i].key}: ${g?.error || "no data"}`); });
    const used = new Set();
    const list = R.series.map((s, i) => {
      const t = TRANSFORMS.find(([v]) => v === s.transform)[1];
      // short label: the quick-pick name ("10-year Treasury yield"), else a short title, else the ID
      const key = s.key.trim(), id = key.replace(/^(fred|yahoo):/i, "").toUpperCase();
      // FRED quick-picks name the series itself ("10-year Treasury yield"); market picks can name a
      // transform of it ("S&P 500 vs 200-day average"), so tickers use Yahoo's own short name instead
      const pick = (K.picks?.indicators || []).find((p) => /^fred:/i.test(p.src) && p.src.toUpperCase() === "FRED:" + id && !/vs 200-day|annualized|3-mo avg/i.test(p.name));
      const pickName = got[i].key?.startsWith("fred:") ? pick?.name : (K.picks?.watch || []).find((p) => p.src.toUpperCase() === "YAHOO:" + id)?.name;
      const title = (got[i].title || "").replace(/\s*\(.*?\)\s*$/, "");
      let name = `${pickName || (title && title.length <= 28 ? title : id)}${s.transform === "level" ? "" : `, ${t}`}${+s.lag ? ` (lag ${+s.lag})` : ""}`;
      while (used.has(name)) name += "′";
      used.add(name);
      return { name, points: got[i].points, transform: s.transform, lag: +s.lag || 0 };
    });
    const since = +R.range ? Date.now() - +R.range * 365.25 * 864e5 : null;
    const a = await call("regress:align", list, R.freq, since);
    if (!a.ok) throw new Error(a.error);
    if (a.periods.length < 5) throw new Error("These series share fewer than 5 dates at this frequency. Try a lower frequency or a longer range.");
    const names = list.map((l) => l.name);
    return { periods: a.periods, y: a.cols[names[0]], X: a.periods.map((_, i) => names.slice(1).map((n) => a.cols[n][i])), yName: names[0], xNames: names.slice(1), levels: R.series.some((s) => s.transform === "level" || s.transform === "log") };
  }
  function pasteData() {
    const t = K.table;
    if (!t?.ok) throw new Error(t?.error || "Paste or type your data first.");
    const xs = R.xCols.filter((c) => t.names.includes(c) && c !== R.yCol);
    if (!t.names.includes(R.yCol) || !xs.length) throw new Error("Choose a Y column and at least one X column.");
    const ok = (i) => [R.yCol, ...xs].every((c) => t.cols[c][i] != null);
    const idx = t.cols[R.yCol].map((_, i) => i).filter(ok);
    return { y: idx.map((i) => t.cols[R.yCol][i]), X: idx.map((i) => xs.map((c) => t.cols[c][i])), yName: R.yCol, xNames: xs, levels: false };
  }

  async function fit() {
    if (K.busy) return;
    const seq = ++K.seq;
    K.busy = true; K.err = null; K.pred = null; render();
    try {
      const d = R.mode === "series" ? await loadSeries() : pasteData();
      if (R.model === "multiple" && d.xNames.length < 2) throw new Error("Multiple regression needs at least two X variables. Add one, or choose Linear.");
      const r = await call("regress:fit", { y: d.y, X: d.X, yName: d.yName, xNames: d.xNames, model: R.model, degree: +R.degree, holdout: +R.holdout / 100, levels: d.levels });
      if (seq !== K.seq) return;
      if (!r.ok) throw new Error(r.error);
      if (R.model !== "multiple" && d.xNames.length > 1) r.warnings.unshift(`${R.model === "poly" ? "Polynomial" : "Linear"} uses only the first X (${d.xNames[0]}). Choose Multiple to use them all.`);
      K.data = d; K.res = r;
    } catch (e) { if (seq === K.seq) { K.err = String(e.message || e); K.res = null; } }
    if (seq === K.seq) { K.busy = false; render(); }
  }

  let pt = null;
  async function parsePaste() {
    const t = await call("regress:parse", R.paste);
    K.table = t;
    if (t.ok) {
      // default: the last column is y, the first is x (the usual spreadsheet layout)
      if (!t.names.includes(R.yCol)) R.yCol = t.names[t.names.length - 1];
      R.xCols = R.xCols.filter((c) => t.names.includes(c) && c !== R.yCol);
      if (!R.xCols.length) R.xCols = t.names.filter((c) => c !== R.yCol).slice(0, 1);
      save();
    }
    const focused = document.activeElement?.id === "rgpaste", pos = focused ? document.activeElement.selectionStart : null;
    render();
    if (focused) { const ta = $("#rgpaste"); ta.focus(); ta.setSelectionRange(pos, pos); }
  }

  // ---------- events ----------
  const root = () => $("#regress");
  document.addEventListener("click", async (e) => {
    if (!K.active) return;
    const inPage = root().contains(e.target), inDetail = $("#rgdetail").contains(e.target);
    if (!inPage && !inDetail) return;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.mode) { R.mode = b.dataset.mode; save(); if (R.mode === "paste" && R.paste && !K.table) parsePaste(); else render(); return; }
    if (b.dataset.model) { R.model = b.dataset.model; save(); render(); return; }
    const act = b.dataset.act;
    if (act === "addx") { if (R.series.length < 7) R.series.push({ key: "", transform: "pct", lag: 0 }); save(); render(); root().querySelector(`.rg-v[data-i="${R.series.length - 1}"] input`)?.focus(); }
    else if (act === "rm") { R.series.splice(+b.dataset.i, 1); save(); render(); }
    else if (act === "fit") fit();
    else if (act === "csv" || act === "copy") {
      const out = $("#rgexp");
      if (act === "copy") { await call("graphs:copy", table("\t")); out.textContent = "Copied. Paste into Excel or Sheets."; }
      else { const f = await call("graphs:csv", `regression-${new Date().toISOString().slice(0, 10)}`, table(",")); out.textContent = typeof f === "string" ? `Saved to Downloads: ${f.split("/").pop()}` : f?.path ? `Saved to Downloads: ${f.path.split("/").pop()}` : "Saved to Downloads."; }
    }
  });
  document.addEventListener("input", (e) => {
    if (!K.active || !root().contains(e.target)) return;
    const row = e.target.closest(".rg-v");
    if (row && e.target.dataset.f) { const s = R.series[+row.dataset.i]; s[e.target.dataset.f] = e.target.dataset.f === "lag" ? Math.max(0, Math.min(36, +e.target.value || 0)) : e.target.value; save(); return; }
    if (e.target.id === "rgpaste") { R.paste = e.target.value; save(); clearTimeout(pt); pt = setTimeout(parsePaste, 350); }
  });
  document.addEventListener("change", (e) => {
    if (!K.active || !root().contains(e.target)) return;
    const g = e.target.dataset.g;
    if (g) { R[g] = e.target.value; if (g === "yCol") R.xCols = R.xCols.filter((c) => c !== R.yCol); save(); render(); return; }
    if (e.target.dataset.x) { const c = e.target.dataset.x; R.xCols = e.target.checked ? [...new Set([...R.xCols, c])] : R.xCols.filter((x) => x !== c); save(); return; }
    const row = e.target.closest(".rg-v");
    if (row && e.target.dataset.f === "transform") { R.series[+row.dataset.i].transform = e.target.value; save(); }
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "rgpredict") return;
    e.preventDefault();
    const xs = [...e.target.querySelectorAll("[data-pi]")].map((i) => i.value);
    K.pred = { xs, out: await call("regress:predict", xs) };
    renderDetail();
  });
  document.addEventListener("toggle", (e) => { if (e.target.classList?.contains("rg-f")) try { localStorage.setItem("wire.regress.formulas", e.target.open ? "1" : "0"); } catch {} }, true);
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => K.active && drawCharts(), 150); });

  (window.WirePages ||= {}).regress = {
    async show() {
      K.active = true;
      if (!K.picks) call("graphs:picks").then((p) => { K.picks = p; if (K.active && R.mode === "series") render(); }).catch(() => {});
      if (R.mode === "paste" && R.paste && !K.table) await parsePaste();
      render();
    },
    hide() { K.active = false; },
    key(e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { if (e.key === "Enter" && e.target.tagName === "INPUT" && root().contains(e.target)) { e.preventDefault(); fit(); } return; }
      if (e.key === "Enter") { e.preventDefault(); fit(); }
    },
    restore() { renderDetail(); },
    detail: () => $("#rgdetail")
  };
})();
