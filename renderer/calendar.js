/* WIRE Economic calendar page. Registers with app.js through window.WirePages (see the "pages" section there).
   Economic releases, Fed meetings and watchlist earnings with countdowns; after a release, the new
   reading next to the previous one (from the scorecard data) and related WIRE headlines. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAY = 864e5;
  const CATS = [["all", "All"], ["macro", "Macro"], ["fed", "Fed"], ["earnings", "Earnings"]];
  const C = { active: false, data: null, cat: "all", sel: null, list: [], latest: {} };
  try { C.cat = localStorage.getItem("wire.cal.cat") || "all"; } catch {}

  // ---------- time (US Eastern) ----------
  const ETF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (t) => Object.fromEntries(ETF.formatToParts(new Date(t)).map((x) => [x.type, +x.value || x.value]));
  const etDay = (t) => { const p = parts(t); return Date.UTC(p.year, p.month - 1, p.day) / DAY; };
  const clock = (t) => { const p = parts(t); return `${p.hour}:${String(p.minute).padStart(2, "0")}`; };
  const dayLabel = (t) => new Date(etDay(t) * DAY).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  function countdown(e, now = Date.now()) { // same rules as countdown() in src/calendar.js
    const dd = etDay(e.t) - etDay(now), at = e.timed ? ` ${clock(e.t)} ET` : "";
    if (dd === 0) {
      if (!e.timed) return "today";
      if (e.t <= now) return `out ${clock(e.t)} ET`;
      const m = Math.round((e.t - now) / 60e3);
      return m <= 90 ? `in ${m} min` : "today" + at;
    }
    if (dd === 1) return "tomorrow" + at;
    if (dd > 1) return `in ${dd} days`;
    return dd === -1 ? "yesterday" : `${-dd} days ago`;
  }
  const refStart = (ref) => {
    const q = /(\d)(?:st|nd|rd|th)\s+Quarter\s+(\d{4})/i.exec(ref || "");
    if (q) return Date.UTC(+q[2], (+q[1] - 1) * 3, 1);
    const m = /([A-Z][a-z]+)\s+(\d{4})/.exec(ref || "");
    const mi = m ? ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].slice(0, 3).toLowerCase()) : -1;
    return mi >= 0 ? Date.UTC(+m[2], mi, 1) : null;
  };

  // ---------- values ----------
  const fmtV = (r, v) => v == null ? "—" : `${v.toFixed(r.dec ?? 1)}${r.unit === "%" ? "%" : r.unit ? " " + r.unit : ""}`;
  /** For a released event: has the new reading landed in the scorecard data yet? */
  function landed(e, r) {
    if (!r) return false;
    if (e.key === "claims") return r.t >= e.t - 12 * DAY;
    const rs = refStart(e.ref);
    return rs != null ? r.t >= rs : r.t >= e.t - 45 * DAY;
  }
  function valueCell(e) {
    const rel = C.data?.releases?.[e.key];
    const r = rel?.ind?.length ? C.data.values?.[rel.ind[0]] : null;
    if (!r) return "";
    if (e.t <= Date.now()) {
      if (C.latest[e.key] !== e.id) return ""; // only the most recent release of each kind gets the new value
      if (!landed(e, r)) return `<span class="cv dim">awaiting data</span>`;
      const up = r.pv != null && r.v > r.pv, dn = r.pv != null && r.v < r.pv;
      return `<span class="cv"><b class="${up ? "up" : dn ? "dn" : ""}">${esc(fmtV(r, r.v))}</b> <span class="dim">vs ${esc(fmtV(r, r.pv))}</span></span>`;
    }
    return `<span class="cv dim">last ${esc(fmtV(r, r.v))}</span>`;
  }

  // ---------- list ----------
  function visible() {
    const ev = C.data?.events || [];
    return C.cat === "all" ? ev : ev.filter((e) => e.cat === C.cat);
  }
  function render() {
    const el = $("#calendar");
    if (!C.data) { el.innerHTML = `<div class="empty">Loading the calendar…</div>`; return; }
    const now = Date.now();
    C.list = visible();
    C.latest = {};
    for (const e of C.data.events) if (e.t <= now) C.latest[e.key] = e.id;
    const counts = Object.fromEntries(CATS.map(([k]) => [k, k === "all" ? C.data.events.length : C.data.events.filter((e) => e.cat === k).length]));
    let h = `<div class="calbar">${CATS.map(([k, n], i) => `<button type="button" data-cat="${k}" aria-pressed="${C.cat === k}" title="${n} (${i + 1})">${n}<em>${counts[k]}</em></button>`).join("")}
      <span class="calnote">${srcNote()}</span></div>`;
    if (!C.list.length) h += `<div class="empty">${C.cat === "earnings" ? "No earnings dates yet. Add stocks to your watchlist; dates come from the company panel." : "Nothing scheduled."}</div>`;
    let day = null, todayMarked = false;
    for (const e of C.list) {
      const d = etDay(e.t);
      if (!todayMarked && d >= etDay(now)) { todayMarked = true; if (d > etDay(now)) h += `<div class="subhead calday today">Today · nothing scheduled</div>`; }
      if (d !== day) { day = d; h += `<div class="subhead calday${d === etDay(now) ? " today" : d < etDay(now) ? " past" : ""}">${esc(dayLabel(e.t))}${d === etDay(now) ? " · Today" : ""}</div>`; }
      const tag = e.estimated ? `<span class="x">estimated</span>` : e.fallback ? `<span class="x" title="Schedule from WIRE's checked list (source unreachable)">fallback</span>` : "";
      h += `<button type="button" class="row calrow c-${e.cat}${e.t <= now ? " done" : ""}" data-id="${esc(e.id)}" aria-selected="${e.id === C.sel}">
        <span class="n">${e.timed ? esc(clock(e.t)) : ""}</span>
        <span class="h"><span class="ccat">${e.cat === "fed" ? "FED" : e.cat === "earnings" ? "EARN" : "MACRO"}</span>${esc(e.title)} <span class="cref">${esc(e.ref || "")}</span>${tag}</span>
        <span class="cval">${valueCell(e)}</span>
        <span class="t cdown">${esc(countdown(e, now))}</span>
      </button>`;
    }
    el.innerHTML = h;
    if (!C.sel || !C.list.some((e) => e.id === C.sel)) {
      const next = C.list.find((e) => e.t > now) || C.list[C.list.length - 1];
      C.sel = next?.id || null;
      if (C.sel) { el.querySelector(`.calrow[data-id="${CSS.escape(C.sel)}"]`)?.setAttribute("aria-selected", "true"); scrollToSel(); }
    }
    renderDetail();
  }
  function srcNote() {
    const st = C.data.status || {};
    const fb = Object.entries(st).filter(([, s]) => !s.live).map(([k]) => ({ fomc: "Fed", bea: "BEA", retail: "Census", cpi: "CPI", ppi: "PPI", jobs: "jobs", jolts: "JOLTS" }[k] || k));
    return fb.length ? `fallback list (checked ${esc(C.data.fallbackChecked)}): ${esc(fb.join(", "))}` : "all schedules live";
  }
  function scrollToSel() { $("#calendar").querySelector(`.calrow[aria-selected="true"]`)?.scrollIntoView({ block: "center" }); }
  function select(id) {
    C.sel = id;
    document.querySelectorAll("#calendar .calrow").forEach((r) => r.setAttribute("aria-selected", String(r.dataset.id === id)));
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    renderDetail();
  }
  function move(d) {
    const i = C.list.findIndex((e) => e.id === C.sel);
    const n = C.list[Math.max(0, Math.min(C.list.length - 1, i + d))];
    if (n) { select(n.id); scrollToSel(); }
  }
  function setCat(k) { C.cat = k; C.sel = null; try { localStorage.setItem("wire.cal.cat", k); } catch {} render(); }

  // ---------- detail ----------
  let hlToken = 0;
  function renderDetail() {
    if (!C.active || window.WireInstrument?.isOpen()) return;
    const el = $("#cdetail");
    const e = C.data?.events.find((x) => x.id === C.sel);
    if (!e) { el.innerHTML = `<div class="empty">Pick an event.</div>`; return; }
    const rel = C.data.releases[e.key] || {};
    const when = e.timed ? `${dayLabel(e.t)} · ${clock(e.t)} ET` : dayLabel(e.t);
    let kv = `<dt>WHEN</dt><dd>${esc(when)}</dd><dt>COUNTDOWN</dt><dd>${esc(countdown(e))}</dd>`;
    if (e.ref) kv += `<dt>${e.cat === "earnings" ? "COMPANY" : e.cat === "fed" ? "MEETING" : "PERIOD"}</dt><dd>${esc(e.ref)}</dd>`;
    kv += `<dt>SOURCE</dt><dd>${esc(e.src || rel.agency || "")}${e.estimated ? " · estimated date" : ""}${e.fallback ? ` · WIRE fallback list, checked ${esc(C.data.fallbackChecked)}` : ""}</dd>`;
    let vals = "";
    for (const id of rel.ind || []) {
      const r = C.data.values?.[id];
      if (!r) continue;
      const fresh = e.t <= Date.now() && C.latest[e.key] === e.id && landed(e, r);
      vals += `<dt>${esc(r.name.toUpperCase())}</dt><dd><b>${esc(fmtV(r, r.v))}</b> <span class="dim">vs ${esc(fmtV(r, r.pv))} previous · ${esc(new Date(r.t).toLocaleDateString("en-US", { month: "short", year: "numeric", day: e.key === "claims" ? "numeric" : undefined, timeZone: "UTC" }))}${fresh ? " · new" : ""}</span></dd>`;
    }
    const words = e.cat === "earnings" ? [e.sym, ...(e.ref && e.ref !== e.sym ? [e.ref.replace(/,? (Inc|Corp|Corporation|Co|Ltd|plc|Holdings)\.?$/i, "")] : [])] : rel.words;
    el.innerHTML = `
      <div class="dhead"><span class="code">${e.cat === "fed" ? "FED" : e.cat === "earnings" ? "EARNINGS" : esc(rel.agency || "MACRO")}</span><span class="nm">${esc(rel.long || e.ref || "")}</span><span class="dt">${esc(countdown(e))}</span></div>
      <h1>${esc(e.title)}</h1>
      <dl class="kv">${kv}</dl>
      ${vals ? `<div class="isec">${e.t <= Date.now() ? "LATEST READING VS PREVIOUS" : "LAST READING VS PREVIOUS"}</div><dl class="kv calvals">${vals}</dl>` : ""}
      ${e.sym ? `<p><button type="button" class="calopen" data-sym="${esc(e.sym)}">Open ${esc(e.sym)} chart</button></p>` : ""}
      <div class="isec">RELATED WIRE HEADLINES</div><div class="calhl"><p class="none">Searching…</p></div>`;
    const tok = ++hlToken;
    api.page.invoke("calendar:headlines", words || []).then((hs) => {
      if (tok !== hlToken) return;
      const box = el.querySelector(".calhl");
      if (!box) return;
      box.innerHTML = hs.length ? hs.map((s) => `<button type="button" class="calstory" data-sid="${esc(s.id)}" data-url="${esc(s.url || "")}"><span class="h">${esc(s.title)}</span><span class="dim">${esc(s.publisher || "")}${s.ts ? " · " + esc(new Date(s.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) : ""}</span></button>`).join("")
        : `<p class="none">No matching headlines in WIRE's current news.</p>`;
    });
  }

  // ---------- events ----------
  $("#calendar").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-cat]"); if (b) return setCat(b.dataset.cat);
    const r = ev.target.closest(".calrow"); if (r) select(r.dataset.id);
  });
  $("#cdetail").addEventListener("click", (ev) => {
    const o = ev.target.closest(".calopen"); if (o) return window.WireApp.openInstrument(o.dataset.sym);
    const s = ev.target.closest(".calstory");
    if (s && !window.WireInstrument.onStory?.(s.dataset.sid) && s.dataset.url) api.open?.(s.dataset.url);
  });
  function apply(d) { if (!d) return; C.data = d; if (C.active) render(); }
  if (api?.page) {
    api.page.on("calendar:update", apply);
    api.page.invoke("calendar:get").then(apply);
  }
  setInterval(() => { if (C.active && !window.WireInstrument?.isOpen()) { const y = $("#calendar").scrollTop; render(); $("#calendar").scrollTop = y; } }, 60e3);

  (window.WirePages ||= {}).calendar = {
    show() { C.active = true; render(); if (api?.page) api.page.invoke("calendar:get").then(apply); },
    hide() { C.active = false; },
    key(e) {
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
      else if (/^[1-4]$/.test(e.key) && !e.metaKey) setCat(CATS[+e.key - 1][0]);
      else if (e.key === "t") { C.sel = null; render(); }
      else if (e.key === "r") api.page.invoke("calendar:refresh").then(apply);
      else if (e.key === "Enter" || e.key === "o") { const x = C.data?.events.find((v) => v.id === C.sel); if (x?.sym) window.WireApp.openInstrument(x.sym); }
    },
    restore() { renderDetail(); },
    detail: () => $("#cdetail")
  };
})();
