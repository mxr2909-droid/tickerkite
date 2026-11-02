/* Tickerkite Economic calendar page. Registers with app.js through window.WirePages (see the "pages" section there).
   One week at a time: official US releases, Fed meetings and watchlist earnings, plus global events from
   Nasdaq's calendar, with survey (consensus), actual, prior and revised. After a release the surprise
   (actual − survey) is colored; the right pane charts actual vs survey for past releases. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAY = 864e5;
  const REGIONS = [["g10", "G10"], ["am", "Americas"], ["eu", "Europe/MEA"], ["as", "Asia/Pacific"], ["world", "World"]];
  const CATS = [["all", "All"], ["macro", "Macro"], ["fed", "Fed"], ["earnings", "Earnings"]];
  // earnings sub-tabs: world's top 100 by market cap, largest US companies by revenue (Fortune-style), your own list
  const ELISTS = [["g100", "Global 100", "The world's 100 largest companies by market cap"],
    ["f100", "Fortune 100", "The 100 largest US companies by revenue, ranked from SEC filings (close to Fortune's list, which isn't free to download)"],
    ["f500", "Fortune 500", "The 500 largest US companies by revenue, ranked from SEC filings (close to Fortune's list, which isn't free to download)"],
    ["mine", "My list", "Companies you add: search below"]];
  const C = { active: false, data: null, region: "world", cat: "all", elist: "g100", q: "", mq: "", mres: [], sel: null, list: [], latest: {}, week: null, hist: {} };
  try { C.region = localStorage.getItem("wire.cal.region") || "world"; C.cat = localStorage.getItem("wire.cal.cat") || "all"; C.elist = localStorage.getItem("wire.cal.elist") || "g100"; } catch {}

  // ---------- time (US Eastern) ----------
  const ETF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (t) => Object.fromEntries(ETF.formatToParts(new Date(t)).map((x) => [x.type, +x.value || x.value]));
  const etDay = (t) => { const p = parts(t); return Date.UTC(p.year, p.month - 1, p.day) / DAY; };
  const clock = (t) => { const p = parts(t); return `${p.hour}:${String(p.minute).padStart(2, "0")}`; };
  const dayLabel = (t) => new Date(etDay(t) * DAY).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const shortDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
  const isoDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
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

  // ---------- numbers (same rules as parseNum/surprise in src/calendar-nasdaq.js) ----------
  function num(s) {
    const m = /^([+-]?)\s*([\d,]*\.?\d+)\s*(%|[KMBT])?$/i.exec(String(s || "").trim());
    if (!m) return null;
    const d = m[2].replace(/,/g, "");
    return { v: +(m[1] + d), unit: (m[3] || "").toUpperCase(), dec: (d.split(".")[1] || "").length };
  }
  function surp(a, b) {
    a = num(a); b = num(b);
    if (!a || !b || a.unit !== b.unit) return null;
    const dec = Math.max(a.dec, b.dec);
    return { v: +(a.v - b.v).toFixed(dec), unit: a.unit, dec };
  }
  const fmtN = (x, sign) => x ? (x.v < 0 ? "-" : sign && x.v > 0 ? "+" : "") + Math.abs(x.v).toLocaleString("en-US", { minimumFractionDigits: x.dec, maximumFractionDigits: x.dec }) + x.unit : "";
  const cls = (x) => !x ? "" : x.v > 0 ? "up" : x.v < 0 ? "dn" : "on";

  // scorecard readings: fallback for official releases Nasdaq has no row for
  const fmtV = (r, v) => v == null ? "—" : `${v.toFixed(r.dec ?? 1)}${r.unit === "%" ? "%" : r.unit ? " " + r.unit : ""}`;
  function landed(e, r) {
    if (!r) return false;
    if (e.key === "claims") return r.t >= e.t - 12 * DAY;
    const rs = refStart(e.ref);
    return rs != null ? r.t >= rs : r.t >= e.t - 45 * DAY;
  }
  function scoreVals(e) {
    const rel = C.data?.releases?.[e.key];
    const r = rel?.ind?.length ? C.data.values?.[rel.ind[0]] : null;
    if (!r || e.nq) return null;
    if (e.t <= Date.now()) {
      if (C.latest[e.key] !== e.id) return null;
      if (!landed(e, r)) return { actual: "awaiting", prior: fmtV(r, r.v) };
      return { actual: fmtV(r, r.v), prior: fmtV(r, r.pv) };
    }
    return { prior: fmtV(r, r.v) };
  }

  // ---------- list ----------
  function visible() {
    const q = C.q.trim().toLowerCase();
    return (C.data?.events || []).filter((e) => {
      if (C.cat !== "all" && e.cat !== C.cat) return false;
      if (e.cat === "earnings" && !inList(e)) return false;
      if (C.region === "g10" ? !e.g10 : C.region !== "world" && e.region !== C.region) return false;
      return !q || `${e.title} ${e.ref || ""} ${e.code} ${e.sym || ""}`.toLowerCase().includes(q);
    });
  }
  // the Earnings tab shows the chosen list; All shows the global 100 plus your own companies
  function inList(e) {
    if (C.cat !== "earnings") return !!(e.rank || e.mine);
    return C.elist === "f100" ? e.frank > 0 && e.frank <= 100 : C.elist === "f500" ? e.frank > 0 : C.elist === "mine" ? e.mine : !!e.rank;
  }
  function earnBar() {
    if (C.cat !== "earnings") return "";
    const f = C.data.fortune || {};
    const note = C.elist.startsWith("f") ? (f.n ? `Ranked by ${esc(f.year || "")} revenue from SEC filings · ${f.n} companies` : "This list comes from the Screener's data, which builds a few minutes after first launch.")
      : C.elist === "g100" ? "The world's 100 largest by market cap" : "";
    let h = `<div class="calsub"><span class="cgrp">${ELISTS.map(([k, n, t]) => `<button type="button" data-elist="${k}" aria-pressed="${C.elist === k}" title="${esc(t)}">${n}</button>`).join("")}</span><span class="calnote">${note}</span></div>`;
    if (C.elist === "mine") h += minePanel();
    return h;
  }
  const nextLabel = (n) => !n ? "no date yet" : `${shortDate(n.date)}${n.estimated ? " (est.)" : ""}`;
  function minePanel() {
    const mine = (C.data.mine || []).slice().sort((a, b) => (a.next?.date || "9") < (b.next?.date || "9") ? -1 : 1);
    return `<div class="calmine">
      <div class="calmsearch"><input id="calmq" type="search" placeholder="Add a company: name or ticker" value="${esc(C.mq)}" spellcheck="false" autocomplete="off"><div id="calmres">${mresHtml()}</div></div>
      <div class="calmlist">${mine.length ? mine.map((m) => `<span class="calchip" title="${esc(m.name)}${m.next ? ` · next report ${esc(nextLabel(m.next))} (${esc(m.next.source)})` : ""}"><button type="button" class="cm-open" data-msym="${esc(m.sym)}"><b>${esc(m.sym)}</b><span>${esc(nextLabel(m.next))}</span></button><button type="button" class="cm-x" data-mrm="${esc(m.sym)}" aria-label="Remove ${esc(m.sym)}">×</button></span>`).join("")
        : `<span class="dim">No companies yet. Search above to add one; its earnings then show up here and in All.</span>`}</div></div>`;
  }
  const mresHtml = () => C.mres.length && C.mq.trim() ? C.mres.map((r, i) => `<button type="button" class="calmres-i${i === 0 ? " first" : ""}" data-madd="${esc(r.sym)}" data-mname="${esc(r.name)}"><b>${esc(r.sym)}</b><span>${esc(r.name)}</span><em>${esc(r.exch)}</em></button>`).join("") : "";
  let mqTimer = null;
  function searchMine(q) {
    clearTimeout(mqTimer);
    if (!q.trim()) { C.mres = []; const b = $("#calmres"); if (b) b.innerHTML = ""; return; }
    mqTimer = setTimeout(() => api.page.invoke("calendar:search", q).then((r) => { if (q !== C.mq) return; C.mres = r || []; const b = $("#calmres"); if (b) b.innerHTML = mresHtml(); }), 220);
  }
  function addMine(sym, name) {
    C.mq = ""; C.mres = [];
    api.page.invoke("calendar:mine-add", { sym, name }).then((d) => { apply(d); setTimeout(() => $("#calmq")?.focus(), 0); });
  }
  const dots = (n) => `<span class="crel r${n}" title="${["", "Low", "Medium", "High"][n] || ""} importance">${"●".repeat(n)}${"○".repeat(3 - n)}</span>`;
  function row(e, now) {
    const fb = scoreVals(e) || {};
    const s = surp(e.actual, e.survey);
    const tag = e.estimated ? `<span class="x">estimated</span>` : e.fallback ? `<span class="x" title="Schedule from Tickerkite's checked list (source unreachable)">fallback</span>` : "";
    const actual = e.actual ? `<b class="${cls(s)}">${esc(e.actual)}</b>` : fb.actual ? `<span class="dim">${esc(fb.actual)}</span>` : "";
    return `<button type="button" class="row calrow c-${e.cat}${e.t <= now ? " done" : ""}" data-id="${esc(e.id)}" aria-selected="${e.id === C.sel}" title="${esc(countdown(e, now))}">
      <span class="n">${e.timed ? esc(clock(e.t)) : ""}</span>
      <span class="cc"><span class="fl">${e.flag || ""}</span>${esc(e.code || "")}</span>
      ${dots(e.rel || 1)}
      <span class="h">${e.cat === "fed" ? `<span class="ccat">FED</span>` : e.cat === "earnings" ? `<span class="ccat">EARN</span>` : ""}${esc(e.title)}${tag}</span>
      <span class="cp">${esc(e.cat === "earnings" ? (e.when === "before open" ? "pre-mkt" : e.when === "after close" ? "post-mkt" : "") : e.ref ? e.ref.replace(/ Quarter /, "Q ").replace(/^Week ending /, "wk ") : "")}</span>
      <span class="cv sv">${esc(e.survey || "")}</span>
      <span class="cv">${actual}</span>
      <span class="cv su ${cls(s)}">${s ? esc(fmtN(s, true)) : ""}</span>
      <span class="cv pr">${esc(e.prior || fb.prior || "")}</span>
      <span class="cv rv">${esc(e.revised || "")}</span>
    </button>`;
  }
  function render() {
    const el = $("#calendar");
    if (!C.data) { el.innerHTML = window.WireUI.skeleton("rows", { n: 12, label: "Loading the calendar…" }); return; }
    const now = Date.now();
    const focused = document.activeElement?.id === "calq", mfocused = document.activeElement?.id === "calmq";
    C.list = visible();
    C.latest = {};
    for (const e of C.data.events) if (e.t <= now && e.key !== "nq") C.latest[e.key] = e.id;
    const wk = Date.parse(C.data.week + "T12:00:00Z") / DAY, thisWk = C.data.week === C.data.thisWeek;
    const wkLabel = `${new Date(wk * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${new Date((wk + 6) * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
    let h = `<div class="calhead"><div class="calbar">
      <span class="cgrp">${REGIONS.map(([k, n], i) => `<button type="button" data-region="${k}" aria-pressed="${C.region === k}" title="${n} (${i + 1})">${n}</button>`).join("")}</span>
      <span class="cgrp">${CATS.map(([k, n]) => `<button type="button" data-cat="${k}" aria-pressed="${C.cat === k}">${n}</button>`).join("")}</span>
      <span class="cgrp cweek"><button type="button" data-week="-1" title="Previous week (←)">‹</button><button type="button" data-week="0" aria-pressed="${thisWk}" title="This week (t)">This week</button><button type="button" data-week="1" title="Next week (→)">›</button><span class="wk">${esc(wkLabel)}</span></span>
      <input id="calq" type="search" placeholder="Search events  /" value="${esc(C.q)}" spellcheck="false" autocomplete="off">
      <span class="calnote">${srcNote()}</span></div>
      ${earnBar()}
      <div class="calcols"><span>ET</span><span>CTRY</span><span>REL</span><span>EVENT</span><span>PERIOD</span><span class="r">SURVEY</span><span class="r">ACTUAL</span><span class="r">SURP</span><span class="r">PRIOR</span><span class="r">REVISED</span></div></div>`;
    if (!C.list.length) h += `<div class="empty">${C.q ? "No events match." : C.cat === "earnings" ? (C.data.nasdaq?.loading ? "Loading this week's earnings…" : C.elist === "mine" ? ((C.data.mine || []).length ? "None of your companies report this week. Their next dates are on the chips above." : "Add companies above to follow their earnings.") : `None of the ${{ g100: "world's 100 largest companies", f100: "Fortune 100", f500: "Fortune 500" }[C.elist]} report this week.`) : C.data.nasdaq?.loading ? "Loading this week…" : "Nothing scheduled this week."}</div>`;
    let day = null;
    for (const e of C.list) {
      const d = etDay(e.t);
      if (d !== day) { day = d; h += `<div class="subhead calday${d === etDay(now) ? " today" : d < etDay(now) ? " past" : ""}">${esc(dayLabel(e.t))}${d === etDay(now) ? " · Today" : ""}</div>`; }
      h += row(e, now);
    }
    el.innerHTML = h;
    if (focused) { const i = $("#calq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    if (mfocused) { const i = $("#calmq"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    if (!C.sel || !C.list.some((e) => e.id === C.sel)) {
      const next = C.list.find((e) => e.t > now) || C.list[C.list.length - 1];
      C.sel = next?.id || null;
      if (C.sel) { el.querySelector(`.calrow[data-id="${CSS.escape(C.sel)}"]`)?.setAttribute("aria-selected", "true"); if (!focused && !mfocused) scrollToSel(); }
    }
    renderDetail();
  }
  function srcNote() {
    const st = C.data.status || {}, nq = C.data.nasdaq || {};
    const fb = Object.entries(st).filter(([, s]) => !s.live).map(([k]) => ({ fomc: "Fed", bea: "BEA", retail: "Census", cpi: "CPI", ppi: "PPI", jobs: "jobs", jolts: "JOLTS" }[k] || k));
    const sched = fb.length ? `<span title="fallback list checked ${esc(C.data.fallbackChecked)}">fallback: ${esc(fb.join(", "))}</span>` : "schedules live";
    const cons = nq.loading ? "consensus loading…" : nq.error ? `<span class="dn" title="${esc(nq.error)}">consensus unavailable</span>` : nq.at ? "consensus: Nasdaq" : "";
    const top = C.data.top && !C.data.top.live ? `<span title="ranking snapshot checked ${esc(C.data.top.checked)}">top 100: snapshot</span>` : "";
    return [sched, cons, top].filter(Boolean).join(" · ");
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
  function setRegion(k) { C.region = k; C.sel = null; try { localStorage.setItem("wire.cal.region", k); } catch {} render(); }
  function setElist(k) { C.elist = k; C.sel = null; try { localStorage.setItem("wire.cal.elist", k); } catch {} render(); }
  function setCat(k) { C.cat = k; C.sel = null; try { localStorage.setItem("wire.cal.cat", k); } catch {} render(); }
  function setWeek(d) {
    const cur = Date.parse((C.data?.week || C.data?.thisWeek) + "T12:00:00Z") / DAY;
    C.week = d === 0 ? C.data?.thisWeek : isoDay(cur + 7 * d);
    C.sel = null;
    api.page.invoke("calendar:get", C.week).then(apply);
  }

  // ---------- detail ----------
  function chart(list) {
    const pts = list.map((e, i) => ({ i, a: num(e.actual), s: num(e.survey) })).filter((p) => p.a || p.s);
    if (pts.length < 2) return "";
    const vs = pts.flatMap((p) => [p.a?.v, p.s?.v]).filter((v) => v != null);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const W = 340, H = 130, L = 44, B = 18, n = list.length - 1 || 1;
    const x = (i) => L + (i / n) * (W - L - 6), y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * (H - B - 6);
    const line = (k) => { const p = pts.filter((q) => q[k]); return p.length > 1 ? p.map((q) => `${x(q.i).toFixed(1)},${y(q[k].v).toFixed(1)}`).join(" ") : ""; };
    const unit = (pts.find((p) => p.a) || pts[0]).a?.unit || pts[0].s?.unit || "", dec = Math.min(3, Math.max(...pts.map((p) => (p.a || p.s).dec)));
    const lab = (v) => v.toFixed(dec) + unit;
    const zero = lo < 0 && hi > 0 ? `<line x1="${L}" x2="${W - 6}" y1="${y(0)}" y2="${y(0)}" class="z"/>` : "";
    const dotsSvg = pts.filter((p) => p.a && p.s).map((p) => { const s = p.a.v - p.s.v; return `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.a.v).toFixed(1)}" r="2.4" class="${s > 0 ? "up" : s < 0 ? "dn" : "on"}"/>`; }).join("");
    return `<svg class="calchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Actual vs survey, last ${list.length} releases">
      <line x1="${L}" x2="${W - 6}" y1="6" y2="6" class="g"/><line x1="${L}" x2="${W - 6}" y1="${H - B}" y2="${H - B}" class="g"/>${zero}
      <text x="${L - 4}" y="10" text-anchor="end">${esc(lab(hi - pad))}</text><text x="${L - 4}" y="${H - B}" text-anchor="end">${esc(lab(lo + pad))}</text>
      <text x="${L}" y="${H - 4}">${esc(shortDate(list[0].date))}</text><text x="${W - 6}" y="${H - 4}" text-anchor="end">${esc(shortDate(list[list.length - 1].date))}</text>
      ${line("s") ? `<polyline points="${line("s")}" class="sv"/>` : ""}${line("a") ? `<polyline points="${line("a")}" class="ac"/>` : ""}${dotsSvg}
    </svg><div class="calleg"><span class="ac">— actual</span><span class="sv">- - survey</span><span class="dim">dot: above / below / on survey</span></div>`;
  }
  function summary(st) {
    if (!st) return `<p class="none">No releases with a survey on record yet. Tickerkite keeps each release as it prints and fills in the past in the background.</p>`;
    return `<p class="calsum">Last ${st.n} with a survey: <b class="up">${st.above} above</b>, <b class="dn">${st.below} below</b>, ${st.on} on it · typical miss ${esc(fmtN(st.miss))} · SD ${esc(fmtN(st.sd))}</p>`;
  }
  function histTable(list) {
    const per = list.some((e) => e.ref);
    const rows = [...list].reverse().map((e) => {
      const s = surp(e.actual, e.survey);
      return `<tr><td>${esc(shortDate(e.date))}</td>${per ? `<td class="dim pl">${esc(e.ref || "")}</td>` : ""}<td class="${cls(s)}">${esc(e.actual || "—")}</td><td>${esc(e.survey || "—")}</td><td class="dim">${esc(e.prior || "")}${e.revised ? ` <span title="revised to ${esc(e.revised)} at the next release">→ ${esc(e.revised)}</span>` : ""}</td><td class="${cls(s)}">${s ? esc(fmtN(s, true)) : ""}</td></tr>`;
    }).join("");
    return `<table class="calhist"><thead><tr><th>RELEASE</th>${per ? `<th class="pl">PERIOD</th>` : ""}<th>ACTUAL</th><th>SURVEY</th><th>PRIOR</th><th>SURPRISE</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  let hlToken = 0, hToken = 0;
  function renderDetail() {
    if (!C.active || window.WireInstrument?.isOpen()) return;
    const el = $("#cdetail");
    const e = C.data?.events.find((x) => x.id === C.sel);
    if (!e) { el.innerHTML = C.data ? window.WireUI.empty("No event selected", "Pick a release on the left to see the survey, prior and how markets reacted last time.") : window.WireUI.skeleton("detail"); return; }
    const rel = C.data.releases[e.key] || {};
    const when = e.timed ? `${dayLabel(e.t)} · ${clock(e.t)} ET` : dayLabel(e.t);
    let kv = `<dt>When</dt><dd>${esc(when)}</dd><dt>Countdown</dt><dd>${esc(countdown(e))}</dd>`;
    if (e.cat !== "earnings") kv += `<dt>Next</dt><dd class="calnext">${e.t > Date.now() ? esc(countdown(e)) : "…"}</dd>`;
    if (e.cat === "earnings") {
      kv += `<dt>Company</dt><dd>${esc(e.company || e.sym)} · ${esc(e.sym)}${e.rank ? ` · #${e.rank} by market cap` : ""}${e.frank ? ` · #${e.frank} US by revenue` : ""}${e.mine ? " · on your list" : ""}${e.cap ? ` ($${(e.cap / 1e9 >= 1000 ? (e.cap / 1e12).toFixed(2) + "T" : Math.round(e.cap / 1e9) + "B")})` : ""}</dd>`;
      kv += `<dt>Report</dt><dd>${esc(e.ref || "time not given")}</dd>`;
      if (e.survey || e.actual) kv += `<dt>EPS</dt><dd>consensus ${esc(e.survey || "—")}${e.ests ? ` (${e.ests} ests)` : ""}${e.actual ? ` · actual ${esc(e.actual)}` : ""}${e.prior ? ` · year ago ${esc(e.prior)}` : ""}</dd>`;
    } else if (e.ref) kv += `<dt>${e.cat === "earnings" ? "COMPANY" : e.cat === "fed" && e.key === "fomc" ? "MEETING" : "PERIOD"}</dt><dd>${esc(e.ref)}</dd>`;
    kv += `<dt>Country</dt><dd>${e.flag || ""} ${esc(e.code || "")} · ${["", "low", "medium", "high"][e.rel || 1]} importance</dd>`;
    kv += `<dt>Source</dt><dd>${esc(e.src || rel.agency || "")}${e.nq && e.key !== "nq" ? " · consensus from Nasdaq" : ""}${e.estimated ? " · estimated date" : ""}${e.fallback ? ` · Tickerkite fallback list, checked ${esc(C.data.fallbackChecked)}` : ""}</dd>`;
    const s = surp(e.actual, e.survey);
    const fig = e.survey || e.actual || e.prior ? `<div class="calfig">
      <div><span>SURVEY</span><b>${esc(e.survey || "—")}</b></div>
      <div><span>ACTUAL</span><b class="${cls(s)}">${esc(e.actual || "—")}</b></div>
      <div><span>SURPRISE</span><b class="${cls(s)}">${s ? esc(fmtN(s, true)) : "—"}</b></div>
      <div><span>PRIOR</span><b>${esc(e.prior || "—")}</b>${e.revised ? `<em>revised ${esc(e.revised)}</em>` : ""}</div></div>` : "";
    const rx = C.rx.get(`${e.code}:${e.t}`);
    const react = !rx ? "" : rx.status === "pending" ? `<div class="isec">MARKET REACTION, FIRST 5 MIN</div><p class="none">Measuring… markets data runs about 10 minutes behind, so this fills in around ${esc(clock(e.t + 16 * 60e3))} ET.</p>`
      : rx.reaction?.length ? `<div class="isec">MARKET REACTION, FIRST 5 MIN</div><div class="calrx">${rx.reaction.map((m) => `<div><span>${esc(m.label)}</span><b class="${m.v > 0 ? "up" : m.v < 0 ? "dn" : ""}">${m.unit === "bp" ? (m.v > 0 ? "+" : m.v < 0 ? "−" : "") + Math.abs(m.v).toFixed(0) + "bp" : (m.v > 0 ? "+" : m.v < 0 ? "−" : "") + Math.abs(m.v).toFixed(2) + "%"}</b></div>`).join("")}</div>` : "";
    let vals = "";
    for (const id of e.key === "nq" ? [] : rel.ind || []) {
      const r = C.data.values?.[id];
      if (!r) continue;
      const fresh = e.t <= Date.now() && C.latest[e.key] === e.id && landed(e, r);
      vals += `<dt>${esc(r.name.toUpperCase())}</dt><dd><b>${esc(fmtV(r, r.v))}</b> <span class="dim">vs ${esc(fmtV(r, r.pv))} previous · ${esc(new Date(r.t).toLocaleDateString("en-US", { month: "short", year: "numeric", day: e.key === "claims" ? "numeric" : undefined, timeZone: "UTC" }))}${fresh ? " · new" : ""}</span></dd>`;
    }
    const words = e.cat === "earnings" ? [e.sym, ...(e.company ? [e.company.replace(/\s*\(.*\)$/, "")] : []), ...(e.ref && e.ref !== e.sym && !e.company ? [e.ref.replace(/,? (Inc|Corp|Corporation|Co|Ltd|plc|Holdings)\.?$/i, "")] : [])]
      : rel.words || [e.title.replace(/\s*\(\d\)$/, "")];
    el.innerHTML = `
      <div class="dhead"><span class="code">${e.cat === "fed" ? "FED" : e.cat === "earnings" ? "EARNINGS" : esc(rel.agency || e.code || "MACRO")}</span><span class="nm">${esc(rel.long || e.country || "")}</span><span class="dt">${esc(countdown(e))}</span></div>
      <h1>${esc(e.title)}</h1>
      <dl class="kv">${kv}</dl>
      ${fig}
      ${react}
      ${e.hkey ? `<div class="isec">ACTUAL VS SURVEY</div><div class="calh"><p class="none">Loading history…</p></div>` : ""}
      ${e.desc ? `<p class="caldesc">${esc(e.desc)}</p>` : ""}
      ${vals ? `<div class="isec">${e.t <= Date.now() ? "LATEST READING VS PREVIOUS" : "LAST READING VS PREVIOUS"} (SCORECARD)</div><dl class="kv calvals">${vals}</dl>` : ""}
      ${e.sym ? `<p><button type="button" class="calopen" data-sym="${esc(e.sym)}">Open ${esc(e.sym)} chart</button></p>` : ""}
      <div class="isec">RELATED TICKERKITE HEADLINES</div><div class="calhl"><p class="none">Searching…</p></div>`;
    if (e.hkey) {
      const tok = ++hToken;
      api.page.invoke("calendar:history", e.hkey).then((hs) => {
        if (tok !== hToken) return;
        const box = el.querySelector(".calh");
        if (!box) return;
        const nx = el.querySelector(".calnext");
        if (nx) nx.textContent = hs.next ? `${countdown(hs.next)} · ${dayLabel(hs.next.t)}` : e.t > Date.now() ? countdown(e) : "not in the loaded schedule";
        const list = hs.list || [];
        box.innerHTML = list.length ? chart(list) + summary(hs.stats) + histTable(list) : summary(null);
      });
    }
    const tok = ++hlToken;
    api.page.invoke("calendar:headlines", words || []).then((hs) => {
      if (tok !== hlToken) return;
      const box = el.querySelector(".calhl");
      if (!box) return;
      box.innerHTML = hs.length ? hs.map((s) => `<button type="button" class="calstory" data-sid="${esc(s.id)}" data-url="${esc(s.url || "")}"><span class="h">${esc(s.title)}</span><span class="dim">${esc(s.publisher || "")}${s.ts ? " · " + esc(new Date(s.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) : ""}</span></button>`).join("")
        : `<p class="none">No matching headlines in Tickerkite's current news.</p>`;
    });
  }

  // ---------- events ----------
  $("#calendar").addEventListener("click", (ev) => {
    const g = ev.target.closest("[data-region]"); if (g) return setRegion(g.dataset.region);
    const b = ev.target.closest("[data-cat]"); if (b) return setCat(b.dataset.cat);
    const l = ev.target.closest("[data-elist]"); if (l) return setElist(l.dataset.elist);
    const ma = ev.target.closest("[data-madd]"); if (ma) return addMine(ma.dataset.madd, ma.dataset.mname);
    const mr = ev.target.closest("[data-mrm]"); if (mr) return api.page.invoke("calendar:mine-remove", mr.dataset.mrm).then(apply);
    const mo = ev.target.closest("[data-msym]"); if (mo) return window.WireApp.openInstrument(mo.dataset.msym);
    const w = ev.target.closest("[data-week]"); if (w) return setWeek(+w.dataset.week);
    const r = ev.target.closest(".calrow"); if (r) select(r.dataset.id);
  });
  $("#calendar").addEventListener("input", (ev) => {
    if (ev.target.id === "calq") { C.q = ev.target.value; C.sel = null; render(); }
    else if (ev.target.id === "calmq") { C.mq = ev.target.value; searchMine(C.mq); }
  });
  $("#cdetail").addEventListener("click", (ev) => {
    const o = ev.target.closest(".calopen"); if (o) return window.WireApp.openInstrument(o.dataset.sym);
    const s = ev.target.closest(".calstory");
    if (s && !window.WireInstrument.onStory?.(s.dataset.sid) && s.dataset.url) api.open?.(s.dataset.url);
  });
  function apply(d) {
    if (!d) return;
    if (C.week && d.week !== C.week) return; // a push for a week we've navigated away from
    C.data = d;
    window.WireChrome?.pulled("calendar", d.fetchedAt || Date.now());
    if (C.active) { const y = $("#calendar").scrollTop, keep = !!C.sel; render(); if (keep) $("#calendar").scrollTop = y; }
  }
  // release alerts (src/releases.js) keep the first-5-minute market reaction for each printed release
  C.rx = new Map();
  const applyRx = (list) => { C.rx = new Map((list || []).map((r) => [r.id, r])); if (C.active) renderDetail(); };
  if (api?.page) {
    api.page.on("releases:update", applyRx);
    api.page.invoke("releases:list").then(applyRx);
    api.page.on("calendar:update", apply);
    api.page.invoke("calendar:get").then(apply);
  }
  setInterval(() => { if (C.active && !window.WireInstrument?.isOpen() && !["calq", "calmq"].includes(document.activeElement?.id)) { const y = $("#calendar").scrollTop; render(); $("#calendar").scrollTop = y; } }, 60e3);

  (window.WirePages ||= {}).calendar = {
    show() { C.active = true; render(); if (api?.page) api.page.invoke("calendar:get", C.week || undefined).then(apply); },
    hide() { C.active = false; },
    key(e) {
      if (e.target.id === "calmq") {
        if (e.key === "Escape") { C.mq = ""; C.mres = []; e.target.value = ""; e.target.blur(); render(); }
        else if (e.key === "Enter") { e.preventDefault(); const r = C.mres[0]; if (r) addMine(r.sym, r.name); }
        return;
      }
      if (e.target.id === "calq") {
        if (e.key === "Escape") { C.q = ""; e.target.value = ""; e.target.blur(); render(); }
        else if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); e.target.blur(); }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setWeek(e.key === "ArrowLeft" ? -1 : 1); }
      else if (/^[1-5]$/.test(e.key) && !e.metaKey) setRegion(REGIONS[+e.key - 1][0]);
      else if (e.key === "/") { e.preventDefault(); $("#calq")?.focus(); }
      else if (e.key === "t") { if (C.data?.week !== C.data?.thisWeek) setWeek(0); else { C.sel = null; render(); } }
      else if (e.key === "r") api.page.invoke("calendar:refresh").then(apply);
      else if (e.key === "Escape" && C.q) { C.q = ""; render(); }
      else if (e.key === "Enter" || e.key === "o") { const x = C.data?.events.find((v) => v.id === C.sel); if (x?.sym) window.WireApp.openInstrument(x.sym); }
    },
    restore() { renderDetail(); },
    detail: () => $("#cdetail")
  };
})();
