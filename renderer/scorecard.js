/* Tickerkite scorecards: one 0–100 outlook per asset class, built from ~50 economic and market indicators. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const FACTORS = {
    growth: "Growth", inflation: "Inflation", labor: "Labor", yields: "Yields", fed: "Fed policy", credit: "Credit",
    conditions: "Financial conditions", dollar: "Dollar", stress: "Market stress", consumer: "Consumer & housing", global: "Global",
    trend_stocks: "Stocks' own trend", trend_bonds: "Bonds' own trend", trend_commodities: "Commodities' own trend",
    trend_realestate: "Real estate's own trend", trend_crypto: "Crypto's own trend", trend_alts: "Gold & silver's own trend"
  };
  const ASSET_NOTE = {
    stocks: "US stocks (S&P 500)", bonds: "US Treasuries and high-grade bonds", commodities: "Broad commodities: energy, metals, agriculture",
    realestate: "REITs and housing-linked assets", crypto: "Bitcoin and large crypto", alts: "Gold and precious metals"
  };

  const K = { data: null, asset: "stocks", sel: null, active: false, series: new Map(), seq: 0, rec: null };
  const REC = "@recession"; // K.sel value when the recession model is shown in the right pane
  const REG = "@regime"; // K.sel value when the regime path is shown in the right pane
  const REG_COL = { goldilocks: "#3ecf8e", reflation: "#f2b34a", stagflation: "#f2706b", slowdown: "#5ec2f2" };
  const REG_NAME = { goldilocks: "Goldilocks", reflation: "Reflation", stagflation: "Stagflation", slowdown: "Slowdown" };
  K.win = "w1"; K.view = "outlook"; // view: "outlook" (asset scores) or "board" (decile board, renderer/board.js)
  try { K.asset = localStorage.getItem("wire.score.asset") || "stocks"; K.win = localStorage.getItem("wire.score.win") || "w1"; K.view = localStorage.getItem("wire.score.view") === "board" ? "board" : "outlook"; } catch {}
  const BOARD = () => K.view === "board" && window.WireBoard;
  let hooks = {};

  // ---------- formatting ----------
  const grade = (s) => (s >= 58 ? "g-up" : s <= 42 ? "g-dn" : "g-mid");
  const def = (id) => K.data.defs.find((d) => d.id === id);
  function fmt(v, d, signed = false) {
    if (v == null || !Number.isFinite(v)) return "—";
    const n = Math.abs(v).toFixed(d.dec ?? 1);
    const sign = signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "";
    const unit = d.unit === "%" ? (signed ? "" : "%") : d.unit === "k" ? "k" : d.unit === "M" ? "M" : "";
    return sign + n + unit;
  }
  const fmtDate = (t, d) => {
    const x = new Date(t);
    if (d.freq === "q") return `Q${Math.floor(x.getUTCMonth() / 3) + 1} ${String(x.getUTCFullYear()).slice(2)}`;
    if (d.freq === "m") return x.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
    return x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  const pts = (p) => (p == null ? "—" : (p > 0 ? "+" : p < 0 ? "−" : "") + Math.abs(p).toFixed(1));
  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const span = (r) => (r.years >= 9.5 ? "10 years" : `${r.years.toFixed(r.years < 2 ? 1 : 0)} years`);
  const assetName = (a) => (K.data?.assets.find(([k]) => k === a) || [a, a])[1];

  // ---------- tabs ----------
  function renderTabs() {
    const sc = K.data?.scores || {};
    const btns = (K.data?.assets || [["stocks", "Stocks"], ["bonds", "Bonds"], ["commodities", "Commodities"], ["realestate", "Real Estate"], ["crypto", "Crypto"], ["alts", "Alts"]])
      .map(([k, l]) => `<button type="button" data-a="${k}" aria-pressed="${k === K.asset}">${esc(l)}${sc[k] ? `<em>${sc[k].score}</em>` : ""}</button>`).join("");
    const tog = [["outlook", "Outlook"], ["board", "Board"]].map(([k, l]) => `<button type="button" data-view="${k}" aria-pressed="${k === K.view}" title="${k === "board" ? "Every indicator ranked against its own history (B)" : "0–100 outlook per asset class (B)"}">${l}</button>`).join("");
    $("#atabs").innerHTML = (BOARD() ? "" : btns) + `<span class="vtog">${tog}</span>`;
  }

  function renderInfo() {
    const d = K.data, btn = $("#sref");
    btn.disabled = !!d?.refreshing;
    btn.textContent = d?.refreshing ? "Updating…" : "⟳ Update data";
    if (BOARD()) { const st = window.WireBoard.status(); $("#sinfo").textContent = `Decile board · ${d?.defs?.length || 53} indicators ranked D1–D10 against their own history${st ? " · " + st : ""}`; return; }
    if (!d?.fetchedAt) { $("#sinfo").textContent = "Scores 0–100: higher = more constructive over the next 6–12 months"; return; }
    const ago = Math.round((Date.now() - d.fetchedAt) / 60000);
    const when = ago < 1 ? "just now" : ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago / 60)}h ago` : `${Math.round(ago / 1440)}d ago`;
    $("#sinfo").textContent = `6–12 month outlook · ${d.defs.length} indicators · data updated ${when}${d.failed ? ` · ${d.failed} series failed, using last copy` : ""}`;
  }

  // ---------- main list ----------
  function spark(hist) {
    if (!hist?.length) return "";
    const W = 300, H = 46, n = hist.length;
    const x = (i) => 4 + (i / (n - 1)) * (W - 8), y = (v) => 4 + (1 - v / 100) * (H - 14);
    const line = hist.map((h, i) => `${x(i).toFixed(1)},${y(h.scores[K.asset]).toFixed(1)}`).join(" ");
    const last = hist[n - 1].scores[K.asset];
    return `<svg class="sc-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(assetName(K.asset))} score over the last 12 months">
      <line x1="0" x2="${W}" y1="${y(50)}" y2="${y(50)}" stroke="#323843" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
      <polyline points="${line}" fill="none" stroke="var(--orange)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(n - 1)}" cy="${y(last)}" r="2.6" fill="var(--orange)"/>
    </svg><div class="sc-sub" style="display:flex;justify-content:space-between"><span>12 months ago</span><span>50 = neutral</span><span>now</span></div>`;
  }

  function relBar(d) {
    const rows = d.assets.map(([k, l]) => [k, l, d.scores[k].rel]).sort((a, b) => b[2] - a[2]);
    return `<div class="relbar" title="Each score minus the average of all six. Allocation is a relative decision: even when everything scores low, this shows the least and most exposed.">
      <span class="rt">VS THE AVERAGE OF ALL SIX</span>
      ${rows.map(([k, l, r], i) => `<button type="button" data-a="${k}" class="${k === K.asset ? "on" : ""}"><span class="rk">${i + 1}</span>${esc(l)} <b class="${r > 1 ? "up" : r < -1 ? "dn" : "dim"}">${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r)}</b></button>`).join("")}
    </div>`;
  }

  function modeLine(m) {
    if (!m) return "";
    const pct = Math.round(m.alpha * 100);
    const text = pct >= 67 ? "Inflation is the main worry: bonds aren't counted as a hedge for stocks, and hot data hurts both."
      : pct <= 33 ? "Normal mode: bonds are counted as a hedge when stocks are under stress."
      : "Between modes: bonds count partly as a hedge for stocks.";
    return `<div class="mode" title="How far the weights have shifted toward the inflationary set (View › Edit Scorecard Weights…)"><span>INFLATION MODE <b>${pct}%</b></span><span class="mt">${text}</span></div>`;
  }

  function regimeBox(r) {
    if (!r) return "";
    const cell = (k, t) => `<div class="q${r.key === k ? " on" : ""}">${t}</div>`;
    return `<div class="regime${K.sel === REG ? " sel" : ""}" data-id="${REG}" role="button" tabindex="0" title="Direction of growth and inflation over the last 6 months. Click for the path over the last two years.">
      <div class="rt">REGIME · GROWTH × INFLATION <span class="rgo">PATH ›</span></div>
      ${cell("goldilocks", "Goldilocks<br>growth ↑ infl ↓")}${cell("reflation", "Reflation<br>growth ↑ infl ↑")}
      ${cell("slowdown", "Slowdown<br>growth ↓ infl ↓")}${cell("stagflation", "Stagflation<br>growth ↓ infl ↑")}
      <div class="rx">${esc(r.text)}</div>
      ${modeLine(K.data.mode)}
    </div>`;
  }

  function changed(A) {
    const c = A.changes?.[K.win];
    if (!c) return "";
    const tog = [["w1", "1W"], ["m1", "1M"]].map(([k, l]) => `<button type="button" data-win="${k}" aria-pressed="${k === K.win}">${l}</button>`).join("");
    const rows = c.rows.slice(0, 6).map((r) => {
      const x = def(r.id) || { name: r.id };
      return `<button type="button" data-id="${r.id}"><span class="nm">${esc(x.name)}</span><span class="vt">${fmt(r.from, x)} → ${fmt(r.to, x)}</span><span class="${r.pts > 0 ? "up" : "dn"}">${pts(r.pts)}</span></button>`;
    }).join("") || `<div class="dim">No indicator moved the score by more than 0.1 points</div>`;
    return `<div class="wchg"><h3>WHAT CHANGED <span class="tog">${tog}</span><span class="tot">score <b class="${c.score > 0 ? "up" : c.score < 0 ? "dn" : "dim"}">${c.score > 0 ? "▲" : c.score < 0 ? "▼" : "▬"} ${Math.abs(c.score)}</b> vs ${K.win === "w1" ? "a week" : "a month"} ago</span></h3>${rows}</div>`;
  }

  function render() {
    renderTabs(); renderInfo();
    const d = K.data, el = $("#score");
    if (BOARD() && d?.defs) { window.WireBoard.render(); return; }
    if (!d || !Object.keys(d.scores || {}).length) {
      el.innerHTML = d?.refreshing || !d ? window.WireUI.skeleton("rows", { n: 12, label: "Downloading economic data: about 50 series from the St. Louis Fed (FRED) and Yahoo Finance. This takes 5–10 seconds the first time." })
        : window.WireUI.error(d.error || "No economic data yet. Check your connection, then try again.", "data-sref");
      renderDetail();
      return;
    }
    const A = d.scores[K.asset];
    const name = assetName(K.asset);
    const chg = (v, l) => `<span>${l} <b class="${v > 0 ? "up" : v < 0 ? "dn" : "dim"}">${v > 0 ? "▲" : v < 0 ? "▼" : "▬"} ${Math.abs(v)}</b></span>`;
    const drv = (list) => list.length ? list.map(([id, p]) => `<button type="button" data-id="${id}"><span class="nm">${esc(def(id)?.name || id)}</span><span class="${p > 0 ? "up" : "dn"}">${pts(p)}</span></button>`).join("") : `<div class="dim">Nothing significant</div>`;

    let h = `${relBar(d)}<div class="sc-top">
        <div class="dial ${grade(A.score)}" title="${esc(name)} outlook score"><b>${A.score}</b><span>/ 100</span></div>
        <div class="sc-sum">
          <div class="sc-lbl ${grade(A.score)}">${esc(name)} · ${esc(A.label)}</div>
          <div class="sc-sub">${esc(ASSET_NOTE[K.asset] || "")} · 50 = neutral, higher = more constructive over 6–12 months</div>
          <div class="sc-chg">${chg(A.m1, "vs 1 month ago")}${chg(A.m3, "vs 3 months ago")}</div>
          ${spark(d.history)}
        </div>
        <div class="sc-side">${regimeBox(d.regime)}${recBox()}</div>
      </div>
      <div class="drv"><div><h3>PUSHING THE SCORE UP</h3>${drv(A.up)}</div><div><h3>PULLING THE SCORE DOWN</h3>${drv(A.down)}</div></div>
      ${changed(A)}
      <div class="cols"><span>INDICATOR</span><span>LATEST</span><span>6 MO AGO</span><span>TREND</span><span>VS HISTORY</span><span>EFFECT</span><span>AS OF</span></div>`;

    for (const [sk, sl] of d.sections) {
      const defs = d.defs.filter((x) => x.section === sk);
      const ss = A.sections[sk];
      const bar = ss == null ? "" : `<span class="sm"><i class="${grade(ss)}" style="background:currentColor;left:${Math.min(ss, 50)}%;width:${Math.abs(ss - 50)}%"></i></span><span class="ss ${grade(ss)}">${ss}</span>`;
      h += `<div class="ssec"><span class="sn">${esc(sl.toUpperCase())}</span>${bar}<span class="sx">${ss == null ? `not used for ${esc(name.toLowerCase())}` : `${defs.length} indicators`}</span></div>`;
      for (const x of defs) {
        const r = d.ind[x.id];
        const c = A.contrib[x.id];
        const tr = !r || r.chg == null ? `<span class="tr flat">—</span>` : r.T > 0.6 ? `<span class="tr up">▲</span>` : r.T < 0.4 ? `<span class="tr dn">▼</span>` : `<span class="tr flat">▬</span>`;
        const eff = c == null ? `<span class="eff none">—</span>` : `<span class="eff ${c > 0.05 ? "pos" : c < -0.05 ? "neg" : "none"}">${pts(c)}</span>`;
        h += `<button type="button" class="srow${r?.stale ? " stale" : ""}" data-id="${x.id}" aria-selected="${x.id === K.sel}" title="${esc(x.name)}">
          <span class="n">${esc(x.name)}${r?.fresh ? `<i class="new" title="New data in the last 7 days">NEW</i>` : ""}</span>
          <span class="v">${r ? fmt(r.v, x) : "—"}</span>
          <span class="p">${r ? fmt(r.prior, x) : "—"}</span>
          ${tr}
          <span>${r ? `<span class="rng" title="${ord(Math.round(r.L * 100))} percentile of the last ${span(r)}"><b></b><i style="left:${(r.L * 100).toFixed(1)}%"></i></span>` : ""}</span>
          ${eff}
          <span class="d">${r ? fmtDate(r.t, x) + (r.stale ? " !" : "") : "no data"}</span>
        </button>`;
      }
    }
    el.innerHTML = h;
    if (!K.sel || (!d.ind[K.sel] && K.sel !== REC)) K.sel = A.down[0]?.[0] || A.up[0]?.[0] || d.defs[0].id;
    el.querySelector(`.srow[data-id="${K.sel}"]`)?.setAttribute("aria-selected", "true");
    renderDetail();
  }

  // ---------- detail ----------
  function renderDetail(byUser = false) {
    if (BOARD()) { window.WireBoard.renderDetail(byUser); return; }
    const el = $("#sdetail");
    if (window.WireInstrument?.isOpen()) { if (!byUser) return; window.WireInstrument.close(); }
    const d = K.data;
    if (!d || !K.sel || !d.scores[K.asset]) { el.innerHTML = !d || d.refreshing ? window.WireUI.skeleton("detail") : window.WireUI.empty("Nothing selected", "Pick an indicator on the left to see its history and what it means for each asset."); return; }
    if (K.sel === REC) { el.innerHTML = recDetail(); drawRecCharts(); return; }
    if (K.sel === REG) { el.innerHTML = regimeDetail(); regimeStep(K.rg.pts.length - 1); if (K.rgFresh) regimePlay(); K.rgFresh = false; return; }
    clearInterval(K.rgTimer);
    const x = def(K.sel), r = d.ind[K.sel];
    if (!x) { el.innerHTML = ""; return; }
    const [kind, sym] = x.src.split(":");
    const srcLabel = kind === "fred" ? `FRED · ${sym}` : kind === "yahoo" ? `YAHOO · ${sym}` : "DERIVED · " + sym;
    const secName = (d.sections.find(([k]) => k === x.section) || [, ""])[1];
    const maxAbs = Math.max(2, ...d.assets.map(([a]) => Math.abs(d.scores[a].contrib[x.id] || 0)));
    const effRows = d.assets.map(([a, l]) => {
      const c = d.scores[a].contrib[x.id];
      const w = c == null ? 0 : (Math.abs(c) / maxAbs) * 50;
      const bar = c == null ? "" : `<i style="${c >= 0 ? `left:50%` : `left:${50 - w}%`};width:${w}%;background:${c >= 0 ? "var(--up)" : "var(--down)"}"></i>`;
      return `<span class="${a === K.asset ? "on" : ""}">${esc(l)}</span><span class="bar"><b></b>${bar}</span><span class="eff ${c == null ? "none" : c > 0.05 ? "pos" : c < -0.05 ? "neg" : "none"}" style="text-align:right">${c == null ? "not used" : pts(c)}</span>`;
    }).join("");
    const c = d.scores[K.asset].contrib[x.id];
    const signNote = x.sign < 0 ? ` (inverted: a higher reading means less ${FACTORS[x.factor]?.toLowerCase() || x.factor})` : "";

    el.innerHTML = `<div class="ind">
      <div class="dhead"><span class="code">${esc(secName.toUpperCase())}</span><span class="nm">${esc(srcLabel)}</span><span class="dt">${r ? "as of " + fmtDate(r.t, x) : ""}</span></div>
      <h1 style="margin:4px 0 0">${esc(x.name)}</h1>
      ${r ? `<div class="big"><b>${fmt(r.v, x)}</b><span class="${r.chg > 0 ? "up" : r.chg < 0 ? "dn" : "dim"}">${fmt(r.chg, x, true)}${x.unit === "%" ? " pts" : ""}</span><span class="dim">vs 6 months ago</span></div>` : `<div class="dim">No data yet.</div>`}
      ${r?.stale ? `<div class="stale">Stale: the latest reading is from ${fmtDate(r.t, x)}. ${r.dropped ? "It's too old to count toward the scores." : "It still counts toward the scores."}</div>` : ""}
      <p style="margin:0">${esc(x.desc || "")}</p>
      <div class="ichart" id="ichart"><div class="iload">Loading history…</div></div>
      ${r ? `<dl class="kv">
        <dt>Level</dt><dd>${ord(Math.round(r.L * 100))} percentile of the last ${span(r)}${r.years < 9.5 ? " (all the free history available)" : ""}</dd>
        <dt>Trend</dt><dd>${r.chg == null ? "—" : `6-month change ${fmt(r.chg, x, true)}, ${ord(Math.round(r.T * 100))} percentile of past 6-month changes`}</dd>
        <dt>Feeds</dt><dd>${esc(FACTORS[x.factor] || x.factor)}${esc(signNote)}</dd>
        <dt>Effect</dt><dd>${c == null ? `Not used for ${esc(assetName(K.asset).toLowerCase())}` : `${pts(c)} points on the ${esc(assetName(K.asset).toLowerCase())} score`}</dd>
      </dl>` : ""}
      <div class="isec">EFFECT ON EACH OUTLOOK (POINTS)</div>
      <div class="effs">${effRows}</div>
      ${kind === "yahoo" ? `<button type="button" class="open" data-act="inst" data-sym="${esc(sym)}">OPEN PRICE CHART <span>›</span></button>` : ""}
      <p class="ifoot">Effect = how many points this indicator adds to or takes from the score. Each factor's weight is split across its indicators; edit weights in View › Edit Scorecard Weights…</p>
    </div>`;
    loadChart(x);
  }

  async function loadChart(x) {
    const seq = ++K.seq;
    let s = K.series.get(x.id);
    if (!s || Date.now() - s.at > 30 * 60e3) {
      const r = await api?.getScoreSeries(x.id);
      if (seq !== K.seq) return;
      if (!r?.ok) { const c = $("#ichart"); if (c) c.innerHTML = `<div class="iload">${esc(r?.error || "No history available.")}</div>`; return; }
      s = { ...r, at: Date.now() };
      K.series.set(x.id, s);
    }
    drawChart(x, s);
  }

  function drawChart(x, s) {
    const box = $("#ichart");
    if (!box || !s.points.length) return;
    const W = Math.max(280, box.clientWidth), H = 200, padL = 4, padR = 54, padT = 8, padB = 20;
    const P = s.points, t0 = P[0][0], t1 = P[P.length - 1][0];
    let lo = Math.min(...P.map((p) => p[1])), hi = Math.max(...P.map((p) => p[1]));
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const X = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const sorted = P.map((p) => p[1]).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
    let g = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(x.name)} history">`;
    for (const [a, b] of s.recessions) {
      if (b < t0 || a > t1) continue;
      g += `<rect x="${X(Math.max(a, t0))}" y="${padT}" width="${Math.max(2, X(Math.min(b, t1)) - X(Math.max(a, t0)))}" height="${H - padT - padB}" fill="rgba(255,255,255,.07)"><title>Recession</title></rect>`;
    }
    for (let k = 0; k <= 3; k++) {
      const v = lo + ((hi - lo) * k) / 3, y = Y(v);
      g += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#22262d"/><text x="${W - padR + 6}" y="${y + 3}" fill="#8c93a1" font-size="9.5">${fmt(v, x)}</text>`;
    }
    if (lo < 0 && hi > 0) g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(0)}" y2="${Y(0)}" stroke="#323843"/>`;
    g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(med)}" y2="${Y(med)}" stroke="#5d6472" stroke-dasharray="3 3"/><text x="${padL + 2}" y="${Y(med) - 4}" fill="#8c93a1" font-size="9" paint-order="stroke" stroke="#000" stroke-width="3">median ${fmt(med, x)}</text>`;
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
    const every = Math.ceil((y1 - y0 + 1) / 6);
    for (let yr = y0 + 1; yr <= y1; yr++) {
      if ((yr - y0) % every) continue;
      const t = Date.UTC(yr, 0, 1);
      g += `<text x="${X(t)}" y="${H - 5}" fill="#8c93a1" font-size="9.5" text-anchor="middle">${yr}</text>`;
    }
    g += `<polyline points="${P.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--orange)" stroke-width="1.5"/>`;
    const [lt, lv] = P[P.length - 1];
    g += `<circle cx="${X(lt)}" cy="${Y(lv)}" r="3" fill="var(--orange)"/>`;
    g += `<line id="ch-x" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="#4a5160" visibility="hidden"/><rect x="0" y="0" width="${W}" height="${H}" fill="transparent" id="ch-hit"/></svg><div class="tip" id="ch-tip" hidden></div>`;
    box.innerHTML = g;
    const hit = box.querySelector("#ch-hit"), cross = box.querySelector("#ch-x"), tip = box.querySelector("#ch-tip");
    hit.addEventListener("mousemove", (e) => {
      const rect = hit.getBoundingClientRect(), mx = ((e.clientX - rect.left) / rect.width) * W;
      const t = t0 + ((mx - padL) / (W - padL - padR)) * (t1 - t0);
      let best = P[0]; for (const p of P) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      cross.setAttribute("x1", X(best[0])); cross.setAttribute("x2", X(best[0])); cross.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.innerHTML = `<div class="tt">${new Date(best[0]).toLocaleDateString("en-US", { month: "short", day: x.freq === "m" || x.freq === "q" ? undefined : "numeric", year: "numeric", timeZone: "UTC" })}</div><b>${fmt(best[1], x)}</b>`;
      const left = (X(best[0]) / W) * rect.width;
      tip.style.left = Math.min(rect.width - 120, left + 10) + "px"; tip.style.top = "10px";
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }

  // ---------- regime path: where growth and inflation have been heading, month by month ----------
  K.rg = { pts: [] };
  const rgMonth = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  function regimeDetail() {
    const d = K.data, path = d.regimePath || [], r = d.regime;
    if (path.length < 3 || !r) { K.rg = { pts: [] }; return window.WireUI.empty("No regime history yet", "It appears once the economic data has loaded."); }
    const W = 400, H = 400, pl = 30, pr = 10, pt = 10, pb = 30, pw = W - pl - pr, ph = H - pt - pb;
    const dev = Math.max(0.25, ...path.flatMap((p) => [Math.abs(p.growth), Math.abs(p.inflation)])) * 1.15;
    const X = (v) => pl + ((v + dev) / (2 * dev)) * pw, Y = (v) => pt + (1 - (v + dev) / (2 * dev)) * ph;
    const pts = path.map((p) => ({ x: X(p.inflation), y: Y(p.growth), key: p.key, label: rgMonth(p.t), g: p.growth, inf: p.inflation }));
    K.rg = { pts };
    const n = pts.length;
    const tint = (k, x, y) => `<rect x="${x}" y="${y}" width="${pw / 2}" height="${ph / 2}" fill="${REG_COL[k]}" opacity=".08"/>`;
    const corner = (k, x, y, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="rg-q" fill="${REG_COL[k]}">${REG_NAME[k].toUpperCase()}</text>`;
    let g = `<svg viewBox="0 0 ${W} ${H}" class="rg-svg" role="img" aria-label="Path of growth and inflation over the last two years">
      ${tint("goldilocks", pl, pt)}${tint("reflation", pl + pw / 2, pt)}${tint("slowdown", pl, pt + ph / 2)}${tint("stagflation", pl + pw / 2, pt + ph / 2)}
      <rect x="${pl}" y="${pt}" width="${pw}" height="${ph}" fill="none" stroke="var(--line-2)"/>
      <line x1="${X(0)}" x2="${X(0)}" y1="${pt}" y2="${pt + ph}" class="rg-axis"/><line x1="${pl}" x2="${pl + pw}" y1="${Y(0)}" y2="${Y(0)}" class="rg-axis"/>
      ${corner("goldilocks", pl + 8, pt + 16, "start")}${corner("reflation", pl + pw - 8, pt + 16, "end")}${corner("slowdown", pl + 8, pt + ph - 8, "start")}${corner("stagflation", pl + pw - 8, pt + ph - 8, "end")}
      <text x="${pl + pw / 2}" y="${H - 8}" text-anchor="middle" class="rg-ax">← INFLATION COOLING · INFLATION HEATING UP →</text>
      <text transform="translate(12 ${pt + ph / 2}) rotate(-90)" text-anchor="middle" class="rg-ax">← GROWTH SLOWING · GROWTH PICKING UP →</text>`;
    // a smooth curve through the months (Catmull-Rom), one piece per month so the tail can fade and the replay can reveal it
    for (let i = 0; i < n - 1; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], e = pts[Math.min(n - 1, i + 2)], k = (i + 1) / (n - 1);
      g += `<path class="rg-seg" data-s="${i}" d="M${b.x.toFixed(1)} ${b.y.toFixed(1)}C${(b.x + (c.x - a.x) / 6).toFixed(1)} ${(b.y + (c.y - a.y) / 6).toFixed(1)} ${(c.x - (e.x - b.x) / 6).toFixed(1)} ${(c.y - (e.y - b.y) / 6).toFixed(1)} ${c.x.toFixed(1)} ${c.y.toFixed(1)}"
        fill="none" stroke="${REG_COL[c.key]}" stroke-width="${(1.2 + 2.4 * k).toFixed(2)}" stroke-linecap="round" opacity="${(0.22 + 0.78 * k).toFixed(2)}"/>`;
    }
    pts.forEach((p, i) => { g += `<circle class="rg-dot" data-rg="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(1.8 + 1.4 * (i / (n - 1))).toFixed(1)}" fill="${REG_COL[p.key]}" opacity="${(0.35 + 0.65 * (i / (n - 1))).toFixed(2)}"><title>${p.label}: ${REG_NAME[p.key]}</title></circle>`; });
    g += `<g class="rg-head" id="rghead"><circle class="rg-ring" r="11" fill="none"/><circle r="6" stroke="#fff" stroke-width="1.6"/></g></svg>`;
    const rib = pts.map((p, i) => `<button type="button" data-rg="${i}" style="background:${REG_COL[p.key]}" title="${p.label}: ${REG_NAME[p.key]}"></button>`).join("");
    let run = 1; while (run < n && pts[n - 1 - run].key === r.key) run++;
    const counts = Object.keys(REG_NAME).map((k) => [k, pts.filter((p) => p.key === k).length]).filter(([, c]) => c).sort((a, b) => b[1] - a[1]);
    return `<div class="rg">
      <div class="dhead"><span class="code">REGIME</span><span class="nm">GROWTH × INFLATION · LAST ${n - 1} MONTHS</span></div>
      <h1 style="margin:4px 0 0;color:${REG_COL[r.key]}">${esc(r.name)}</h1>
      <p style="margin:0">${esc(r.text)} ${run >= n ? `It has been the regime for the whole ${n - 1} months shown.` : `It has been the regime for ${run === 1 ? "less than a month" : `the last ${run - 1} month${run > 2 ? "s" : ""}`}.`}</p>
      <div class="rg-bar"><button type="button" data-act="rgplay">▶ REPLAY</button><span id="rgwhen"></span></div>
      <div class="rg-chart">${g}</div>
      <div class="rg-rib">${rib}</div>
      <div class="rg-yrs"><span>${pts[0].label}</span><span>click a month</span><span>today</span></div>
      <div class="isec">MONTHS IN EACH REGIME</div>
      <div class="rg-counts">${counts.map(([k, c]) => `<span><i style="background:${REG_COL[k]}"></i>${REG_NAME[k]} <b>${c}</b></span>`).join("")}</div>
      <p class="ifoot">Each dot is a month-end: across is which way the inflation indicators were heading over the previous 6 months, up is the same for the growth indicators. The center is "no change". Economies usually circle this map over a cycle. Past months use today's revised data.</p>
    </div>`;
  }
  /** Show the path up to month i: the head sits on that month and later months are hidden. */
  function regimeStep(i) {
    const pts = K.rg.pts, box = $("#sdetail");
    if (!pts.length || !box.querySelector(".rg-svg")) return;
    i = Math.max(0, Math.min(pts.length - 1, i));
    box.querySelectorAll(".rg-seg").forEach((e) => { e.style.visibility = +e.dataset.s < i ? "visible" : "hidden"; });
    box.querySelectorAll(".rg-dot").forEach((e) => { e.style.visibility = +e.dataset.rg <= i ? "visible" : "hidden"; });
    box.querySelectorAll(".rg-rib button").forEach((e) => e.classList.toggle("on", +e.dataset.rg === i));
    const p = pts[i], head = box.querySelector("#rghead");
    head.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`; head.style.setProperty("--c", REG_COL[p.key]);
    box.querySelector("#rgwhen").innerHTML = `${p.label} · <b style="color:${REG_COL[p.key]}">${REG_NAME[p.key]}</b> <span class="dim">growth ${p.g >= 0 ? "picking up" : "slowing"}, inflation ${p.inf >= 0 ? "heating up" : "cooling"}</span>`;
  }
  function regimePlay() {
    clearInterval(K.rgTimer);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return regimeStep(K.rg.pts.length - 1);
    let i = 0; regimeStep(0);
    K.rgTimer = setInterval(() => { if (K.sel !== REG || !K.active) return clearInterval(K.rgTimer); regimeStep(++i); if (i >= K.rg.pts.length - 1) clearInterval(K.rgTimer); }, 130);
  }

  // ---------- recession model (src/recession.js) ----------
  const pct = (p) => (p == null ? "—" : p < 0.01 ? "<1%" : Math.round(p * 100) + "%");
  const sgn = (v, d = 2) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const leadTxt = (t) => `caught ${t.caught} of ${t.total} recessions${t.avgLead != null ? `, ${Math.round(t.avgLead)} mo avg lead` : ""}, ${t.falseAlarms.length} false alarm${t.falseAlarms.length === 1 ? "" : "s"}`;

  function recBox() {
    const r = K.rec, m = r?.model;
    if (!m) return `<div class="recbox" id="recbox"><div class="rt">RECESSION ODDS · 12 MONTHS</div><div class="rx">${r?.refreshing || !r ? "Downloading Treasury history…" : esc(r.error || "No data yet")}</div></div>`;
    const L = m.latest, on = L.p >= m.threshold, t = m.track, fa = t.falseAlarms[t.falseAlarms.length - 1];
    const when = L.source === "daily" ? `${new Date(L.asOf).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" })} live` : `${L.monthLabel} monthly`;
    const since = t.recessions[0]?.start.slice(-4);
    return `<button type="button" class="recbox${on ? " warn" : ""}${K.sel === REC ? " sel" : ""}" id="recbox" data-id="${REC}" title="Yield-curve probit: chance of a US recession 12 months from now. Click for detail.">
      <div class="rt">RECESSION ODDS, NEXT 12 MONTHS</div>
      <div class="rv"><b>${pct(L.p)}</b><span class="${on ? "dn" : "up"}">${on ? "ABOVE" : "BELOW"} ${Math.round(m.threshold * 100)}% WARNING LINE</span></div>
      <div class="rx">Yield curve 10Y-3M ${L.spread > 0 ? "+" : ""}${sgn(L.spread)} pp, ${when}</div>
      <div class="rx">Called ${t.caught} of ${t.total} since ${since}${fa ? ` · false alarm ${fa.start.slice(-4)}${fa.end.slice(-4) !== fa.start.slice(-4) ? "–" + fa.end.slice(-2) : ""}` : ""}</div>
    </button>`;
  }

  function recDetail() {
    const r = K.rec, m = r?.model;
    if (!m) return `<div class="ind"><div class="dhead"><span class="code">RECESSION MODEL</span></div><div class="iload">${esc(r?.error || "Downloading Treasury history from FRED…")}</div></div>`;
    const L = m.latest, t = m.track, thr = Math.round(m.threshold * 100);
    const d0 = (x) => new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const src = L.source === "daily"
      ? `Spread ${sgn(L.spread)} pts: daily T10Y3M averaged over the ${L.days} trading days to ${d0(L.asOf)} (fresher than the monthly GS10 − TB3MS, ${sgn(L.monthly.spread)} pts in ${new Date(Date.UTC(Math.floor(L.monthly.month / 12), L.monthly.month % 12, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })} → ${pct(L.monthly.p)}).`
      : `Spread ${sgn(L.spread)} pts: monthly GS10 − TB3MS for ${L.monthLabel}.`;
    const rows = t.recessions.map((x) => `<tr><td>${x.start} – ${x.end}</td><td class="${x.caught ? "up" : "dn"}">${x.caught ? "caught" : "missed"}</td><td>${x.caught ? `${x.signal} · ${x.lead} mo` : "—"}</td></tr>`).join("")
      + t.falseAlarms.map((w) => `<tr><td>${w.start} – ${w.end}</td><td class="dn">false alarm</td><td>peak ${pct(w.peak)}</td></tr>`).join("")
      + t.pending.map((w) => `<tr><td>${w.start} – ${w.end}</td><td class="dim">pending</td><td>peak ${pct(w.peak)}</td></tr>`).join("");
    const sahm = m.sahm ? `<dt>Sahm rule</dt><dd>${m.sahm.v.toFixed(2)} pts (${new Date(m.sahm.asOf).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}) · ${m.sahm.triggered ? `<span class="dn">triggered</span>` : "not triggered"} (0.50 = trigger; real-time unemployment rule)${m.sahm.lastTrigger ? `, last triggered ${new Date(m.sahm.lastTrigger).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}` : ""}</dd>` : "";
    return `<div class="ind rec">
      <div class="dhead"><span class="code">RECESSION MODEL</span><span class="nm">FRED · GS10 − TB3MS → USREC</span><span class="dt">${r.refreshing ? "updating…" : `<button type="button" class="iclose" data-act="recref">⟳ UPDATE</button>`}</span></div>
      <h1 style="margin:4px 0 0">Recession odds, 12 months ahead</h1>
      <div class="big"><b>${pct(L.p)}</b><span class="${L.p >= m.threshold ? "dn" : "up"}">${L.p >= m.threshold ? "above" : "below"} the ${thr}% threshold</span><span class="dim">chance of recession in ${esc(L.target)}</span></div>
      <p style="margin:0" class="dim">${esc(src)}</p>
      <div class="isec">PROBABILITY (READING MONTH) · RECESSIONS SHADED · ${thr}% THRESHOLD DASHED</div>
      <div class="ichart" id="recp"></div>
      <div class="isec">10-YEAR MINUS 3-MONTH SPREAD (PTS)</div>
      <div class="ichart" id="recs"></div>
      <dl class="kv">
        <dt>Track</dt><dd>${esc(leadTxt(t))}${t.recessions.filter((x) => x.caught).length ? ` (leads ${t.recessions.filter((x) => x.caught).map((x) => x.lead).join(", ")} mo)` : ""}</dd>
        <dt>Base rate</dt><dd>${pct(m.baseRate)} of months had a recession 12 months later</dd>
        <dt>Fitted on</dt><dd>${m.fit.from} – ${m.fit.to} (${m.fit.n} months; outcomes known to ${m.fit.outcomesTo}) · P = Φ(${sgn(m.fit.a, 3)} ${m.fit.b < 0 ? "−" : "+"} ${Math.abs(m.fit.b).toFixed(3)} × spread)</dd>
        ${sahm}
      </dl>
      <div class="isec">TRACK RECORD · WARNING = ≥${thr}% WITHIN ${m.window} MONTHS BEFORE THE START</div>
      <table class="rtrack"><tr><th>PERIOD</th><th>RESULT</th><th>FIRST WARNING · LEAD</th></tr>${rows}</table>
      <p class="ifoot">What it tells you: an inverted curve (3-month yields above 10-year) has preceded every US recession since the 1960s, usually by 6–18 months, and this turns the spread into odds. What it can't: the timing is loose, it has false alarms (most recently the long 2022–24 inversion), and it ignores everything except the curve. The track record is in-sample (fitted on the same history), so it flatters the model. Refits on all known outcomes each daily refresh; USREC dates are set by the NBER months after the fact.</p>
    </div>`;
  }

  function recChart(id, pts, { lo, hi, fmtV, line }) {
    const box = $("#" + id), m = K.rec?.model;
    if (!box || !pts?.length) return;
    const W = Math.max(280, box.clientWidth), H = 160, padL = 4, padR = 44, padT = 8, padB = 20;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const X = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    let g = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
    for (const [a, b] of m.recessions) if (b >= t0) g += `<rect x="${X(Math.max(a, t0))}" y="${padT}" width="${Math.max(2, X(Math.min(b, t1)) - X(Math.max(a, t0)))}" height="${H - padT - padB}" fill="rgba(255,255,255,.08)"/>`;
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="#22262d"/><text x="${W - padR + 6}" y="${Y(v) + 3}" fill="#8c93a1" font-size="9.5">${fmtV(v)}</text>`; }
    if (line != null) g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(line)}" y2="${Y(line)}" stroke="#8c93a1" stroke-dasharray="4 3"/>`;
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
    for (let yr = Math.ceil(y0 / 10) * 10; yr <= y1; yr += 10) g += `<text x="${X(Date.UTC(yr, 0, 1))}" y="${H - 5}" fill="#8c93a1" font-size="9.5" text-anchor="middle">${yr}</text>`;
    g += `<polyline points="${pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--orange)" stroke-width="1.3"/>`;
    const [lt, lv] = pts[pts.length - 1];
    box.innerHTML = g + `<circle cx="${X(lt)}" cy="${Y(lv)}" r="3" fill="var(--orange)"/></svg>`;
  }
  function drawRecCharts() {
    const m = K.rec?.model;
    if (!m) return;
    recChart("recp", m.probs, { lo: 0, hi: 1, fmtV: (v) => Math.round(v * 100) + "%", line: m.threshold });
    const vs = m.spread.map((p) => p[1]);
    recChart("recs", m.spread, { lo: Math.floor(Math.min(...vs)), hi: Math.ceil(Math.max(...vs)), fmtV: (v) => sgn(v, 1), line: 0 });
  }

  // ---------- interaction ----------
  function select(id, byUser = true) {
    if (!id) return;
    K.sel = id; K.rgFresh = id === REG;
    document.querySelector("#score .regime")?.classList.toggle("sel", id === REG);
    document.querySelectorAll("#score .srow").forEach((r) => r.setAttribute("aria-selected", String(r.dataset.id === id)));
    document.querySelector(`#score .srow[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
    renderDetail(byUser);
  }
  function setAsset(a) {
    if (!a || a === K.asset) return;
    K.asset = a;
    try { localStorage.setItem("wire.score.asset", a); } catch {}
    render();
    $("#score").scrollTop = 0;
  }
  function move(dir) {
    const ids = [...document.querySelectorAll("#score .srow")].map((r) => r.dataset.id);
    const i = ids.indexOf(K.sel);
    select(ids[Math.max(0, Math.min(ids.length - 1, (i < 0 ? 0 : i + dir)))]);
  }

  function setView(v) {
    if (v === K.view) return;
    K.view = v;
    try { localStorage.setItem("wire.score.view", v); } catch {}
    window.WireBoard?.[v === "board" ? "show" : "hide"]();
    render();
    $("#score").scrollTop = 0;
  }
  $("#atabs").addEventListener("click", (e) => {
    const v = e.target.closest("button[data-view]"); if (v) { setView(v.dataset.view); return; }
    const b = e.target.closest("button[data-a]"); if (b) setAsset(b.dataset.a);
  });
  $("#score").addEventListener("click", (e) => {
    if (BOARD()) return; // board.js handles its own clicks
    const a = e.target.closest(".relbar [data-a]"); if (a) { setAsset(a.dataset.a); return; }
    const w = e.target.closest("[data-win]");
    if (w) { K.win = w.dataset.win; try { localStorage.setItem("wire.score.win", K.win); } catch {} render(); return; }
    const b = e.target.closest("[data-id]"); if (b) select(b.dataset.id);
  });
  $("#sdetail").addEventListener("click", (e) => { if (e.target.closest("[data-act=recref]")) api?.page.invoke("recession:refresh"); });
  $("#sdetail").addEventListener("click", (e) => {
    if (K.sel !== REG || window.WireInstrument?.isOpen()) return;
    if (e.target.closest("[data-act=rgplay]")) return regimePlay();
    const m = e.target.closest("[data-rg]"); if (m) { clearInterval(K.rgTimer); regimeStep(+m.dataset.rg); }
  });
  $("#score").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".regime")) { e.preventDefault(); select(REG); } });
  $("#sref").addEventListener("click", () => { api?.refreshScores(); if (BOARD()) window.WireBoard.refresh(); });
  $("#score").addEventListener("click", (e) => { if (e.target.closest("[data-sref]")) $("#sref").click(); }); // "Try again" on a failed load
  $("#sdetail").addEventListener("click", (e) => {
    if (window.WireInstrument?.isOpen()) return; // the price chart handles its own clicks
    const b = e.target.closest("[data-act=inst]"); if (b) hooks.openInstrument?.(b.dataset.sym);
  });
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (K.active && BOARD()) window.WireBoard.resize(); else if (K.active && K.sel === REC && !window.WireInstrument?.isOpen()) drawRecCharts(); else if (K.active && K.sel && K.series.has(K.sel) && !window.WireInstrument?.isOpen()) drawChart(def(K.sel), K.series.get(K.sel)); }, 150); });

  function apply(d) {
    if (!d) return;
    const fresh = d.fetchedAt !== K.data?.fetchedAt;
    K.data = d;
    window.WireChrome?.pulled("score", d.fetchedAt);
    if (fresh) K.series.clear();
    if (K.active) render(); else renderTabs();
  }

  window.WireScore = {
    init(h) {
      hooks = h || {};
      window.WireBoard?.init({ esc, fmt, fmtDate, ord, defs: () => K.data?.defs || [], sections: () => K.data?.sections || [] });
      if (!api) return;
      api.onScores(apply);
      api.getScores().then(apply);
      const recApply = (r) => { K.rec = r; if (!K.active) return; const b = $("#recbox"); if (b) b.outerHTML = recBox(); if (K.sel === REC) renderDetail(); };
      api.page?.on("recession:update", recApply);
      api.page?.invoke("recession:get").then(recApply).catch(() => {});
      setInterval(() => { if (K.active) renderInfo(); }, 30000);
    },
    show() { K.active = true; if (BOARD()) window.WireBoard.show(); render(); },
    hide() { K.active = false; window.WireBoard?.hide(); },
    info() { if (K.active) renderInfo(); },
    /** Restore the indicator view after the price chart closes. */
    restore() { renderDetail(true); },
    key(e) {
      if ((e.key === "b" || e.key === "B") && !e.metaKey) { setView(K.view === "board" ? "outlook" : "board"); return; }
      if (BOARD()) { if (e.key === "Enter" || e.key === "o") { const b = document.querySelector("#sdetail [data-act=inst], #sdetail [data-act=fred]"); b?.click(); } else window.WireBoard.key(e); return; }
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
      else if (/^[1-6]$/.test(e.key) && !e.metaKey) setAsset(K.data?.assets?.[+e.key - 1]?.[0] || ["stocks", "bonds", "commodities", "realestate", "crypto", "alts"][+e.key - 1]);
      else if (e.key === "Enter" || e.key === "o") { const x = K.sel && def(K.sel); if (x?.src.startsWith("yahoo:")) hooks.openInstrument?.(x.src.slice(6)); }
    }
  };
})();
