/* Tickerkite Market heatmap page. Registers with app.js through window.WirePages (see the "pages" section there). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // full-color return per period (a ±SCALE move is fully saturated)
  const SCALE = { "1D": 2, "1W": 4, "1M": 8, "3M": 15, YTD: 25, "1Y": 35, "3Y": 70, "5Y": 110, "10Y": 200 };
  const ANNUAL = { "3Y": 3, "5Y": 5, "10Y": 10 };
  const RANGES = ["1Y", "3Y", "5Y", "10Y", "MAX"];
  const M = { snap: null, period: "1D", sel: null, visible: false, range: "1Y", hist: null, tail: 8 };
  try { M.period = localStorage.getItem("wire.markets.period") || "1D"; M.tail = +localStorage.getItem("wire.markets.tail") || 8; } catch {}
  // sector rotation chart: the four quarters, clockwise from top right
  const QUAD = { leading: ["#3ecf8e", "Leading", "beating the S&P 500 and still gaining on it"], weakening: ["#f2b34a", "Weakening", "still ahead, but losing ground"],
    lagging: ["#f2706b", "Lagging", "behind and falling further back"], improving: ["#5ec2f2", "Improving", "still behind, but catching up"] };
  const quad = (x, y) => (x >= 100 ? (y >= 100 ? "leading" : "weakening") : y >= 100 ? "improving" : "lagging");

  const pct = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
  // terminal theme: pale for a small move, deep for a big one, dark text on the pale end (returns [background, ink])
  function termColor(v) {
    if (v == null) return ["#0d1117", ""];
    const k = Math.min(1, Math.abs(v) / SCALE[M.period]) ** 0.7;
    const [a, b] = v >= 0 ? [[214, 238, 208], [27, 110, 43]] : [[247, 205, 200], [168, 26, 30]];
    return [`rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * k)).join(",")})`, k < 0.5 ? "#0b0f14" : "#fff"];
  }
  function color(v) {
    if (window.TkTheme?.isTerminal()) return termColor(v)[0];
    if (v == null) return "#191c22";
    const k = Math.min(1, Math.abs(v) / SCALE[M.period]) ** 0.8;
    const [r, g, b] = v >= 0 ? [38, 166, 110] : [214, 74, 80];
    const mix = (c, base) => Math.round(base + (c - base) * k);
    return `rgb(${mix(r, 27)},${mix(g, 30)},${mix(b, 37)})`;
  }
  const ret = (sym) => M.snap?.data?.[sym]?.ret?.[M.period] ?? null;

  function tile(sym, name, sub) {
    const v = ret(sym), last = M.snap?.data?.[sym]?.last;
    const ink = window.TkTheme?.isTerminal() ? termColor(v)[1] : "";
    return `<button type="button" class="mtile${M.sel === sym ? " sel" : ""}" data-sym="${esc(sym)}" style="background:${color(v)}${ink ? ";color:" + ink : ""}" title="${esc(sym)}">
      <span class="mn">${esc(name)}</span><span class="mp">${pct(v)}</span><span class="ms"><span>${esc(sub || sym)}</span>${last != null ? `<span>${num(last)}</span>` : ""}</span></button>`;
  }

  /** Sector rotation: each sector's strength against the S&P 500 (across) and whether that strength is rising (up), with a tail of past weeks. */
  function rotationSection(rot) {
    const secs = (rot?.sectors || []).map((s) => ({ ...s, pts: s.pts.slice(-M.tail) })).filter((s) => s.pts.length > 1);
    if (!secs.length) return "";
    const W = 660, H = 430, pl = 40, pr = 14, pt = 12, pb = 34, pw = W - pl - pr, ph = H - pt - pb;
    const dev = Math.max(1.5, ...secs.flatMap((s) => s.pts.flatMap((p) => [Math.abs(p[1] - 100), Math.abs(p[2] - 100)]))) * 1.12;
    const X = (v) => pl + ((v - (100 - dev)) / (2 * dev)) * pw, Y = (v) => pt + (1 - (v - (100 - dev)) / (2 * dev)) * ph;
    const tint = (k, x, y) => `<rect x="${x}" y="${y}" width="${pw / 2}" height="${ph / 2}" fill="${QUAD[k][0]}" opacity=".07"/>`;
    const corner = (k, x, y, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="rot-q" fill="${QUAD[k][0]}">${QUAD[k][1].toUpperCase()}</text>`;
    let g = `<svg viewBox="0 0 ${W} ${H}" class="rot-svg" role="img" aria-label="Sector rotation against the S&amp;P 500">
      ${tint("improving", pl, pt)}${tint("leading", pl + pw / 2, pt)}${tint("lagging", pl, pt + ph / 2)}${tint("weakening", pl + pw / 2, pt + ph / 2)}
      <rect x="${pl}" y="${pt}" width="${pw}" height="${ph}" fill="none" class="rot-box"/>
      <line x1="${X(100)}" x2="${X(100)}" y1="${pt}" y2="${pt + ph}" class="rot-axis"/><line x1="${pl}" x2="${pl + pw}" y1="${Y(100)}" y2="${Y(100)}" class="rot-axis"/>
      ${corner("improving", pl + 8, pt + 16, "start")}${corner("leading", pl + pw - 8, pt + 16, "end")}${corner("lagging", pl + 8, pt + ph - 8, "start")}${corner("weakening", pl + pw - 8, pt + ph - 8, "end")}`;
    const tick = dev > 12 ? 5 : dev > 5 ? 2 : 1;
    for (let v = Math.ceil((100 - dev) / tick) * tick; v <= 100 + dev; v += tick) {
      g += `<text x="${X(v)}" y="${pt + ph + 13}" text-anchor="middle" class="rot-ax">${v}</text><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end" class="rot-ax">${v}</text>`;
    }
    g += `<text x="${pl + pw / 2}" y="${H - 4}" text-anchor="middle" class="rot-ax">STRENGTH VS S&amp;P 500 (100 = IN LINE) →</text>
      <text transform="translate(10 ${pt + ph / 2}) rotate(-90)" text-anchor="middle" class="rot-ax">MOMENTUM (ABOVE 100 = GAINING) →</text>`;
    // selected sector last, so it sits on top
    for (const s of [...secs].sort((a, b) => (a.sym === M.sel) - (b.sym === M.sel))) {
      const n = s.pts.length, head = s.pts[n - 1], k = quad(head[1], head[2]), col = QUAD[k][0], on = s.sym === M.sel;
      for (let i = 1; i < n; i++) g += `<line x1="${X(s.pts[i - 1][1]).toFixed(1)}" y1="${Y(s.pts[i - 1][2]).toFixed(1)}" x2="${X(s.pts[i][1]).toFixed(1)}" y2="${Y(s.pts[i][2]).toFixed(1)}" stroke="${col}" stroke-width="${on ? 2.6 : 1.5}" stroke-linecap="round" opacity="${(0.18 + 0.82 * (i / (n - 1))).toFixed(2)}"/>`;
      for (let i = 0; i < n - 1; i++) g += `<circle cx="${X(s.pts[i][1]).toFixed(1)}" cy="${Y(s.pts[i][2]).toFixed(1)}" r="1.7" fill="${col}" opacity="${(0.25 + 0.6 * (i / (n - 1))).toFixed(2)}"/>`;
      const hx = X(head[1]), hy = Y(head[2]), left = hx > pl + pw - 44;
      g += `<g class="rot-dot${on ? " sel" : ""}" data-rot="${esc(s.sym)}"><circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${on ? 7 : 5.5}" fill="${col}"/>
        <text x="${(hx + (left ? -9 : 9)).toFixed(1)}" y="${(hy + 3.5).toFixed(1)}" text-anchor="${left ? "end" : "start"}" class="rot-lb">${esc(s.sym)}</text>
        <title>${esc(s.name)}: ${QUAD[k][1].toLowerCase()}, ${QUAD[k][2]} (strength ${head[1].toFixed(1)}, momentum ${head[2].toFixed(1)})</title></g>`;
    }
    g += "</svg>";
    const lists = Object.keys(QUAD).map((k) => {
      const names = secs.filter((s) => quad(s.pts[s.pts.length - 1][1], s.pts[s.pts.length - 1][2]) === k);
      return `<div class="rot-l"><b style="color:${QUAD[k][0]}">${QUAD[k][1]}</b><span class="dim">${QUAD[k][2]}</span><div>${names.length ? names.map((s) => `<button type="button" data-rot="${esc(s.sym)}"${s.sym === M.sel ? ' class="sel"' : ""}>${esc(s.name)}</button>`).join("") : `<span class="dim">none</span>`}</div></div>`;
    }).join("");
    return `<section class="msec"><h3>Sector rotation · against the S&amp;P 500, weekly
        <span class="mrange rot-tail" title="How many past weeks each tail shows">${[4, 8, 12].map((t) => `<button type="button" data-tail="${t}" aria-pressed="${t === M.tail}">${t}W</button>`).join("")}</span></h3>
      <div class="rot"><div class="rot-chart">${g}</div><div class="rot-side">${lists}
        <p class="dim">Each dot is a sector today and its tail is where it was in past weeks. Sectors usually travel clockwise: improving, leading, weakening, lagging.</p></div></div></section>`;
  }

  function render() {
    if (!M.visible) return;
    const s = M.snap;
    const bar = `<div class="mbar"><span class="mperiods">${(s?.periods || Object.keys(SCALE)).map((p, i) =>
      `<button type="button" data-per="${p}" data-k="${i + 1}" aria-pressed="${p === M.period}" title="Key ${i + 1}">${p}</button>`).join("")}</span>
      <span class="dim">${s?.fetchedAt ? "Updated " + new Date(s.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + (s.open ? " · market open" : " · market closed") : "Loading…"}</span>
      <button type="button" class="mref" data-ref title="Refresh now">↻</button></div>`;
    if (!s) { $("#markets").innerHTML = bar + window.WireUI.skeleton("tiles", { n: 30 }); return; }
    chrome();
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
      return `<section class="msec"><h3>${esc(g.title)}</h3>${body}</section>` + (g.id === "sectors" ? rotationSection(s.rotation) : "");
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
    const tl = e.target.closest("[data-tail]");
    if (tl) { M.tail = +tl.dataset.tail; try { localStorage.setItem("wire.markets.tail", M.tail); } catch {} return render(); }
    const rd = e.target.closest("[data-rot]");
    if (rd) { M.sel = rd.dataset.rot; if (window.WireInstrument?.isOpen()) window.WireInstrument.close(); render(); renderDetail(); return; }
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
  // terminal header: "US MARKET OPEN · REFRESH 15 MIN" and the data time
  function chrome() { const s = M.snap; if (!s) return; window.WireChrome?.pulled("markets", s.fetchedAt); window.WireChrome?.status("markets", `US MARKET ${s.open ? "OPEN" : "CLOSED"}`); }

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
