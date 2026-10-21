/* Tickerkite Yield curve page. Registers with app.js through window.WirePages (see the "pages" section there).
   Today's Treasury curve against a day, week, month, quarter and year ago; every tenor's moves in basis points;
   the 2s10s / 3m10y / 5s30s spreads with their history; and real yields with breakeven inflation on the right.
   src/curve.js fetches and caches the Treasury files. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const Y = { active: false, data: null, show: { "1W": false, "1M": true, "1Y": true }, span: "1Y" };
  try { Object.assign(Y.show, JSON.parse(localStorage.getItem("wire.curve.show") || "{}")); Y.span = localStorage.getItem("wire.curve.span") || "1Y"; } catch {}
  const CMP_STYLE = { "1W": ["#a3aab8", "5 3"], "1M": ["#7cc4f5", "4 3"], "1Y": ["#e88ac0", "2 3"] };

  const bp = (v) => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v)));
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const day = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const short = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

  // charts are drawn at the card's real width so their labels stay at reading size
  const chartW = () => Math.max(300, Math.min(1050, ($("#curve").clientWidth || 800) - 48 - 28 - 30));
  let lastW = 0;
  new ResizeObserver(() => { const w = chartW(); if (Y.active && Y.data && Math.abs(w - lastW) > 30) { lastW = w; render(); } }).observe($("#curve"));

  function curveChart(d) {
    const W = chartW(), H = 270, pl = 8, pr = 46, pt = 14, pb = 28;
    const ts = d.tenors, X = (i) => pl + (i / (ts.length - 1)) * (W - pl - pr);
    const series = [["now", d.now, "var(--accent)", ""]].concat(Object.entries(Y.show).filter(([, on]) => on).map(([k]) => [k, d.cmp[k], ...CMP_STYLE[k]]).filter(([, r]) => r));
    const vals = series.flatMap(([, r]) => ts.map((t) => r.y[t]).filter((v) => v != null));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || 0.2; lo -= pad; hi += pad;
    const Yp = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    let g = `<svg viewBox="0 0 ${W} ${H}" class="yc-svg" role="img" aria-label="Treasury yield curve">`;
    const step = (hi - lo) > 2 ? 0.5 : (hi - lo) > 0.8 ? 0.25 : 0.1;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g += `<line x1="${pl}" x2="${W - pr}" y1="${Yp(v)}" y2="${Yp(v)}" class="yc-grid"/><text x="${W - pr + 6}" y="${Yp(v) + 3}" class="yc-ax">${v.toFixed(2)}%</text>`;
    const every = W < 480 ? 2 : 1; // fewer tenor labels when narrow
    ts.forEach((t, i) => { if (i % every === 0 || i === ts.length - 1) g += `<text x="${X(i)}" y="${H - 8}" class="yc-ax" text-anchor="middle">${t}</text>`; });
    for (const [k, r, color, dash] of series.slice().reverse()) {
      const pts = ts.map((t, i) => (r.y[t] != null ? `${X(i).toFixed(1)},${Yp(r.y[t]).toFixed(1)}` : null)).filter(Boolean).join(" ");
      g += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${k === "now" ? 2.4 : 1.4}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linejoin="round"/>`;
      if (k === "now") ts.forEach((t, i) => { if (r.y[t] != null) g += `<circle cx="${X(i)}" cy="${Yp(r.y[t])}" r="3.2" fill="var(--accent)"><title>${t}: ${r.y[t].toFixed(2)}%</title></circle>`; });
    }
    return g + "</svg>";
  }

  function spreadChart(d) {
    const days = { "6M": 182, "1Y": 365, "2Y": 730, MAX: 99999 }[Y.span] || 365;
    const cut = new Date(Date.parse(d.now.date) - days * 864e5).toISOString().slice(0, 10);
    const h = d.history.filter((r) => r[0] >= cut);
    if (h.length < 5) return "";
    const W = chartW(), H = 190, pl = 8, pr = 46, pt = 10, pb = 22;
    const t0 = Date.parse(h[0][0]), t1 = Date.parse(h[h.length - 1][0]);
    const X = (iso) => pl + ((Date.parse(iso) - t0) / (t1 - t0 || 1)) * (W - pl - pr);
    const vals = h.flatMap((r) => [r[1], r[2]]).filter((v) => v != null);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const pad = (hi - lo) * 0.1 || 10; lo -= pad; hi += pad;
    const Yp = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    let g = `<svg viewBox="0 0 ${W} ${H}" class="yc-svg" role="img" aria-label="Spread history">`;
    if (lo < 0) g += `<rect x="${pl}" y="${Yp(0)}" width="${W - pl - pr}" height="${H - pb - Yp(0)}" fill="rgba(242,112,107,.06)"/>`;
    const step = (hi - lo) > 200 ? 50 : 25;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g += `<line x1="${pl}" x2="${W - pr}" y1="${Yp(v)}" y2="${Yp(v)}" class="${v === 0 ? "yc-zero" : "yc-grid"}"/><text x="${W - pr + 6}" y="${Yp(v) + 3}" class="yc-ax">${v}</text>`;
    const months = [...new Set(h.map((r) => r[0].slice(0, 7)))];
    const every = Math.ceil(months.length / Math.max(3, Math.floor(W / 110)));
    months.forEach((m, i) => { if (i % every === 0 && i) g += `<text x="${X(m + "-01")}" y="${H - 6}" class="yc-ax" text-anchor="middle">${short(m + "-15")}</text>`; });
    const line = (k, color) => `<polyline points="${h.filter((r) => r[k] != null).map((r) => `${X(r[0]).toFixed(1)},${Yp(r[k]).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
    return g + line(2, "#7cc4f5") + line(1, "var(--accent)") + "</svg>";
  }

  function render() {
    if (!Y.active) return;
    const el = $("#curve"), d = Y.data;
    if (!d) { el.innerHTML = `<div class="empty">Loading the Treasury curve…</div>`; return; }
    if (d.empty) { el.innerHTML = `<div class="empty">${d.error ? `Couldn't load Treasury data (${esc(d.error)}).` : "Loading the Treasury curve…"} <button type="button" class="yc-btn" data-ref>Try again</button></div>`; return; }
    const cmpKeys = ["1D", "1W", "1M", "3M", "1Y"];
    const toggles = Object.keys(CMP_STYLE).map((k) => `<button type="button" class="yc-tog" data-cmp="${k}" aria-pressed="${!!Y.show[k]}"><i style="border-color:${CMP_STYLE[k][0]}"></i>${k} ago</button>`).join("");
    const table = `<table class="yc-tab num"><thead><tr><th>Tenor</th><th>Yield</th>${cmpKeys.map((k) => `<th>${k}</th>`).join("")}</tr></thead><tbody>${d.tenors.map((t) => {
      const v = d.now.y[t];
      return `<tr><td>${t}</td><td><b>${v != null ? v.toFixed(2) + "%" : "—"}</b></td>${cmpKeys.map((k) => { const p = d.cmp[k]?.y[t]; const c = v != null && p != null ? (v - p) * 100 : null; return `<td class="${cls(c)}">${bp(c)}</td>`; }).join("")}</tr>`;
    }).join("")}</tbody></table>`;
    const sp = d.spreads;
    const tiles = d.spreadDefs.map(([k, , , desc]) => {
      const v = sp.now[k];
      return `<div class="yc-sp" title="${esc(desc)}"><span>${k}</span><b class="${v < 0 ? "dn" : ""}">${bp(v)}<small>bp</small></b>
        <em>${["1W", "1M", "1Y"].map((c) => { const p = sp[c]?.[k]; const ch = v != null && p != null ? v - p : null; return `<i class="${cls(ch)}">${c} ${bp(ch)}</i>`; }).join("")}</em></div>`;
    }).join("");
    el.innerHTML = `<div class="yc">
      <div class="yc-head"><div><h2>US Treasury yield curve</h2><p class="dim">${day(d.now.date)} close · US Treasury par yields${d.error ? ` · <span class="dn">update failed, showing saved data</span>` : ""}</p></div>
        <div class="yc-togs">${toggles}<button type="button" class="yc-btn" data-ref title="Refresh">↻</button></div></div>
      <div class="yc-card">${curveChart(d)}<div class="yc-leg"><span><i style="border-color:var(--accent)"></i>Today</span>${Object.keys(CMP_STYLE).filter((k) => Y.show[k] && d.cmp[k]).map((k) => `<span><i style="border-color:${CMP_STYLE[k][0]};border-top-style:dashed"></i>${k} ago (${day(d.cmp[k].date)})</span>`).join("")}</div></div>
      <div class="yc-sps">${tiles}</div>
      <div class="yc-card"><div class="yc-ct"><b>Spread history</b><span class="yc-legi"><i style="border-color:var(--accent)"></i>2s10s</span><span class="yc-legi"><i style="border-color:#7cc4f5"></i>3m10y</span>
        <span class="yc-spans">${["6M", "1Y", "2Y", "MAX"].map((s) => `<button type="button" data-span="${s}" aria-pressed="${s === Y.span}">${s}</button>`).join("")}</span></div>${spreadChart(d)}
        <p class="yc-note">Below zero (shaded) the curve is inverted: short rates above long ones, which has come before most US recessions.</p></div>
      <div class="yc-card"><div class="yc-ct"><b>Every tenor</b><span class="dim">changes in basis points (1bp = 0.01%)</span></div>${table}</div>
      <p class="yc-src">Source: US Treasury daily par yield curve and real yield curve rates (public domain). Updated after each trading day.</p></div>`;
  }

  function story(d) {
    const s = d.spreads.now, m = d.spreads["1M"] || {};
    const inv = d.inversion["2s10s"];
    const shape = s["2s10s"] < 0 ? "inverted (2-year above 10-year)" : s["2s10s"] < 25 ? "fairly flat" : "upward sloping";
    const ch = s["2s10s"] != null && m["2s10s"] != null ? s["2s10s"] - m["2s10s"] : null;
    const move = ch == null ? "" : Math.abs(ch) < 5 ? " Its slope is little changed over the month." : ` It has ${ch > 0 ? "steepened" : "flattened"} ${Math.abs(ch)}bp over the month.`;
    const ten = d.now.y["10Y"], tenM = d.cmp["1M"]?.y["10Y"];
    const tenTxt = ten != null && tenM != null ? ` The 10-year is at ${ten.toFixed(2)}%, ${bp((ten - tenM) * 100)}bp on the month.` : "";
    const invTxt = inv ? (inv.inverted ? ` The 2s10s has been inverted since ${day(inv.since)}.` : inv.full ? "" : ` The 2s10s turned positive on ${day(inv.since)}.`) : "";
    return `The curve is ${shape}.${move}${tenTxt}${invTxt}`;
  }

  function renderDetail() {
    if (!Y.active || window.WireInstrument?.isOpen()) return;
    const el = $("#ydetail"), d = Y.data;
    if (!d || d.empty) { el.innerHTML = ""; return; }
    const r = d.real, be = d.breakevens;
    const realRows = d.realTenors.map((t) => {
      const v = r.now?.y[t], m = r["1M"]?.y[t], y1 = r["1Y"]?.y[t];
      return `<tr><td>${t}</td><td><b>${v != null ? v.toFixed(2) + "%" : "—"}</b></td><td class="${cls(v - m)}">${v != null && m != null ? bp((v - m) * 100) : "—"}</td><td class="${cls(v - y1)}">${v != null && y1 != null ? bp((v - y1) * 100) : "—"}</td><td>${be?.be[t] != null ? be.be[t].toFixed(2) + "%" : "—"}</td></tr>`;
    }).join("");
    el.innerHTML = `<h1>What the curve says</h1><p>${esc(story(d))}</p>
      <div class="isec">REAL YIELDS AND INFLATION EXPECTATIONS</div>
      <table class="yc-tab yc-real num"><thead><tr><th>Tenor</th><th>Real yield</th><th>1M</th><th>1Y</th><th>Breakeven</th></tr></thead><tbody>${realRows}</tbody></table>
      <p class="yc-note">Real yields are on inflation-protected Treasuries (TIPS). The breakeven, nominal minus real, is the inflation rate the bond market expects on average over that many years${be ? ` (as of ${day(be.date)})` : ""}.</p>
      <div class="isec">READING THE SPREADS</div>
      <dl class="kv">${d.spreadDefs.map(([k, , , desc]) => `<dt>${k}</dt><dd>${esc(desc.split(": ")[1] || desc)}</dd>`).join("")}</dl>
      <p class="yc-note">For decades of history, open Graphs and add DGS10, T10Y2Y or T10Y3M.</p>`;
  }

  function apply(d) { if (!d) return; Y.data = d; render(); renderDetail(); }
  const save = () => { try { localStorage.setItem("wire.curve.show", JSON.stringify(Y.show)); localStorage.setItem("wire.curve.span", Y.span); } catch {} };
  $("#curve").addEventListener("click", (e) => {
    const c = e.target.closest("[data-cmp]"); if (c) { Y.show[c.dataset.cmp] = !Y.show[c.dataset.cmp]; save(); return render(); }
    const s = e.target.closest("[data-span]"); if (s) { Y.span = s.dataset.span; save(); return render(); }
    if (e.target.closest("[data-ref]")) api.page.invoke("curve:refresh").then(apply);
  });
  if (api?.page) api.page.on("curve:update", apply);

  (window.WirePages ||= {}).curve = {
    show() { Y.active = true; render(); renderDetail(); api.page.invoke("curve:get").then(apply); },
    hide() { Y.active = false; },
    key(e) { if (e.key === "r") api.page.invoke("curve:refresh").then(apply); },
    restore() { renderDetail(); },
    detail: () => $("#ydetail")
  };
})();
