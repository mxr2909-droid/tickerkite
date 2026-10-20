/* WIRE Fed path page. Registers with app.js through window.WirePages (see the "pages" section there).
   Where fed funds futures say the Fed's rate is going, meeting by meeting, against the Fed's own dots;
   how that path moved over the last week and month; the Treasury curve and a money-market strip. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const F = { active: false, data: null, sel: null };

  // ---------- formatting ----------
  const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d) + "%");
  const bp = (v, sign = true) => (v == null || !Number.isFinite(v) ? "—" : `${sign && v > 0.05 ? "+" : ""}${v.toFixed(0) === "-0" ? "0" : v.toFixed(0)}bp`);
  const cls = (v, eps = 0.5) => (v == null ? "" : v > eps ? "up" : v < -eps ? "dn" : "");
  const odd = (p) => `${Math.round(p * 100)}%`;
  const day = (d, o = { month: "short", day: "numeric", year: "numeric" }) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  function meetingLabel(r) {
    const a = new Date(r.start + "T12:00:00Z"), b = new Date(r.date + "T12:00:00Z");
    const mo = (x) => x.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    return mo(a) === mo(b) ? `${mo(a)} ${a.getUTCDate()}–${b.getUTCDate()}` : `${mo(a)} ${a.getUTCDate()}–${mo(b)} ${b.getUTCDate()}`;
  }
  const yr = (r) => r.date.slice(0, 4);
  const moveWord = (r) => (r.dir === "hold" ? "hold" : `${Math.abs(r.move) > 37.5 ? 50 : 25}bp ${r.dir}`);
  const was = (path, date) => path?.rows.find((x) => x.date === date) || null;

  // ---------- charts ----------
  function lineChart({ w = 760, h = 210, xs, series, marks = [], fmtY = (v) => v.toFixed(2), pad = [44, 16, 22, 26] }) {
    const [L, R, T, B] = pad;
    const all = [...series.flatMap((s) => s.pts.filter((p) => p != null)), ...marks.map((m) => m.v)];
    if (!all.length) return "";
    let lo = Math.min(...all), hi = Math.max(...all);
    const span = Math.max(hi - lo, 0.25);
    lo -= span * 0.12; hi += span * 0.12;
    const X = (i) => L + (xs.length < 2 ? 0 : (i * (w - L - R)) / (xs.length - 1));
    const Y = (v) => T + ((hi - v) * (h - T - B)) / (hi - lo);
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      g += `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" class="fgrid"/><text x="${L - 6}" y="${Y(v) + 4}" class="fax" text-anchor="end">${fmtY(v)}</text>`;
    }
    xs.forEach((x, i) => { if (x) g += `<text x="${X(i)}" y="${h - 6}" class="fax" text-anchor="middle">${esc(x)}</text>`; });
    for (const s of series) {
      let d = "";
      s.pts.forEach((p, i) => { if (p != null) d += `${d ? "L" : "M"}${X(i).toFixed(1)},${Y(p).toFixed(1)}`; });
      g += `<path d="${d}" class="fline ${s.cls}"/>`;
      if (s.dots) s.pts.forEach((p, i) => { if (p != null) g += `<circle cx="${X(i)}" cy="${Y(p)}" r="2.6" class="fpt ${s.cls}"/>`; });
    }
    for (const m of marks) g += `<g class="fdot"><circle cx="${X(m.i)}" cy="${Y(m.v)}" r="5"/><text x="${X(m.i) + (X(m.i) > w * 0.8 ? -8 : 8)}" y="${Y(m.v) + 16}" text-anchor="${X(m.i) > w * 0.8 ? "end" : "start"}">${esc(m.label)}</text></g>`;
    return `<svg class="fchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
  }

  function pathChart(d) {
    const rows = d.path.rows;
    const xs = ["now", ...rows.map((r, i) => (i === 0 || yr(r) !== yr(rows[i - 1]) ? day(r.date, { month: "short", year: "2-digit" }) : day(r.date, { month: "short" })))];
    const pts = (p) => [p ? p.start : null, ...rows.map((r) => was(p, r.date)?.post ?? null)];
    const marks = [];
    for (const x of d.dots) {
      const i = rows.map((r) => yr(r)).lastIndexOf(x.year);
      if (i >= 0 && x.dot != null) marks.push({ i: i + 1, v: x.dot, label: `${x.year} dot ${x.dot.toFixed(2)}` });
    }
    return lineChart({ xs, marks, series: [
      { pts: pts(d.m1), cls: "m1" }, { pts: pts(d.w1), cls: "w1" }, { pts: [d.path.start, ...rows.map((r) => r.post)], cls: "now", dots: true }
    ] });
  }

  function curveChart(c) {
    const s = (row, k) => (row ? c.tenors.map((t) => row.y[t] ?? null) : []);
    return lineChart({ xs: c.tenors, series: [{ pts: s(c.y1), cls: "m1" }, { pts: s(c.m1), cls: "w1" }, { pts: s(c.now), cls: "now", dots: true }] });
  }

  // ---------- list ----------
  function render() {
    const el = $("#fed");
    const d = F.data;
    if (!d || d.loading) { el.innerHTML = `<div class="empty">Loading fed funds futures, Fed projections and Treasury yields…</div>`; return; }
    const errs = Object.keys(d.errors || {});
    const note = `${d.fetchedAt ? "updated " + new Date(d.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}${errs.length ? ` · unavailable: ${esc(errs.join(", "))}` : ""}${d.meetingsLive ? "" : " · FOMC dates from WIRE's checked list"}`;
    let h = `<div class="fedbar"><span class="ftitle">FED PATH</span>${d.target ? `<span>target <b>${d.target[0].toFixed(2)}–${d.target[1].toFixed(2)}%</b></span>` : ""}
      <span class="fnote">${note}</span><button type="button" class="frefresh" title="Refresh (r)">↻</button></div>`;
    h += `<div class="fstrip">${d.strip.map((s) => `<div class="ftile"><span class="fl">${esc(s.name)}</span><b>${pct(s.v)}</b><span class="${cls(s.chg)}">${bp(s.chg)} <em>1m</em></span></div>`).join("")}</div>`;
    if (!d.path) {
      h += `<div class="empty">Fed funds futures aren't available right now${d.errors?.futures ? ` (${esc(d.errors.futures)})` : ""}, so there's no market-implied path. WIRE won't guess one; press r to try again.</div>`;
    } else {
      const p = d.path, rows = p.rows, next = rows[0];
      const endW = d.w1?.rows.length ? p.end - d.w1.end : null, endM = d.m1?.rows.length ? p.end - d.m1.end : null;
      h += `<div class="fsum">
        ${next ? `<div class="ftile"><span class="fl">Next meeting · ${esc(meetingLabel(next))}</span><b class="${next.dir === "hike" ? "up" : next.dir === "cut" ? "dn" : ""}">${esc(moveWord(next).toUpperCase())}</b><span>${odd(next.hold)} hold · ${odd(next.p25 + next.p50)} ${next.move >= 0 ? "hike" : "cut"}</span></div>` : ""}
        <div class="ftile"><span class="fl">${p.extreme ? (p.extreme.kind === "peak" ? "Peak" : "Trough") + " implied" : "Peak / trough"}</span><b>${p.extreme ? pct(p.extreme.rate) : "flat"}</b><span>${p.extreme ? esc(day(p.extreme.date, { month: "short", year: "numeric" })) : "no move priced"}</span></div>
        <div class="ftile"><span class="fl">End of path · ${esc(rows.length ? day(rows[rows.length - 1].date, { month: "short", year: "numeric" }) : "")}</span><b>${pct(p.end)}</b><span class="${cls((p.end - p.start) * 100)}">${bp((p.end - p.start) * 100)} from ${pct(p.start)}</span></div>
        <div class="ftile"><span class="fl">Path end vs 1w / 1m ago</span><b><span class="${cls(endW * 100)}">${endW == null ? "—" : bp(endW * 100)}</span> / <span class="${cls(endM * 100)}">${endM == null ? "—" : bp(endM * 100)}</span></b><span class="dim">${endW == null || endM == null ? "builds up as WIRE saves daily prices" : "week / month change"}</span></div>
      </div>`;
      h += `<div class="isec fsec">IMPLIED POLICY RATE BY MEETING <span class="flegend"><i class="now"></i>today <i class="w1"></i>1 week ago <i class="m1"></i>1 month ago <i class="dot"></i>Fed median dot</span></div>${pathChart(d)}`;
      h += `<div class="frow fhead"><span>MEETING</span><span>IMPLIED</span><span>MOVE</span><span>CUM</span><span>ODDS</span><span>Δ 1W</span><span>Δ 1M</span></div>`;
      for (const r of rows) {
        const w = was(d.w1, r.date), m = was(d.m1, r.date);
        const mv = Math.max(0, Math.min(1, r.p25 + r.p50));
        h += `<button type="button" class="row frow" data-date="${r.date}" aria-selected="${r.date === F.sel}">
          <span class="fm">${esc(meetingLabel(r))} <em>${yr(r)}</em>${r.sep ? `<span class="x" title="Comes with new projections (dots)">SEP</span>` : ""}</span>
          <span>${pct(r.post, 3)}</span>
          <span class="${cls(r.move, 2)}">${bp(r.move)}</span>
          <span class="${cls(r.cum, 2)}">${bp(r.cum)}</span>
          <span class="fodds" title="${odd(r.hold)} hold · ${odd(r.p25)} 25bp · ${odd(r.p50)} 50bp"><i class="${r.move >= 0 ? "hk" : "ct"}" style="width:${(mv * 100).toFixed(0)}%"></i><b>${r.dir === "hold" ? `hold ${odd(r.hold)}` : `${r.dir} ${odd(mv)}`}</b></span>
          <span class="${cls(w ? (r.post - w.post) * 100 : null, 1)}">${w ? bp((r.post - w.post) * 100) : "—"}</span>
          <span class="${cls(m ? (r.post - m.post) * 100 : null, 1)}">${m ? bp((r.post - m.post) * 100) : "—"}</span>
        </button>`;
      }
    }
    h += `<div class="isec fsec">MARKET VS FED DOTS <span class="dim">median fed funds projection, SEP of ${esc(day(d.sep.asOf))}${d.sep.live ? "" : ` · WIRE's checked copy (${esc(d.sepChecked)})`}</span></div>
      <div class="frow fdots fhead"><span>YEAR-END</span><span>FED DOT</span><span>PRIOR SEP</span><span>MARKET</span><span>MKT − DOT</span></div>
      ${d.dots.map((x) => `<div class="frow fdots"><span>${esc(x.year)}</span><span>${pct(x.dot)}</span><span class="dim">${pct(x.prior)}</span><span>${x.market == null ? `<span class="dim">${x.year === "Longer run" ? "—" : "past futures"}</span>` : pct(x.market)}</span><span class="${cls(x.gap, 2)}">${x.gap == null ? "—" : bp(x.gap)}</span></div>`).join("")}`;
    if (d.curve) {
      const c = d.curve;
      h += `<div class="isec fsec">TREASURY YIELD CURVE <span class="flegend"><i class="now"></i>${esc(day(c.now.date))} ${c.m1 ? `<i class="w1"></i>${esc(day(c.m1.date))}` : ""} ${c.y1 ? `<i class="m1"></i>${esc(day(c.y1.date))}` : ""}</span></div>${curveChart(c)}
        <div class="fcurve">${c.tenors.map((t) => { const v = c.now.y[t], m = c.m1?.y[t]; return `<span><em>${t}</em>${v == null ? "—" : v.toFixed(2)}<i class="${cls(m != null && v != null ? (v - m) * 100 : null, 1)}">${m != null && v != null ? bp((v - m) * 100) : ""}</i></span>`; }).join("")}</div>`;
    }
    h += `<p class="fsrc">Fed funds futures: CBOT 30-day contracts via Yahoo Finance; implied rate = 100 − price, split around each meeting by days in the month. Projections: Federal Reserve SEP. Yields: U.S. Treasury par yield curve. Rates: FRED.</p>`;
    const y = el.scrollTop;
    el.innerHTML = h;
    el.scrollTop = y;
    if (d.path && !d.path.rows.some((r) => r.date === F.sel)) F.sel = d.path.rows[0]?.date || null;
    mark();
    renderDetail();
  }
  function mark() { document.querySelectorAll("#fed .frow[data-date]").forEach((r) => r.setAttribute("aria-selected", String(r.dataset.date === F.sel))); }
  function select(date) {
    F.sel = date; mark();
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    renderDetail();
  }
  function move(k) {
    const rows = F.data?.path?.rows || [];
    const i = rows.findIndex((r) => r.date === F.sel);
    const n = rows[Math.max(0, Math.min(rows.length - 1, i + k))];
    if (n) { select(n.date); $("#fed").querySelector(`.frow[data-date="${n.date}"]`)?.scrollIntoView({ block: "nearest" }); }
  }

  // ---------- detail ----------
  let hlToken = 0;
  function renderDetail() {
    if (!F.active || window.WireInstrument?.isOpen()) return;
    const el = $("#fdetail"), d = F.data;
    const r = d?.path?.rows.find((x) => x.date === F.sel);
    if (!r) { el.innerHTML = `<div class="empty">${d?.path ? "Pick a meeting." : "No futures-implied path right now."}</div>`; return; }
    const w = was(d.w1, r.date), m = was(d.m1, r.date);
    const dirW = r.move >= 0 ? "hike" : "cut";
    const dot = d.dots.find((x) => x.year === yr(r));
    el.innerHTML = `
      <div class="dhead"><span class="code">FOMC</span><span class="nm">${r.sep ? "decision + projections" : "rate decision"}</span><span class="dt">${esc(day(r.date))}</span></div>
      <h1>${esc(meetingLabel(r))}, ${yr(r)}: market prices ${esc(r.dir === "hold" ? "a hold" : `a ${moveWord(r)}`)}</h1>
      <dl class="kv fkv">
        <dt>DECISION</dt><dd>${esc(day(r.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }))} · 2:00 PM ET</dd>
        <dt>RATE BEFORE</dt><dd>${pct(r.pre, 3)}</dd>
        <dt>RATE AFTER</dt><dd>${pct(r.post, 3)} <span class="${cls(r.move, 2)}">(${bp(r.move)})</span></dd>
        <dt>VS TODAY</dt><dd class="${cls(r.cum, 2)}">${bp(r.cum)} cumulative</dd>
        <hr>
        <dt>HOLD</dt><dd>${odd(r.hold)}</dd>
        <dt>25BP ${dirW.toUpperCase()}</dt><dd>${odd(r.p25)}</dd>
        <dt>50BP ${dirW.toUpperCase()}</dt><dd>${odd(r.p50)}</dd>
        <hr>
        <dt>1 WEEK AGO</dt><dd>${w ? `${pct(w.post, 3)} <span class="${cls((r.post - w.post) * 100, 1)}">(${bp((r.post - w.post) * 100)} since)</span>` : `<span class="dim">no data yet</span>`}</dd>
        <dt>1 MONTH AGO</dt><dd>${m ? `${pct(m.post, 3)} <span class="${cls((r.post - m.post) * 100, 1)}">(${bp((r.post - m.post) * 100)} since)</span>` : `<span class="dim">no data yet</span>`}</dd>
        ${dot?.dot != null ? `<dt>${esc(dot.year)} DOT</dt><dd>${pct(dot.dot)} <span class="dim">Fed median for year-end</span></dd>` : ""}
      </dl>
      <p class="fnote2">Odds use the usual simplification: the expected move is split between the two nearest 25bp steps.</p>
      <div class="isec">RELATED WIRE HEADLINES</div><div class="fhl"><p class="none">Searching…</p></div>`;
    const tok = ++hlToken;
    api.page.invoke("fed:headlines").then((hs) => {
      const box = el.querySelector(".fhl");
      if (tok !== hlToken || !box) return;
      box.innerHTML = hs.length ? hs.map((s) => `<button type="button" class="fstory" data-sid="${esc(s.id)}" data-url="${esc(s.url || "")}"><span class="h">${esc(s.title)}</span><span class="dim">${esc(s.publisher || "")}${s.ts ? " · " + esc(new Date(s.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) : ""}</span></button>`).join("")
        : `<p class="none">No Fed headlines in WIRE's current news.</p>`;
    });
  }

  // ---------- events ----------
  const refresh = () => { $("#fed .frefresh")?.classList.add("spin"); api.page.invoke("fed:refresh").then(apply); };
  $("#fed").addEventListener("click", (ev) => {
    if (ev.target.closest(".frefresh")) return refresh();
    const r = ev.target.closest(".frow[data-date]"); if (r) select(r.dataset.date);
  });
  $("#fdetail").addEventListener("click", (ev) => {
    const s = ev.target.closest(".fstory");
    if (s && !window.WireInstrument.onStory?.(s.dataset.sid) && s.dataset.url) api.open?.(s.dataset.url);
  });
  function apply(d) { if (!d) return; F.data = d; if (F.active) render(); }
  if (api?.page) {
    api.page.on("fed:update", apply);
    api.page.invoke("fed:get").then(apply);
  }

  (window.WirePages ||= {}).fed = {
    show() { F.active = true; render(); if (api?.page) api.page.invoke("fed:get").then(apply); },
    hide() { F.active = false; },
    key(e) {
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
      else if (e.key === "r") refresh();
    },
    restore() { renderDetail(); },
    detail: () => $("#fdetail")
  };
})();
