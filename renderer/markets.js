/* Tickerkite Market heatmap page. Registers with app.js through window.WirePages (see the "pages" section there). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // full-color return per period (a ±SCALE move is fully saturated)
  const SCALE = { "1D": 2, "1W": 4, "1M": 8, "3M": 15, YTD: 25, "1Y": 35, "3Y": 70, "5Y": 110, "10Y": 200 };
  const ANNUAL = { "3Y": 3, "5Y": 5, "10Y": 10 };
  const RANGES = ["1Y", "3Y", "5Y", "10Y", "MAX"];
  const M = { snap: null, period: "1D", sel: null, visible: false, range: "1Y", hist: null };
  try { M.period = localStorage.getItem("wire.markets.period") || "1D"; } catch {}

  const pct = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
  function color(v) {
    if (v == null) return "#191c22";
    const k = Math.min(1, Math.abs(v) / SCALE[M.period]) ** 0.8;
    const [r, g, b] = v >= 0 ? [38, 166, 110] : [214, 74, 80];
    const mix = (c, base) => Math.round(base + (c - base) * k);
    return `rgb(${mix(r, 27)},${mix(g, 30)},${mix(b, 37)})`;
  }
  const ret = (sym) => M.snap?.data?.[sym]?.ret?.[M.period] ?? null;

  function tile(sym, name, sub) {
    const v = ret(sym);
    return `<button type="button" class="mtile${M.sel === sym ? " sel" : ""}" data-sym="${esc(sym)}" style="background:${color(v)}" title="${esc(sym)}">
      <span class="mn">${esc(name)}</span><span class="mp">${pct(v)}</span>${sub ? `<span class="ms">${esc(sub)}</span>` : ""}</button>`;
  }

  function render() {
    if (!M.visible) return;
    const s = M.snap;
    const bar = `<div class="mbar"><span class="mperiods">${(s?.periods || Object.keys(SCALE)).map((p, i) =>
      `<button type="button" data-per="${p}" aria-pressed="${p === M.period}" title="Key ${i + 1}">${p}</button>`).join("")}</span>
      <span class="dim">${s?.fetchedAt ? "Updated " + new Date(s.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + (s.open ? " · market open" : " · market closed") : "Loading…"}</span>
      <button type="button" class="mref" data-ref title="Refresh now">↻</button></div>`;
    if (!s) { $("#markets").innerHTML = bar + window.WireUI.skeleton("tiles", { n: 30 }); return; }
    const sections = s.groups.map((g) => {
      let body;
      if (g.pairs) {
        body = `<div class="mgrid mpairs">${g.pairs.map((p) => {
          const a = ret(p.a[0]), b = ret(p.b[0]);
          const sp = a != null && b != null ? a - b : null;
          return `<div class="mpair"><div class="mpn">${esc(p.name)} <span class="${sp > 0 ? "up" : sp < 0 ? "dn" : "dim"}">${sp == null ? "" : (sp > 0 ? "+" : "") + sp.toFixed(2) + " pts"}</span></div>
            <div class="mpt">${tile(p.a[0], p.a[1])}${tile(p.b[0], p.b[1])}</div></div>`;
        }).join("")}</div>`;
      } else {
        const items = [...g.items].sort((x, y) => (ret(y[0]) ?? -1e9) - (ret(x[0]) ?? -1e9));
        body = `<div class="mgrid">${items.map((it) => tile(it[0], it[1], it[2])).join("")}</div>`;
      }
      return `<section class="msec"><h3>${esc(g.title)}</h3>${body}</section>`;
    }).join("");
    const errs = Object.keys(s.errors || {}).filter((k) => !s.data[k]);
    $("#markets").innerHTML = bar + sections + (errs.length ? `<div class="empty">No data for ${esc(errs.join(", "))}.</div>` : "");
  }

  function nameOf(sym) {
    for (const g of M.snap?.groups || []) {
      for (const it of g.items || []) if (it[0] === sym) return it[1];
      for (const p of g.pairs || []) for (const l of [p.a, p.b]) if (l[0] === sym) return l[1];
    }
    return sym;
  }

  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const num = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  function chartSvg(h, high) {
    const W = 400, H = 170;
    const xs = h.map((b) => b[0]), ys = h.map((b) => b[1]);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let lo = Math.min(...ys), hi = Math.max(...ys, high || 0);
    const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
    const X = (t) => ((t - x0) / (x1 - x0 || 1)) * W, Y = (v) => H - ((v - lo) / (hi - lo)) * H;
    const pts = h.map((b) => `${X(b[0]).toFixed(1)},${Y(b[1]).toFixed(1)}`).join(" ");
    const up = ys[ys.length - 1] >= ys[0], c = up ? "#3ecf8e" : "#f2706b";
    return `<div class="mch"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price history">
      <polygon points="0,${H} ${pts} ${W},${H}" fill="${c}" opacity=".13"/>
      ${high ? `<line x1="0" x2="${W}" y1="${Y(high).toFixed(1)}" y2="${Y(high).toFixed(1)}" stroke="#8b93ff" stroke-width="1" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ""}
      <polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>
      <span class="mchy t">${num(hi - pad)}</span><span class="mchy b">${num(lo + pad)}</span></div>
      <div class="mchx"><span>${day(x0)}</span><span>${day(x1)}</span></div>`;
  }

  function loadHistory() {
    const sym = M.sel, range = M.range;
    if (!sym) return;
    api.page.invoke("markets:history", sym, range).then((h) => {
      if (sym === M.sel && range === M.range) { M.hist = { sym, range, h }; renderDetail(); }
    });
  }

  function renderDetail() {
    const el = $("#mdetail");
    if (window.WireInstrument?.isOpen()) return;
    const d = M.sel && M.snap?.data?.[M.sel];
    if (!d) { el.innerHTML = `<div class="empty">Select a tile to see its returns. Keys 1–9 switch the period; click a tile twice for the chart.</div>`; return; }
    const ann = (p) => (ANNUAL[p] ? pct(d.ann?.[p]) : "");
    const rows = (M.snap.periods || []).map((p) => `<tr${p === M.period ? ' class="cur"' : ""}><td>${p}</td><td class="${d.ret[p] > 0 ? "up" : d.ret[p] < 0 ? "dn" : ""}">${pct(d.ret[p])}</td>
      <td class="${d.ann?.[p] > 0 ? "up" : d.ann?.[p] < 0 ? "dn" : ""}">${ann(p)}</td></tr>`).join("");
    const hh = M.hist && M.hist.sym === M.sel && M.hist.range === M.range ? M.hist.h : null;
    el.innerHTML = `<div class="msum"><h2>${esc(nameOf(M.sel))}</h2><div class="dim">${esc(M.sel)} · ${num(d.last)} ${esc(d.currency || "")} · ${day(d.asOf)}</div>
      <h4>Returns</h4>
      <table class="mret"><tr class="hd"><th></th><th>Total</th><th>Per year</th></tr>${rows}</table>
      ${d.historyFrom ? `<div class="dim">History from ${day(d.historyFrom)}</div>` : ""}
      <p>52-week high ${num(d.high52)}${d.high52At ? ` <span class="dim">(${day(d.high52At)})</span>` : ""} · <span class="${d.fromHigh < -10 ? "dn" : ""}">${pct(d.fromHigh, 1)} from high</span></p>
      <h4>Price history</h4>
      <div class="mrange">${RANGES.map((r) => `<button type="button" data-range="${r}" aria-pressed="${r === M.range}">${r}</button>`).join("")}</div>
      ${hh && hh.length > 1 ? chartSvg(hh, d.high52) : `<div class="dim mchl">Loading…</div>`}
      <button type="button" class="mopen" data-open="${esc(M.sel)}">Open chart ↗</button></div>`;
    if (!hh && !M.histPending) { M.histPending = true; loadHistory(); setTimeout(() => (M.histPending = false), 300); }
  }

  function setPeriod(p) {
    if (!SCALE[p]) return;
    M.period = p;
    try { localStorage.setItem("wire.markets.period", p); } catch {}
    render(); renderDetail();
  }

  $("#markets").addEventListener("click", (e) => {
    const per = e.target.closest("[data-per]"); if (per) return setPeriod(per.dataset.per);
    if (e.target.closest("[data-ref]")) { api.page.invoke("markets:refresh").then((s) => { M.snap = s; render(); renderDetail(); }); return; }
    const t = e.target.closest(".mtile"); if (!t) return;
    if (M.sel === t.dataset.sym && !window.WireInstrument?.isOpen()) return window.WireApp.openInstrument(t.dataset.sym);
    M.sel = t.dataset.sym;
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    render(); renderDetail();
  });
  $("#mdetail").addEventListener("click", (e) => {
    const r = e.target.closest("[data-range]");
    if (r) { M.range = r.dataset.range; M.hist = null; M.histPending = false; renderDetail(); return; }
    const b = e.target.closest("[data-open]"); if (b) window.WireApp.openInstrument(b.dataset.open);
  });
  api.page.on("markets:update", (s) => { M.snap = s; render(); renderDetail(); });

  (window.WirePages ||= {}).markets = {
    show() {
      M.visible = true; render(); renderDetail();
      api.page.invoke("markets:get").then((s) => { M.snap = s; render(); renderDetail(); });
    },
    hide() { M.visible = false; },
    key(e) {
      const p = Object.keys(SCALE)[+e.key - 1];
      if (p && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setPeriod(p); }
      else if (e.key === "Enter" && M.sel) window.WireApp.openInstrument(M.sel);
    },
    restore() { renderDetail(); },
    detail: () => $("#mdetail")
  };
})();
