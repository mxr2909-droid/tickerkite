/* WIRE Market heatmap page. Registers with app.js through window.WirePages (see the "pages" section there). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // full-color return per period (a ±SCALE move is fully saturated)
  const SCALE = { "1D": 2, "1W": 4, "1M": 8, "3M": 15, YTD: 25 };
  const M = { snap: null, period: "1D", sel: null, visible: false };
  try { M.period = localStorage.getItem("wire.markets.period") || "1D"; } catch {}

  const pct = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
  function color(v) {
    if (v == null) return "#151517";
    const k = Math.min(1, Math.abs(v) / SCALE[M.period]) ** 0.8;
    const [r, g, b] = v >= 0 ? [22, 150, 82] : [196, 46, 40];
    const mix = (c, base) => Math.round(base + (c - base) * k);
    return `rgb(${mix(r, 30)},${mix(g, 30)},${mix(b, 32)})`;
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
    if (!s) { $("#markets").innerHTML = bar; return; }
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

  function renderDetail() {
    const el = $("#mdetail");
    if (window.WireInstrument?.isOpen()) return;
    const d = M.sel && M.snap?.data?.[M.sel];
    if (!d) { el.innerHTML = `<div class="empty">Select a tile to see its returns. Keys 1–5 switch the period; click a tile twice for the chart.</div>`; return; }
    const rows = (M.snap.periods || []).map((p) => `<tr${p === M.period ? ' class="cur"' : ""}><td>${p}</td><td class="${d.ret[p] > 0 ? "up" : d.ret[p] < 0 ? "dn" : ""}">${pct(d.ret[p])}</td></tr>`).join("");
    el.innerHTML = `<div class="msum"><h2>${esc(nameOf(M.sel))}</h2><div class="dim">${esc(M.sel)} · ${d.last.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${esc(d.currency || "")} · ${new Date(d.asOf).toISOString().slice(0, 10)}</div>
      <table class="mret">${rows}</table>
      <p>52-week high ${d.high52.toLocaleString(undefined, { maximumFractionDigits: 2 })} · <span class="${d.fromHigh < -10 ? "dn" : ""}">${pct(d.fromHigh, 1)} from high</span></p>
      <button type="button" class="mopen" data-open="${esc(M.sel)}">Open chart ↗</button></div>`;
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
