/* Tickerkite Factor page (FAC): the probability of a case ("S&P 500 falls 10%+ within 6 months",
   "recession within 12 months") from macro factors, by logistic regression. Registers with app.js
   through window.WirePages. The model runs in src/factor.js. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const call = (ch, ...a) => api.page.invoke(ch, ...a);

  const FTF = [["level", "Level"], ["chg3", "3-mo change"], ["chg6", "6-mo change"], ["chg12", "12-mo change"], ["pct3", "3-mo % change"], ["pct6", "6-mo % change"], ["pct12", "12-mo % change"]];
  const CONDS = [["fall", "falls by at least"], ["rise", "rises by at least"], ["above", "is at or above"], ["below", "is at or below"]];
  const WHEN = [["within", "at any point within"], ["end", "at the end of"]];
  const HORIZONS = [1, 3, 6, 12, 18, 24];
  const SINCE = [["", "All history"], ["1990", "Since 1990"], ["2000", "Since 2000"], ["2010", "Since 2010"]];
  const INFLATION_KEYS = /^fred:(CPIAUCSL|CPILFESL|PCEPI|PCEPILFE|PPIFIS)$/i;

  let R = { preset: "recession", target: null, c: null, factors: null, since: "", holdout: 25 };
  try { R = { ...R, ...JSON.parse(localStorage.getItem("wire.factor") || "{}") }; } catch {}
  const K = { active: false, presets: null, res: null, err: null, busy: false, seq: 0, whatIf: null };
  const save = () => { try { localStorage.setItem("wire.factor", JSON.stringify(R)); } catch {} };

  // ---------- formatting ----------
  const pct = (p, d = 0) => (p == null || !Number.isFinite(p) ? "—" : `${(p * 100).toFixed(d)}%`);
  function num(v, sig = 3) {
    if (v == null || !Number.isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a >= 1e4) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (a >= 100) return v.toFixed(1);
    return a === 0 ? "0" : Number(v.toPrecision(sig)).toString();
  }
  const pval = (p) => (p == null ? "—" : p < 0.001 ? "<0.001" : p.toFixed(3));
  const opts = (sel, list) => list.map(([v, l]) => `<option value="${v}"${String(v) === String(sel) ? " selected" : ""}>${l}</option>`).join("");
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  function applyPreset(id) {
    const p = (K.presets || []).find((x) => x.id === id);
    if (!p) return;
    R.preset = id;
    R.target = { key: p.target.key, label: p.target.name, measure: p.target.measure };
    R.c = { ...p.c };
    R.factors = p.factors.map((f) => ({ key: f.key, label: f.name, tf: f.tf, lag: f.lag || 0 }));
    R.ridge = p.ridge || 0;
    K.res = null; K.err = null; K.whatIf = null;
    save();
  }

  // ---------- page ----------
  function searchBox(kind, i, s) {
    return `<div class="fa-pick"><input data-sk="${kind}" data-i="${i}" value="${esc(s?.label || s?.key || "")}" placeholder="Search: S&P 500, unemployment, yield curve, oil…" spellcheck="false" autocomplete="off" title="${esc(s?.key || "")}"><div class="fa-sugg" role="listbox" hidden></div></div>`;
  }
  function caseSentence() {
    const c = R.c, t = R.target;
    if (!c || !t) return "";
    if (c.text) return c.text;
    const amt = c.cond === "rise" || c.cond === "fall" ? `${c.x}${c.unit === "pct" ? "%" : " points"}` : `${c.x}`;
    return `${t.label || t.key}${t.measure === "yoy" ? " (vs a year ago)" : ""} ${CONDS.find(([v]) => v === c.cond)[1]} ${amt}, ${WHEN.find(([v]) => v === c.when)[1]} ${c.h} month${c.h === 1 ? "" : "s"}${c.onlyNew && (c.cond === "above" || c.cond === "below") ? " (new cases only)" : ""}`;
  }

  function render() {
    if (!K.active) return;
    if (!R.target && K.presets) applyPreset(R.preset || "recession");
    const c = R.c || {}, move = c.cond === "rise" || c.cond === "fall";
    $("#factor").innerHTML = `<div class="fa">
      <div class="fa-sec">CASE · WHAT MIGHT HAPPEN</div>
      <div class="fa-row"><label>PRESET <select data-g="preset"><option value="">Custom</option>${(K.presets || []).map((p) => `<option value="${p.id}"${p.id === R.preset ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label></div>
      <div class="fa-case">
        <div class="fa-full">${searchBox("target", 0, R.target)}</div>
        <select data-c="measure" title="Inflation-type series are usually judged by their change vs a year ago">${opts(R.target?.measure || "level", [["level", "as is"], ["yoy", "vs a year ago (%)"]])}</select>
        <select data-c="cond">${opts(c.cond, CONDS)}</select>
        <input data-c="x" type="number" step="any" value="${c.x ?? ""}">
        ${move ? `<select data-c="unit">${opts(c.unit, [["pct", "%"], ["pts", "points"]])}</select>` : "<span></span>"}
        <select data-c="when">${opts(c.when, WHEN)}</select>
        <select data-c="h">${opts(c.h, HORIZONS.map((h) => [h, `${h} month${h === 1 ? "" : "s"}`]))}</select>
        ${c.cond === "above" || c.cond === "below" ? `<label class="fa-chk" title="Skip months that are already in the case (e.g. already in a recession), so the model learns to see it coming"><input type="checkbox" data-c="onlyNew"${c.onlyNew ? " checked" : ""}> new cases only</label>` : ""}
      </div>
      <p class="fa-sent">“${esc(caseSentence())}”</p>
      <div class="fa-sec">FACTORS · WHAT MIGHT PREDICT IT</div>
      <div class="fa-facs">
        ${(R.factors || []).map((f, i) => `<div class="fa-f" data-i="${i}">${searchBox("factor", i, f)}
          <select data-ff="tf">${opts(f.tf, FTF)}</select>
          <input data-ff="lag" type="number" min="0" max="24" value="${f.lag || 0}" title="Months earlier: lag 3 uses the factor's value three months before">
          <button type="button" class="fa-x" data-act="rmf" data-i="${i}" title="Remove">×</button></div>`).join("")}
        <div class="fa-row"><button type="button" class="fa-btn" data-act="addf">+ ADD FACTOR</button>
          <label>HISTORY <select data-g="since">${opts(R.since, SINCE)}</select></label>
          <label title="Fit on older years, then check accuracy on the most recent quarter of the data it never saw">HOLD OUT <select data-g="holdout">${opts(R.holdout, [[0, "None"], [25, "Last 25%"]])}</select></label>
          <button type="button" class="fa-run" data-act="run"${K.busy ? " disabled" : ""}>${K.busy ? "RUNNING…" : "RUN ↵"}</button></div>
      </div>
      <div id="faout">${results()}</div>
    </div>`;
    drawChart();
    renderDetail();
  }

  function results() {
    if (K.err) return `<p class="fa-err">${esc(K.err)}</p>`;
    if (K.busy && !K.res) return window.WireUI?.skeleton ? window.WireUI.skeleton("rows", { n: 6, label: "Loading data and fitting…" }) : `<p class="dim">Loading data and fitting…</p>`;
    const r = K.res;
    if (!r) return `<p class="fa-empty">Pick a preset or build a case, choose factors, then press <b>RUN</b> (or Enter).</p>`;
    const vs = r.now.p - r.base;
    const tile = (l, v, sub = "", cls = "") => `<div class="fa-tile"><span>${l}</span><b class="${cls}">${v}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
    const maxPush = Math.max(0.3, ...r.pushes.map((p) => Math.abs(p.logOdds)));
    const bucket = (s, k) => `<td class="${s.nowIn === k ? "on" : ""}">${pct(s[k].rate)}<span class="dim"> (${s[k].n})</span></td>`;
    return `<div class="fa-sec">RESULT · AS OF ${esc(r.now.period)}</div>
      <div class="fa-tiles">
        ${tile("PROBABILITY NOW", pct(r.now.p), `90% range ${pct(r.now.lo)}–${pct(r.now.hi)}`, vs > 0.05 ? "hi" : vs < -0.05 ? "lo" : "")}
        ${tile("HISTORICAL BASE RATE", pct(r.base), `happened in ${r.events} of ${r.n} months`)}
        ${tile("AUC", r.score.auc == null ? "—" : r.score.auc.toFixed(2), "0.5 = coin flip · 1 = perfect", r.score.auc >= 0.75 ? "up" : r.score.auc < 0.6 ? "dn" : "")}
        ${tile("SKILL VS BASE RATE", r.score.skill == null ? "—" : `${(r.score.skill * 100).toFixed(0)}%`, "Brier score improvement", r.score.skill > 0.1 ? "up" : r.score.skill <= 0.02 ? "dn" : "")}
        ${r.oos ? tile("HELD-OUT AUC", r.oos.auc == null ? "—" : r.oos.auc.toFixed(2), `since ${r.oos.from}, ${r.oos.events} case months`, r.oos.auc >= 0.7 ? "up" : r.oos.auc != null && r.oos.auc < 0.6 ? "dn" : "") : ""}
      </div>
      <p class="fa-read">${esc(r.case)}: <b>${pct(r.now.p)}</b> now, ${Math.abs(vs) < 0.03 ? "about the same as" : vs > 0 ? `${(Math.abs(vs) * 100).toFixed(0)} points above` : `${(Math.abs(vs) * 100).toFixed(0)} points below`} the ${pct(r.base)} rate at which it has happened historically (${esc(r.from)} to ${esc(r.to)}).</p>
      <div class="fa-sec">WHAT'S DRIVING TODAY'S NUMBER</div>
      <div class="fa-push">${r.pushes.map((p) => { const w = (Math.abs(p.logOdds) / maxPush) * 50; return `<span class="nm">${esc(p.name)}</span><span class="val num">${num(p.value)} <em>(${p.zscore >= 0 ? "+" : ""}${p.zscore.toFixed(1)} SD)</em></span><span class="bar"><b></b><i style="${p.logOdds >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:${p.logOdds >= 0 ? "var(--warn)" : "var(--accent)"}"></i></span><span class="dir ${p.logOdds >= 0 ? "hi" : "lo"}">${Math.abs(p.logOdds) < 0.05 ? "neutral" : p.logOdds > 0 ? "raises odds" : "lowers odds"}</span>`; }).join("")}</div>
      <table class="fa-tab num"><thead><tr><th>FACTOR</th><th>ODDS × PER 1 SD</th><th>p-VALUE</th><th>CASE RATE: LOW THIRD</th><th>MIDDLE</th><th>HIGH THIRD</th></tr></thead><tbody>
        ${r.coefs.slice(1).map((c, i) => { const s = r.splits[i]; return `<tr><td>${esc(c.term)}</td><td class="${c.p < 0.05 ? (c.coef > 0 ? "hi" : "lo") : ""}">${c.oddsRatio.toFixed(2)}×</td><td class="${c.p < 0.05 ? "sig" : ""}">${pval(c.p)}</td>${bucket(s, "low")}${bucket(s, "mid")}${bucket(s, "high")}</tr>`; }).join("")}
      </tbody></table>
      <p class="fa-note">Odds × per 1 SD: how much the odds multiply when that factor is one standard deviation higher, holding the others fixed (above 1 raises them). p-values are widened for overlapping ${r.h}-month windows. Highlighted: the third each factor is in today.</p>
      ${r.warnings.length ? `<ul class="fa-warn">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      <div class="fa-sec">PROBABILITY OVER TIME <span class="dim">(shaded: months the case went on to happen)</span></div>
      <div class="fa-chart" id="fachart"></div>
      <div class="fa-sec">CALIBRATION <span class="dim">(when the model said X%, how often did it happen?)</span></div>
      <table class="fa-tab fa-cal num"><thead><tr><th>MODEL SAID</th><th>MONTHS</th><th>AVERAGE PREDICTED</th><th>ACTUALLY HAPPENED</th></tr></thead><tbody>
        ${r.calibration.filter((b) => b.n).map((b) => `<tr><td>${pct(b.lo)}–${pct(b.hi)}</td><td>${b.n}</td><td>${pct(b.predicted)}</td><td>${pct(b.actual)}</td></tr>`).join("")}
      </tbody></table>
      ${formulas(r)}`;
  }

  function formulas(r) {
    let open = false; try { open = localStorage.getItem("wire.factor.formulas") === "1"; } catch {}
    const row = (n, f, v = "") => `<tr><th>${n}</th><td class="f">${f}</td><td class="v">${v}</td></tr>`;
    const b0 = r.coefs[0].coef;
    return `<details class="fa-f2"${open ? " open" : ""}><summary>FORMULAS · HOW THIS IS CALCULATED</summary><table class="num"><tbody>
      ${row("Label", `y<sub>t</sub> = 1 if, starting from month t, ${esc(r.case.charAt(0).toLowerCase() + r.case.slice(1))}; else 0`, `${r.events} of ${r.n} months = 1`)}
      ${row("Standardize", "z<sub>i</sub> = (x<sub>i</sub> − mean<sub>i</sub>) / sd<sub>i</sub>, so coefficients are per 1 standard deviation", "")}
      ${row("Model", "P(y = 1) = 1 / (1 + e<sup>−(a + Σ b<sub>i</sub>·z<sub>i</sub>)</sup>), logistic regression", `a = ${num(b0)}`)}
      ${row("Fit", `maximum likelihood: choose a, b to maximize Σ [ y·ln p + (1 − y)·ln(1 − p) ]${r.ridge > 0.01 ? ` − ${r.ridge}/2·Σ b<sub>i</sub>² (shrinkage, so the few past cases don't make it overconfident)` : ""} (Newton–Raphson)`, r.ridge > 0.01 ? `shrinkage ${r.ridge}` : "")}
      ${row("Odds ratio", "OR<sub>i</sub> = e<sup>b<sub>i</sub></sup>: the odds multiply by this per +1 SD", r.coefs.slice(1).map((c) => `${esc(c.term.split(" (")[0])} ${c.oddsRatio.toFixed(2)}`).join(" · "))}
      ${row("Std errors", `from the inverse Hessian, × √${r.h} because consecutive ${r.h}-month windows overlap; z = b / SE, two-sided p`, "")}
      ${row("Range now", "p = 1/(1 + e<sup>−(η ± 1.645·SE<sub>η</sub>)</sup>), SE<sub>η</sub> = √(xᵀ Σ x) · √h", `${pct(r.now.lo)}–${pct(r.now.hi)}`)}
      ${row("Push", "each factor's b<sub>i</sub>·z<sub>i</sub> today: its share of the log-odds vs an average month", "")}
      ${row("AUC", "chance a random month when the case happened got a higher probability than a random month when it didn't", r.score.auc == null ? "—" : r.score.auc.toFixed(3))}
      ${row("Brier", "mean of (p − y)²; skill = 1 − Brier / Brier of always guessing the base rate", `${r.score.brier.toFixed(3)} vs ${r.score.brierBase.toFixed(3)}`)}
      ${row("Held-out", `refit on data ending ${r.h} months before the test period (so no window overlaps it), scored on the most recent 25%`, r.oos?.auc == null ? "—" : `AUC ${r.oos.auc.toFixed(3)}`)}
    </tbody></table></details>`;
  }

  // ---------- chart ----------
  function drawChart() {
    const r = K.res, box = $("#fachart");
    if (!r || !box) return;
    const H0 = r.history, W = Math.max(320, box.clientWidth), H = 220, pad = { l: 40, r: 12, t: 10, b: 22 };
    const X = (i) => pad.l + (i / (H0.length - 1 || 1)) * (W - pad.l - pad.r), Y = (p) => pad.t + (1 - p) * (H - pad.t - pad.b);
    let g = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
    H0.forEach((m, i) => { if (m.y === 1) g += `<rect x="${X(i) - 0.5}" y="${pad.t}" width="${Math.max(1, (W - pad.l - pad.r) / H0.length + 0.5)}" height="${H - pad.t - pad.b}" fill="var(--down)" opacity=".16"/>`; });
    for (const p of [0, 0.25, 0.5, 0.75, 1]) g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(p)}" y2="${Y(p)}" stroke="var(--line)"/><text x="${pad.l - 6}" y="${Y(p) + 3}" text-anchor="end" font-size="10" fill="var(--dim)">${p * 100}%</text>`;
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(r.base)}" y2="${Y(r.base)}" stroke="var(--dim)" stroke-dasharray="4 3"/><text x="${W - pad.r}" y="${Y(r.base) - 4}" text-anchor="end" font-size="10" fill="var(--dim)">base rate ${pct(r.base)}</text>`;
    const every = Math.max(1, Math.ceil(H0.length / 7 / 12)) * 12;
    H0.forEach((m, i) => { if (m.p.endsWith("-01") && (+m.p.slice(0, 4)) % (every / 12) === 0) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--dim)">${m.p.slice(0, 4)}</text>`; });
    g += `<polyline points="${H0.map((m, i) => `${X(i).toFixed(1)},${Y(m.prob).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`;
    g += `<circle cx="${X(H0.length - 1)}" cy="${Y(r.now.p)}" r="3.5" fill="var(--accent)"/></svg>`;
    box.innerHTML = g;
  }

  // ---------- right pane: what-if ----------
  function renderDetail() {
    const el = $("#fadetail"), r = K.res;
    if (!el) return;
    if (!r) { el.innerHTML = `<div class="fa-d"><div class="dhead"><span class="code">FAC</span><span class="nm">FACTOR PROBABILITIES</span></div>
      <p class="dim">The chance of a case, from how macro factors have behaved before it in the past. Start with a preset, then swap in your own factors.</p>
      <p class="fa-note">This is history, not a forecast: it says how often the case followed conditions like today's. Overlapping windows, few events and changing relationships all limit it, and the page flags each one.</p></div>`; return; }
    const vals = K.whatIf || r.now.values;
    const z = vals.map((v, j) => (Number(v) - r.mu[j]) / r.sd[j]);
    const p = sigmoid(r.coefs[0].coef + z.reduce((s, v, j) => s + v * r.coefs[j + 1].coef, 0));
    el.innerHTML = `<div class="fa-d">
      <div class="dhead"><span class="code">FAC</span><span class="nm">WHAT IF</span><span class="dt">${esc(r.now.period)}</span></div>
      <p class="fa-note">Change a factor to see how the probability moves. It starts at today's values.</p>
      <form id="fawhat">${r.names.map((n, j) => `<label class="fa-pin"><span>${esc(n)}</span><input type="number" step="any" data-wi="${j}" value="${num(Number(vals[j]), 4)}"></label>`).join("")}
        <div class="fa-row"><button type="submit" class="open">RECALCULATE <span>›</span></button><button type="button" class="fa-btn" data-act="reset">TODAY</button></div></form>
      <div class="fa-big"><b class="num">${pct(p, 1)}</b><span>${K.whatIf ? "with your values" : "today"} · base rate ${pct(r.base)}</span></div>
      <div class="isec">DATA</div>
      <dl class="kv"><dt>MONTHS</dt><dd>${esc(r.from)} to ${esc(r.to)} (${r.n})</dd><dt>CASE</dt><dd>${esc(r.case)}</dd><dt>EVENTS</dt><dd>${r.events} months (${pct(r.base)})</dd></dl>
      <div class="fa-row"><button type="button" class="fa-btn" data-act="csv">EXPORT HISTORY CSV</button><span class="dim" id="faexp"></span></div>
    </div>`;
  }

  // ---------- run ----------
  async function run() {
    if (K.busy) return;
    const seq = ++K.seq;
    K.busy = true; K.err = null; K.whatIf = null; render();
    try {
      if (!R.target?.key) throw new Error("Choose the series for the case.");
      const fs = (R.factors || []).filter((f) => f.key);
      if (!fs.length) throw new Error("Add at least one factor.");
      const got = await Promise.all([R.target, ...fs].map((s) => call("graphs:series", s.key)));
      got.forEach((g, i) => { if (g?.error || !g?.points?.length) throw new Error(`${i ? fs[i - 1].label || fs[i - 1].key : R.target.label || R.target.key}: ${g?.error || "no data"}`); });
      const used = new Set();
      const names = fs.map((f, i) => {
        let n = `${f.label || got[i + 1].title || f.key}${f.tf === "level" ? "" : `, ${FTF.find(([v]) => v === f.tf)[1]}`}${+f.lag ? ` (lag ${f.lag})` : ""}`;
        while (used.has(n)) n += "′"; used.add(n); return n;
      });
      const res = await call("factor:analyze", {
        target: { name: R.target.label || got[0].title || R.target.key, points: got[0].points, measure: R.target.measure || "level" },
        c: { ...R.c, x: Number(R.c.x), h: Number(R.c.h) },
        factors: fs.map((f, i) => ({ name: names[i], points: got[i + 1].points, tf: f.tf, lag: +f.lag || 0 })),
        sinceYear: R.since ? +R.since : null, holdout: +R.holdout / 100, ridge: R.ridge || 0
      });
      if (seq !== K.seq) return;
      if (!res.ok) throw new Error(res.error);
      K.res = res;
    } catch (e) { if (seq === K.seq) { K.err = String(e.message || e); K.res = null; } }
    if (seq === K.seq) { K.busy = false; render(); }
  }

  // ---------- series search dropdown ----------
  const SG = { input: null, list: [], idx: 0, seq: 0, t: null };
  function suggest(input) {
    SG.input = input; clearTimeout(SG.t);
    SG.t = setTimeout(async () => {
      const seq = ++SG.seq, list = await call("factor:search", input.value).catch(() => []);
      if (seq !== SG.seq || SG.input !== input) return;
      SG.list = list || []; SG.idx = 0; drawSugg();
    }, 160);
  }
  function drawSugg() {
    const box = SG.input?.parentElement?.querySelector(".fa-sugg");
    document.querySelectorAll(".fa-sugg").forEach((b) => { if (b !== box) b.hidden = true; });
    if (!box) return;
    box.hidden = !SG.list.length;
    box.innerHTML = SG.list.map((r, i) => `<button type="button" role="option" data-sg="${i}" aria-selected="${i === SG.idx}"><b>${esc(r.name)}</b><em>${esc(r.cat)}</em></button>`).join("");
  }
  function closeSugg() { SG.list = []; SG.seq++; document.querySelectorAll(".fa-sugg").forEach((b) => (b.hidden = true)); }
  function pickSugg(i) {
    const r = SG.list[i], inp = SG.input;
    if (!r || !inp) return;
    if (inp.dataset.sk === "target") {
      R.target = { key: r.key, label: r.name, measure: INFLATION_KEYS.test(r.key) ? "yoy" : "level" };
      delete R.c?.text;
      if (R.c && (R.c.cond === "rise" || R.c.cond === "fall")) R.c.unit = R.target.measure === "yoy" || r.tf === "diff" ? "pts" : "pct";
    } else {
      const f = R.factors[+inp.dataset.i];
      Object.assign(f, { key: r.key, label: r.name, tf: r.tf === "diff" ? "level" : "pct12" });
    }
    R.preset = ""; closeSugg(); save(); render();
  }

  // ---------- events ----------
  const inPage = (el) => $("#factor")?.contains(el) || $("#fadetail")?.contains(el);
  document.addEventListener("click", async (e) => {
    if (!K.active || !inPage(e.target)) return;
    const b = e.target.closest("button"); if (!b) return;
    const act = b.dataset.act;
    if (act === "run") run();
    else if (act === "addf") { if (R.factors.length < 8) R.factors.push({ key: "", label: "", tf: "level", lag: 0 }); R.preset = ""; save(); render(); $(`.fa-f[data-i="${R.factors.length - 1}"] input`)?.focus(); }
    else if (act === "rmf") { R.factors.splice(+b.dataset.i, 1); R.preset = ""; save(); render(); }
    else if (act === "reset") { K.whatIf = null; renderDetail(); }
    else if (act === "csv") {
      const r = K.res; if (!r) return;
      const lines = [["Month", "Probability", "Case happened"].join(","), ...r.history.map((m) => [m.p, m.prob.toFixed(4), m.y == null ? "" : m.y].join(","))].join("\n");
      const f = await call("graphs:csv", `factor-${new Date().toISOString().slice(0, 10)}`, lines);
      $("#faexp").textContent = `Saved to Downloads: ${String(f).split("/").pop()}`;
    }
  });
  document.addEventListener("input", (e) => {
    if (!K.active || !inPage(e.target)) return;
    const t = e.target;
    if (t.dataset.sk) { if (t.dataset.sk === "target") R.target = { key: t.value, label: "", measure: R.target?.measure || "level" }; else Object.assign(R.factors[+t.dataset.i], { key: t.value, label: "" }); R.preset = ""; save(); suggest(t); return; }
    if (t.dataset.c === "x") { R.c.x = t.value; delete R.c.text; R.preset = ""; save(); const s = $(".fa-sent"); if (s) s.textContent = `“${caseSentence()}”`; return; }
    if (t.dataset.ff === "lag") { R.factors[+t.closest(".fa-f").dataset.i].lag = Math.max(0, Math.min(24, +t.value || 0)); R.preset = ""; save(); }
  });
  document.addEventListener("change", (e) => {
    if (!K.active || !inPage(e.target)) return;
    const t = e.target;
    if (t.dataset.g === "preset") { if (t.value) applyPreset(t.value); else R.preset = ""; save(); render(); return; }
    if (t.dataset.g) { R[t.dataset.g] = t.value; save(); return; }
    if (t.dataset.c && t.dataset.c !== "x") {
      delete R.c.text;
      if (t.dataset.c === "onlyNew") R.c.onlyNew = t.checked;
      else if (t.dataset.c === "measure") R.target.measure = t.value;
      else R.c[t.dataset.c] = t.dataset.c === "h" ? +t.value : t.value;
      if (t.dataset.c === "cond" && (t.value === "rise" || t.value === "fall") && !R.c.unit) R.c.unit = "pct";
      R.preset = ""; save(); render(); return;
    }
    if (t.dataset.ff === "tf") { R.factors[+t.closest(".fa-f").dataset.i].tf = t.value; R.preset = ""; save(); }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "fawhat") return;
    e.preventDefault();
    K.whatIf = [...e.target.querySelectorAll("[data-wi]")].map((i) => Number(i.value));
    renderDetail();
  });
  document.addEventListener("toggle", (e) => { if (e.target.classList?.contains("fa-f2")) try { localStorage.setItem("wire.factor.formulas", e.target.open ? "1" : "0"); } catch {} }, true);
  document.addEventListener("focusin", (e) => { if (K.active && e.target.matches?.("[data-sk]")) { e.target.select(); suggest(e.target); } });
  document.addEventListener("focusout", (e) => { if (e.target.matches?.("[data-sk]")) setTimeout(() => { if (!document.activeElement?.matches?.("[data-sk]")) closeSugg(); }, 150); });
  document.addEventListener("mousedown", (e) => { const b = e.target.closest?.(".fa-sugg [data-sg]"); if (b && K.active) { e.preventDefault(); pickSugg(+b.dataset.sg); } });
  document.addEventListener("keydown", (e) => {
    if (!K.active || !e.target.matches?.("[data-sk]") || !SG.list.length || SG.input !== e.target) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); SG.idx = (SG.idx + (e.key === "ArrowDown" ? 1 : SG.list.length - 1)) % SG.list.length; drawSugg(); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); pickSugg(SG.idx); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSugg(); }
  }, true);
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => K.active && drawChart(), 150); });

  (window.WirePages ||= {}).factor = {
    async show() {
      K.active = true;
      if (!K.presets) { try { K.presets = await call("factor:presets"); } catch { K.presets = []; } if (R.preset) applyPreset(R.preset); }
      render();
    },
    hide() { K.active = false; },
    key(e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { if (e.key === "Enter" && e.target.tagName === "INPUT" && !e.target.dataset.wi && $("#factor").contains(e.target)) { e.preventDefault(); run(); } return; }
      if (e.key === "Enter") { e.preventDefault(); run(); }
    },
    restore() { renderDetail(); },
    detail: () => $("#fadetail")
  };
})();
