/* Tickerkite Fed path page. Registers with app.js through window.WirePages (see the "pages" section there).
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

  const PRIME = 3.12; // prime rate over fed funds, as in the reference layout
  const hikeCls = (v, eps = 0.5) => (v == null ? "" : v > eps ? "hk" : v < -eps ? "ct" : "");
  const short = (d) => day(d, { month: "short", day: "numeric" });
  const age = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 2 ? "just now" : m < 90 ? `${m} min ago` : `${Math.round(m / 60)}h ago`; };

  // ---------- charts ----------
  // series: { pts, cls, step, dots }; marks: diamonds at (i, v) with a label
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
      let d = "", last = null;
      s.pts.forEach((p, i) => {
        if (p == null) return;
        const x = X(i).toFixed(1), y = Y(p).toFixed(1);
        d += !d ? `M${x},${y}` : s.step ? `H${x}V${y}` : `L${x},${y}`;
        last = i;
      });
      if (s.step && last != null && last < xs.length - 1) d += `H${X(xs.length - 1).toFixed(1)}`;
      g += `<path d="${d}" class="fline ${s.cls}"/>`;
      if (s.dots) s.pts.forEach((p, i) => { if (p != null) g += `<circle cx="${X(i)}" cy="${Y(p)}" r="2.4" class="fpt ${s.cls}"/>`; });
    }
    for (const m of marks) {
      const x = X(m.i), y = Y(m.v), right = x > w * 0.7;
      g += `<g class="fdot"><path d="M${x},${y - 6}L${x + 6},${y}L${x},${y + 6}L${x - 6},${y}Z"/><text x="${x + (right ? -9 : 9)}" y="${y + 17}" text-anchor="${right ? "end" : "start"}">${esc(m.label)}</text></g>`;
    }
    return `<svg class="fchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
  }

  function pathChart(d) {
    const rows = d.path.rows;
    const xs = ["now", ...rows.map((r, i) => (i === 0 || yr(r) !== yr(rows[i - 1]) ? day(r.date, { month: "short", year: "2-digit" }) : day(r.date, { month: "short" })))];
    const pts = (p) => [p ? p.start : null, ...rows.map((r) => was(p, r.date)?.post ?? null)];
    const sepDay = short(d.sep.asOf).toUpperCase();
    const marks = [];
    for (const x of d.dots) {
      const i = rows.map((r) => yr(r)).lastIndexOf(x.year);
      if (i >= 0 && x.dot != null) marks.push({ i: i + 1, v: x.dot, label: `${sepDay} DOT, END-${x.year.slice(2)}: ${x.dot.toFixed(2)}` });
    }
    return lineChart({ xs, marks, series: [
      { pts: pts(d.m1), cls: "m1", step: true }, { pts: pts(d.w1), cls: "w1", step: true }, { pts: [d.path.start, ...rows.map((r) => r.post)], cls: "now", step: true }
    ] });
  }

  function curveChart(c) {
    const s = (row) => (row ? c.tenors.map((t) => row.y[t] ?? null) : []);
    return lineChart({ w: 420, h: 200, pad: [36, 10, 14, 24], xs: c.tenors.map((t, i) => (i % 2 ? "" : t)), series: [{ pts: s(c.y1), cls: "m1" }, { pts: s(c.m1), cls: "w1" }, { pts: s(c.now), cls: "now" }] });
  }

  // ---------- list ----------
  function tiles(d) {
    const p = d.path, rows = p.rows, next = rows[0], last = rows[rows.length - 1];
    const t = (label, big, sub, c = "") => `<div class="ftile"><span class="fl">${label}</span><b class="${c}">${big}</b><span>${sub}</span></div>`;
    let h = "";
    if (next) {
      const mv = Math.min(1, Math.abs(next.move) / 25), dir = next.move >= 0 ? "hike" : "cut";
      h += t(`NEXT FOMC · ${esc(short(next.date).toUpperCase())}`, odd(mv), `odds of a 25bp ${dir}`, mv >= 0.5 ? hikeCls(next.move) : "");
      h += t(`PRICED BY ${esc(day(last.date).toUpperCase())}`, bp(last.cum), `≈ ${Math.abs(last.cum / 25).toFixed(1)} ${last.cum >= 0 ? "hikes" : "cuts"}`, hikeCls(last.cum, 2));
    }
    h += p.extreme
      ? t(p.extreme.kind === "peak" ? "PEAK IMPLIED RATE" : "TROUGH IMPLIED RATE", pct(p.extreme.rate), `after the ${esc(day(p.extreme.date))} meeting`)
      : t("PEAK IMPLIED RATE", pct(p.start), "no move priced");
    const gap = [...d.dots].reverse().find((x) => x.gap != null);
    h += gap
      ? t(`MARKET VS. FED DOT (${esc(short(d.sep.asOf).toUpperCase())})`, bp(gap.gap), `market ${pct(gap.market)} vs. ${esc(short(d.sep.asOf))} median (end-${esc(gap.year.slice(2))})`, hikeCls(gap.gap, 2))
      : t("MARKET VS. FED DOT", "—", "no overlapping year");
    return `<div class="fsum">${h}</div>`;
  }

  function table(d) {
    const p = d.path;
    let h = `<div class="isec fsec">MEETING BY MEETING</div>
      <div class="frow fhead"><span>MEETING</span><span>IMPLIED RATE</span><span>MOVE (BP)</span><span>ODDS OF A 25BP MOVE</span><span>CUMULATIVE (BP)</span><span># HIKES</span><span>PRIME</span></div>
      <div class="frow ftoday"><span class="fm">Today <em>EFFR</em></span><span>${pct(p.start)}</span><span class="dim">—</span><span></span><span class="dim">—</span><span class="dim">—</span><span>${pct(p.start + PRIME)}</span></div>`;
    for (const r of p.rows) {
      const mv = Math.min(1, Math.abs(r.move) / 25), dir = r.move >= 0 ? "HIKE" : "CUT";
      h += `<button type="button" class="row frow" data-date="${r.date}" aria-selected="${r.date === F.sel}">
        <span class="fm">${esc(day(r.date))}${r.sep ? `<span class="x" title="Comes with new projections (dots)">SEP</span>` : ""}</span>
        <span>${pct(r.post)}</span>
        <span class="${hikeCls(r.move, 2)}">${bp(r.move)}</span>
        <span class="fodds" title="${odd(r.hold)} hold · ${odd(r.p25)} 25bp · ${odd(r.p50)} 50bp"><i class="${r.move >= 0 ? "hk" : "ct"}" style="width:${(mv * 100).toFixed(0)}%"></i><b>${odd(mv)} ${dir}</b></span>
        <span class="${hikeCls(r.cum, 2)}">${bp(r.cum)}</span>
        <span>${r.cum >= 0 ? "+" : "−"}${Math.abs(r.cum / 25).toFixed(2)}</span>
        <span>${pct(r.post + PRIME)}</span>
      </button>`;
    }
    return h;
  }

  function moved(d) {
    const p = d.path, ch = (o) => (o?.rows.length ? bp((p.end - o.end) * 100) : null);
    const w = ch(d.w1), m = ch(d.m1);
    const cap = w || m ? `End-of-path rate ${[w && `${w} vs. a week ago`, m && `${m} vs. a month ago`].filter(Boolean).join(", ")}.` : "Builds up as Tickerkite saves daily prices.";
    return `<div class="isec fsec">HOW THE PATH MOVED <span class="flegend"><i class="now"></i>today <i class="w1"></i>1 week ago <i class="m1"></i>1 month ago <i class="dot"></i>Fed median dot</span></div>
      ${pathChart(d)}<p class="fcap">${esc(cap)}</p>`;
  }

  function dotsTable(d) {
    return `<div class="isec fsec">MARKET VS FED DOTS <span class="dim">median fed funds projection, SEP of ${esc(day(d.sep.asOf))}${d.sep.live ? "" : ` · Tickerkite's checked copy (${esc(d.sepChecked)})`}</span></div>
      <div class="frow fdots fhead"><span>YEAR-END</span><span>FED DOT</span><span>PRIOR SEP</span><span>MARKET</span><span>MKT − DOT</span></div>
      ${d.dots.map((x) => `<div class="frow fdots"><span>${esc(x.year)}</span><span>${pct(x.dot)}</span><span class="dim">${pct(x.prior)}</span><span>${x.market == null ? `<span class="dim">${x.year === "Longer run" ? "—" : "past futures"}</span>` : pct(x.market)}</span><span class="${hikeCls(x.gap, 2)}">${x.gap == null ? "—" : bp(x.gap)}</span></div>`).join("")}`;
  }

  function side(d) {
    let h = "";
    const c = d.curve;
    if (c) {
      const row = (t) => {
        const v = c.now.y[t], m = c.m1?.y[t], y = c.y1?.y[t], dd = (a) => (a != null && v != null ? (v - a) * 100 : null);
        return `<div class="fcrow"><span>${t}</span><span>${pct(v)}</span><span class="${hikeCls(dd(m), 1)}">${bp(dd(m))}</span><span class="${hikeCls(dd(y), 1)}">${bp(dd(y))}</span></div>`;
      };
      h += `<div class="isec">TREASURY CURVE</div>
        <div class="flegend fl2"><i class="now"></i>${esc(short(c.now.date))} ${c.m1 ? `<i class="w1"></i>1 month ago` : ""} ${c.y1 ? `<i class="m1"></i>1 year ago` : ""}</div>
        ${curveChart(c)}
        <div class="fcrow fhead"><span></span><span>LEVEL</span><span>1M</span><span>1Y</span></div>${["3M", "2Y", "10Y", "30Y"].map(row).join("")}`;
    }
    h += `<div class="isec">MONEY MARKETS</div>${d.strip.map((s) => `<div class="fcrow fmm"><span>${esc(s.name)}</span><span>${pct(s.v)}</span><span class="${hikeCls(s.chg, 0.5)}">${bp(s.chg)}</span><span class="dim">1M</span></div>`).join("")}`;
    return `<div class="fside">${h}</div>`;
  }

  function render() {
    const el = $("#fed");
    const d = F.data;
    if (!d || d.loading) { el.innerHTML = window.WireUI.skeleton("chart", { label: "Loading fed funds futures, Fed projections and Treasury yields…" }); return; }
    const errs = Object.keys(d.errors || {});
    const right = [d.effr != null ? `EFFR <b>${pct(d.effr)}</b>` : "", d.quoteAt ? `futures ${esc(new Date(d.quoteAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}` : "",
      d.fetchedAt ? `data ${age(d.fetchedAt)}` : "", errs.length ? `unavailable: ${esc(errs.join(", "))}` : "", d.meetingsLive ? "" : "FOMC dates from Tickerkite's checked list"].filter(Boolean).join(" · ");
    let h = `<div class="fedbar"><span class="ftitle">FED FUNDS PATH, MARKET-IMPLIED</span>${d.target ? `<span class="dim">target ${d.target[0].toFixed(2)}–${d.target[1].toFixed(2)}%</span>` : ""}
      <span class="fnote">${right}</span><button type="button" class="frefresh" title="Refresh (r)">↻</button></div>`;
    let main = "";
    if (!d.path) main = `<div class="empty">Fed funds futures aren't available right now${d.errors?.futures ? ` (${esc(d.errors.futures)})` : ""}, so there's no market-implied path. Tickerkite won't guess one; press r to try again.</div>`;
    else main = tiles(d) + table(d) + moved(d);
    main += dotsTable(d);
    h += `<div class="fcols"><div class="fmain">${main}</div>${side(d)}</div>
      <p class="fsrc">CBOT 30-day fed funds futures via Yahoo Finance (delayed); implied rate = 100 − price, split around each meeting by days in the month (CME FedWatch method; odds are for one 25bp move). Dots = FOMC median year-end projection (Summary of Economic Projections). Prime = fed funds + ${PRIME.toFixed(2)}%. Yields: U.S. Treasury par yield curve. Rates: FRED.</p>`;
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
        <dt>Decision</dt><dd>${esc(day(r.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }))} · 2:00 PM ET</dd>
        <dt>Rate before</dt><dd>${pct(r.pre, 3)}</dd>
        <dt>Rate after</dt><dd>${pct(r.post, 3)} <span class="${cls(r.move, 2)}">(${bp(r.move)})</span></dd>
        <dt>Vs today</dt><dd class="${cls(r.cum, 2)}">${bp(r.cum)} cumulative</dd>
        <hr>
        <dt>Hold</dt><dd>${odd(r.hold)}</dd>
        <dt>25BP ${dirW.toUpperCase()}</dt><dd>${odd(r.p25)}</dd>
        <dt>50BP ${dirW.toUpperCase()}</dt><dd>${odd(r.p50)}</dd>
        <hr>
        <dt>1 week ago</dt><dd>${w ? `${pct(w.post, 3)} <span class="${cls((r.post - w.post) * 100, 1)}">(${bp((r.post - w.post) * 100)} since)</span>` : `<span class="dim">no data yet</span>`}</dd>
        <dt>1 month ago</dt><dd>${m ? `${pct(m.post, 3)} <span class="${cls((r.post - m.post) * 100, 1)}">(${bp((r.post - m.post) * 100)} since)</span>` : `<span class="dim">no data yet</span>`}</dd>
        ${dot?.dot != null ? `<dt>${esc(dot.year)} DOT</dt><dd>${pct(dot.dot)} <span class="dim">Fed median for year-end</span></dd>` : ""}
      </dl>
      <p class="fnote2">Odds use the usual simplification: the expected move is split between the two nearest 25bp steps.</p>
      <div class="isec">RELATED TICKERKITE HEADLINES</div><div class="fhl"><p class="none">Searching…</p></div>`;
    const tok = ++hlToken;
    api.page.invoke("fed:headlines").then((hs) => {
      const box = el.querySelector(".fhl");
      if (tok !== hlToken || !box) return;
      box.innerHTML = hs.length ? hs.map((s) => `<button type="button" class="fstory" data-sid="${esc(s.id)}" data-url="${esc(s.url || "")}"><span class="h">${esc(s.title)}</span><span class="dim">${esc(s.publisher || "")}${s.ts ? " · " + esc(new Date(s.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) : ""}</span></button>`).join("")
        : `<p class="none">No Fed headlines in Tickerkite's current news.</p>`;
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
