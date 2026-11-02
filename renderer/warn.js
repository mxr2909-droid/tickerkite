/* Tickerkite Warning history (WARN): every risk monitor's probability over time, its past WARNING
   episodes, whether the event followed, and what the S&P 500 did next. Data comes from src/monitors.js. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const W = { active: false, data: null, sel: null, mode: "realtime" };
  try { W.sel = localStorage.getItem("wire.warn.sel"); W.mode = localStorage.getItem("wire.warn.mode") || "realtime"; } catch {}
  // real time: the model refit each year on what was known then (src/factor.js realtime()); fitted: today's model over all history
  const view = (m) => (W.mode === "realtime" && m.realtime ? { history: m.realtime.history, episodes: m.realtime.episodes, rt: true } : { history: m.history, episodes: m.episodes, rt: false });
  const pc = (p, d = 0) => (p == null || !Number.isFinite(p) ? "—" : `${(p * 100).toFixed(d)}%`);
  const sp = (r) => (r == null ? `<span class="dim">—</span>` : `<span class="${r >= 0 ? "up" : "dn"}">${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%</span>`);
  const mon = () => W.data?.list?.find((x) => x.id === W.sel) || W.data?.list?.[0];

  function stats(m, mode = W.mode) {
    const ep = (mode === "realtime" && m.realtime ? m.realtime.episodes : m.episodes) || [], done = ep.filter((e) => e.outcome === "hit" || e.outcome === "false alarm");
    const hits = done.filter((e) => e.outcome === "hit").length;
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    return { n: ep.length, hits, misses: done.length - hits, pending: ep.filter((e) => e.outcome === "pending").length, during: ep.filter((e) => e.outcome === "during").length, rate: done.length ? hits / done.length : null,
      spx12: avg(ep.map((e) => e.spx12).filter((v) => v != null)) };
  }

  function render() {
    if (!W.active) return;
    const el = $("#warn"), d = W.data;
    if (!d?.list?.length) { el.innerHTML = `<div class="wn"><p class="dim">${d?.errors && Object.keys(d.errors).length ? "The risk monitors couldn't load their data yet. They retry on their own." : "Working out the risk monitors (a few seconds after launch)…"}</p></div>`; renderDetail(); return; }
    const m = mon(); W.sel = m.id;
    const s = stats(m), v = view(m);
    const tabs = d.list.map((x, i) => `<button type="button" data-sel="${esc(x.id)}" aria-pressed="${x.id === m.id}"><span class="k">${i + 1}</span>${esc(x.short)}<i class="${x.status.toLowerCase()}">${x.status}</i></button>`).join("");
    const rows = [...(v.episodes || [])].reverse().map((e) => `<tr><td>${esc(e.start)}</td><td>${e.end === e.start ? "" : esc(e.end)}</td><td>${e.months}</td><td>${pc(e.peak)}</td>
      <td class="oc ${e.outcome.replace(" ", "-")}">${e.outcome === "hit" ? "✓ Event followed" : e.outcome === "false alarm" ? "✗ False alarm" : e.outcome === "during" ? "• During the event" : "… Too soon to tell"}</td><td>${sp(e.spx6)}</td><td>${sp(e.spx12)}</td></tr>`).join("");
    el.innerHTML = `<div class="wn">
      <div class="wn-tabs">${tabs}</div>
      <div class="wn-head"><h2>${esc(m.name)}</h2><p>${esc(m.why)}</p></div>
      <div class="wn-mode" role="group" aria-label="History view"><button type="button" data-mode="realtime" aria-pressed="${W.mode === "realtime"}">REAL TIME</button><button type="button" data-mode="fitted" aria-pressed="${W.mode === "fitted"}">FITTED</button>
        <span>${v.rt ? `What the model would have said at the time: refit each year on data and outcomes known then, from ${esc(m.realtime.from)}.` : "Today's model drawn back over all history. It learned from these years, so it looks sharper than it was."}</span></div>
      <div class="wn-tiles">
        <div><span>NOW</span><b class="${m.status.toLowerCase()}">${pc(m.p)}</b><em>${m.status} · usual ${pc(m.base)}</em></div>
        <div><span>PAST WARNINGS</span><b>${s.n}</b><em>${s.hits} followed · ${s.misses} false alarm${s.misses === 1 ? "" : "s"}${s.pending ? ` · ${s.pending} pending` : ""}${s.during ? ` · ${s.during} during one` : ""}</em></div>
        <div><span>HIT RATE</span><b>${s.rate == null ? "—" : pc(s.rate)}</b><em>of warnings with a known outcome</em></div>
        <div><span>${v.rt ? "REAL-TIME AUC" : "CROSS-VALIDATED AUC"}</span><b>${(v.rt ? m.realtime.auc : m.quality.auc)?.toFixed(2) ?? "—"}</b><em>${v.rt ? "how well it ranked months in real time" : "ranking on held-back years"}</em></div>
        <div><span>S&P 500 NEXT 12 MO</span><b>${s.spx12 == null ? "—" : `${s.spx12 >= 0 ? "+" : ""}${(s.spx12 * 100).toFixed(1)}%`}</b><em>average after a warning began</em></div>
      </div>
      <div class="wn-sec">PROBABILITY OVER TIME <span class="dim">(red bands: WARNING · ticks: months the event went on to happen)</span></div>
      <div class="wn-chart" id="wnchart"></div>
      <div class="wn-sec">PAST WARNINGS</div>
      ${rows ? `<table class="wn-tab num"><thead><tr><th>BEGAN</th><th>ENDED</th><th>MONTHS</th><th>PEAK</th><th>OUTCOME</th><th>S&P 6 MO</th><th>S&P 12 MO</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="dim">This monitor has never reached WARNING.</p>`}
      <p class="wn-note">${v.rt ? "Real time uses today's revised data, not the figures first published, so it's still slightly kinder than true real time." : `The fitted line is today's model over the years it learned from. Cross-validated AUC ${m.quality.auc.toFixed(2)} (${esc(m.quality.grade)}).`} A warning means conditions like the ones that came before past events, not that one is coming.</p>
    </div>`;
    drawChart(m);
    renderDetail();
  }

  function drawChart(m) {
    const box = $("#wnchart"), v = view(m);
    if (!box || !v.history?.length) return;
    const H0 = v.history, W0 = Math.max(320, box.clientWidth), H = 220, pad = { l: 40, r: 12, t: 10, b: 22 };
    const X = (i) => pad.l + (i / (H0.length - 1 || 1)) * (W0 - pad.l - pad.r), Y = (p) => pad.t + (1 - p) * (H - pad.t - pad.b);
    const idx = new Map(H0.map(([p], i) => [p, i]));
    let g = `<svg viewBox="0 0 ${W0} ${H}" width="${W0}" height="${H}">`;
    for (const e of v.episodes || []) { const a = idx.get(e.start), b = idx.get(e.end); if (a == null) continue; g += `<rect x="${X(a)}" y="${pad.t}" width="${Math.max(2, X(b) - X(a) + (W0 - pad.l - pad.r) / H0.length)}" height="${H - pad.t - pad.b}" fill="var(--down)" opacity=".18"><title>WARNING ${esc(e.start)}${e.end !== e.start ? " to " + esc(e.end) : ""}: ${esc(e.outcome)}</title></rect>`; }
    for (const p of [0, 0.25, 0.5, 0.75, 1]) g += `<line x1="${pad.l}" x2="${W0 - pad.r}" y1="${Y(p)}" y2="${Y(p)}" stroke="var(--line)"/><text x="${pad.l - 6}" y="${Y(p) + 3}" text-anchor="end" font-size="10" fill="var(--dim)">${p * 100}%</text>`;
    const thr = Math.max(0.3, 2 * m.base);
    g += `<line x1="${pad.l}" x2="${W0 - pad.r}" y1="${Y(thr)}" y2="${Y(thr)}" stroke="var(--down)" stroke-dasharray="4 3" opacity=".7"/><text x="${W0 - pad.r}" y="${Y(thr) - 4}" text-anchor="end" font-size="10" fill="var(--down)">warning ${pc(thr)}</text>`;
    g += `<line x1="${pad.l}" x2="${W0 - pad.r}" y1="${Y(m.base)}" y2="${Y(m.base)}" stroke="var(--dim)" stroke-dasharray="2 3"/><text x="${pad.l + 4}" y="${Y(m.base) - 4}" font-size="10" fill="var(--dim)">usual ${pc(m.base)}</text>`;
    H0.forEach(([, , y], i) => { if (y === 1) g += `<line x1="${X(i)}" x2="${X(i)}" y1="${H - pad.b}" y2="${H - pad.b - 6}" stroke="var(--warn)"/>`; });
    const every = Math.max(1, Math.ceil(H0.length / 84)) * 12;
    H0.forEach(([p], i) => { if (p.endsWith("-01") && (+p.slice(0, 4)) % Math.max(1, every / 12) === 0) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--dim)">${p.slice(0, 4)}</text>`; });
    // the other view, faint, for comparison (only over the same months)
    const other = v.rt ? m.history : m.realtime?.history;
    if (other) { const oi = new Map(other.map(([p, pr]) => [p, pr])); g += `<polyline points="${H0.map(([p], i) => (oi.has(p) ? `${X(i).toFixed(1)},${Y(oi.get(p)).toFixed(1)}` : null)).filter(Boolean).join(" ")}" fill="none" stroke="var(--dim)" stroke-width="1" opacity=".45"/>`; }
    g += `<polyline points="${H0.map(([, pr], i) => `${X(i).toFixed(1)},${Y(pr).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.5"/><circle cx="${X(H0.length - 1)}" cy="${Y(H0[H0.length - 1][1])}" r="3.5" fill="var(--accent)"/></svg>
      <div class="wn-legend"><span><i style="background:var(--accent)"></i>${v.rt ? "real time" : "fitted"}</span>${other ? `<span><i style="background:var(--dim)"></i>${v.rt ? "fitted" : "real time"}</span>` : ""}</div>`;
    box.innerHTML = g;
  }

  function renderDetail() {
    const el = $("#wndetail"), d = W.data;
    if (!el) return;
    if (!d?.list?.length) { el.innerHTML = ""; return; }
    const all = d.list.map((x) => ({ x, s: stats(x) }));
    el.innerHTML = `<div class="wn-d">
      <div class="dhead"><span class="code">WARN</span><span class="nm">ALL MONITORS</span><span class="dt">${esc(d.list[0].period)}</span></div>
      <table class="wn-tab num"><thead><tr><th>MONITOR</th><th>NOW</th><th>REAL-TIME AUC</th><th>HIT RATE (REAL TIME)</th><th>FITTED</th></tr></thead><tbody>
        ${all.map(({ x }) => { const r = stats(x, "realtime"), f = stats(x, "fitted"); return `<tr class="pick" data-sel="${esc(x.id)}"><td>${esc(x.short)}</td><td class="${x.status.toLowerCase()}">${pc(x.p)}</td><td>${x.realtime?.auc?.toFixed(2) ?? "—"}</td><td>${r.rate == null ? `<span class="dim">no warnings</span>` : `${pc(r.rate)} <span class="dim">(${r.hits}/${r.hits + r.misses})</span>`}</td><td class="dim">${f.rate == null ? "—" : pc(f.rate)}</td></tr>`; }).join("")}
      </tbody></table>
      <p class="wn-note">A warning starts when a monitor reaches 30% and at least twice its usual rate; a gap of one month doesn't end it. "Event followed" means the event happened within the monitor's window after at least one month of the warning.</p>
      <button type="button" class="open" data-open="${esc(mon().id)}">OPEN ${esc(mon().short.toUpperCase())} MODEL <span>›</span></button>
    </div>`;
  }

  const click = (e) => {
    if (!W.active) return;
    const md = e.target.closest("[data-mode]"); if (md) { W.mode = md.dataset.mode; try { localStorage.setItem("wire.warn.mode", W.mode); } catch {} render(); return; }
    const t = e.target.closest("[data-sel]"); if (t) { W.sel = t.dataset.sel; try { localStorage.setItem("wire.warn.sel", W.sel); } catch {} render(); return; }
    const o = e.target.closest("[data-open]"); if (o) window.WireFactor?.open(o.dataset.open);
  };
  $("#warn").addEventListener("click", click);
  $("#wndetail").addEventListener("click", click);
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => W.active && mon() && drawChart(mon()), 150); });
  if (api?.page) {
    api.page.on("monitors:update", (d) => { W.data = d; render(); });
    api.page.invoke("monitors:get").then((d) => { W.data = d; render(); }).catch(() => {});
  }

  (window.WirePages ||= {}).warn = {
    show() { W.active = true; render(); },
    hide() { W.active = false; },
    key(e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const list = W.data?.list || [];
      if (/^[1-9]$/.test(e.key) && !e.metaKey && list[+e.key - 1]) { W.sel = list[+e.key - 1].id; render(); }
      else if (e.key === "Enter" && mon()) window.WireFactor?.open(mon().id);
    },
    restore() { renderDetail(); },
    detail: () => $("#wndetail")
  };
})();
