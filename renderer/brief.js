/* Tickerkite Brief page. Registers with app.js through window.WirePages (see the "pages" section there).
   One screen to start the day: overnight markets, the biggest stories since you last looked, your portfolio,
   the Scorecards outlooks and what changed, and today's releases (with their market reaction once measured).
   It opens by itself the first time you look at Tickerkite each day, or after 4+ hours away. src/brief.js assembles it. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const B = { active: false, data: null, since: 0, monitors: null };
  const AWAY_MS = 4 * 3600e3;

  // ---------- when to open by itself ----------
  // "last seen" is the last minute Tickerkite was the focused window; the brief covers everything after it
  const get = (k) => { try { return +localStorage.getItem(k) || 0; } catch { return 0; } };
  const set = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
  const seen = () => { if (document.hasFocus()) set("wire.lastSeen", Date.now()); };
  setInterval(seen, 60e3);
  window.addEventListener("blur", () => set("wire.lastSeen", Date.now()));
  B.since = get("wire.brief.since") || get("wire.lastSeen");
  function maybeOpen() {
    const last = get("wire.lastSeen"), now = Date.now();
    const newDay = last && new Date(last).toDateString() !== new Date(now).toDateString();
    if (!last || newDay || now - last > AWAY_MS) {
      B.since = last || now - 12 * 3600e3;
      set("wire.brief.since", B.since);
      if (api?.page && window.WireApp) window.WireApp.setPage("brief");
    }
    set("wire.lastSeen", now);
  }
  window.addEventListener("focus", maybeOpen);
  setTimeout(maybeOpen, 0); // after app.js has set up pages

  // ---------- formatting ----------
  const ETF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const et = (t) => ETF.format(new Date(t)).replace(" AM", "a").replace(" PM", "p");
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const pct = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%");
  const usd = (v) => (v == null ? "—" : (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 }));
  const sgnUsd = (v) => (v == null ? "—" : (v > 0 ? "+" : "") + usd(v));
  const move = (m) => (m.unit === "bp" ? `${m.v > 0 ? "+" : m.v < 0 ? "−" : ""}${Math.abs(m.v).toFixed(0)}bp` : pct(m.v));
  const grade = (s) => (s == null ? "" : s >= 60 ? "g-up" : s >= 40 ? "g-mid" : "g-dn");
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  function greeting(now = new Date()) { const h = now.getHours(); return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
  function sinceText(t) {
    if (!t) return "";
    const d = new Date(t), now = new Date();
    const when = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const day = d.toDateString() === now.toDateString() ? "" : new Date(now - 864e5).toDateString() === d.toDateString() ? " yesterday" : " on " + d.toLocaleDateString("en-US", { weekday: "long" });
    return `Since you last looked at ${when}${day}`;
  }
  function quote(q) {
    const y = q.type === "yld";
    const px = y ? q.last.toFixed(2) + "%" : q.last >= 1000 ? q.last.toLocaleString("en-US", { maximumFractionDigits: 0 }) : q.last.toFixed(2);
    const ch = y ? `${q.chg >= 0 ? "+" : "−"}${Math.abs(q.chg * 100).toFixed(0)}bp` : pct(q.pct);
    return `<button type="button" class="bf-q" data-sym="${esc(q.sym)}" title="Open ${esc(q.label)} chart"><span>${esc(q.label)}</span><b>${px}</b><em class="${cls(y ? q.chg : q.pct)}">${ch}</em></button>`;
  }

  // ---------- main column ----------
  // ---------- risk monitors (src/monitors.js): probability of major events, with warnings ----------
  function monitorsPanel() {
    const m = B.monitors;
    if (!m) return "";
    if (!m.list?.length) return `<section class="bf-card bf-risk"><h3>Risk monitors</h3><p class="dim">${m.errors && Object.keys(m.errors).length ? "Couldn't load the data for the monitors. They'll retry on the next refresh." : "Working out the monitors (takes a few seconds the first time)…"}</p></section>`;
    const pc = (p) => `${Math.round(p * 100)}%`;
    const chg = (d) => (d == null || Math.abs(d) < 0.005 ? `<em class="flat">±0</em>` : `<em class="${d > 0 ? "rise" : "fall"}">${d > 0 ? "▲" : "▼"}${Math.abs(Math.round(d * 100))}</em>`);
    const spark = (v) => { if (!v?.length) return ""; const W = 120, H = 26, x = (i) => (i / (v.length - 1)) * W, y = (p) => H - 2 - p * (H - 4); return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${v.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`; };
    const order = { WARNING: 0, WATCH: 1, NORMAL: 2 };
    const cards = [...m.list].sort((a, b) => order[a.status] - order[b.status] || b.p / b.base - a.p / a.base).map((x) => `
      <button type="button" class="bf-mon ${x.status.toLowerCase()}" data-mon="${esc(x.id)}" title="${esc(x.name)}. ${esc(x.why)} Click for the full model.">
        <span class="bf-mh"><b>${esc(x.short)}</b><i>${x.status}</i></span>
        <span class="bf-mp"><b>${pc(x.p)}</b><span>usual ${pc(x.base)}</span></span>
        <span class="bf-md">1 mo ${chg(x.d1m)} · 3 mo ${chg(x.d3m)}</span>
        <span class="bf-ms">${spark(x.spark)}</span>
        <span class="bf-mw" title="${esc(x.drivers.filter((d) => d.up).map((d) => `${d.name}${d.level ? ` (${d.level})` : ""}`).join(", "))}">${x.drivers.some((d) => d.up) ? `Raising the odds: ${x.drivers.filter((d) => d.up).slice(0, 2).map((d) => `${esc(d.name.replace(/\s*\(.*\)$/, "").toLowerCase())}${d.level ? ` (${d.level})` : ""}`).join(" · ")}` : "Nothing raising the odds"}</span>
        <span class="bf-mq">${esc(x.quality.grade)} model · AUC ${x.quality.auc.toFixed(2)}</span>
      </button>`).join("");
    const warn = m.list.filter((x) => x.status === "WARNING").length, watch = m.list.filter((x) => x.status === "WATCH").length;
    const head = warn ? `${warn} warning${warn > 1 ? "s" : ""}${watch ? `, ${watch} to watch` : ""}` : watch ? `${watch} to watch` : "All normal";
    return `<section class="bf-card bf-risk"><h3>Risk monitors · <span class="${warn ? "w" : watch ? "o" : "n"}">${head}</span> <button type="button" class="bf-link" data-page="factor">Factor page ›</button></h3>
      <div class="bf-mons">${cards}</div>
      <p class="bf-foot">Chance each event starts within its window, from macro factors chosen by cross-validation. WARNING: 30%+ and at least twice the usual rate. WATCH: 1.5× usual, or up 8+ points in a month. History, not a guarantee. As of ${esc(m.list[0].period)}.</p></section>`;
  }

  function render() {
    if (!B.active) return;
    const el = $("#brief"), d = B.data;
    if (!d) { el.innerHTML = window.WireUI.skeleton("rows", { n: 8, label: "Putting your brief together…" }); return; }
    const date = new Date(d.now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const hero = `<header class="bf-hero"><div><h2>${greeting()}</h2><p>${esc(date)}${d.since ? " · " + esc(sinceText(d.since)) : ""}</p></div>
      <button type="button" class="bf-btn" data-reload title="Rebuild the brief">↻ Refresh</button></header>`;
    const mk = d.markets.length ? `<section class="bf-mk">${d.markets.map(quote).join("")}</section>` : "";

    const stories = d.stories.length ? d.stories.map((s, i) => `<button type="button" class="bf-story" data-sid="${esc(s.id)}">
        <span class="bf-i">${i + 1}</span>
        <span class="bf-st"><span class="h">${s.sev === "h" ? '<span class="badge hi">HI</span>' : ""}${s.watch?.length ? `<span class="badge wl">★ ${esc(s.watch.join(" "))}</span>` : ""}${esc(s.title)}</span>
        ${s.why ? `<span class="bf-why">${esc(s.why)}</span>` : ""}
        <span class="dim">${esc(s.code)} · ${ago(s.updated)}${s.sources > 1 ? ` · ${s.sources} outlets` : ""}</span></span></button>`).join("")
      : `<p class="none">Nothing big since you last looked.</p>`;

    const p = d.portfolio;
    const pf = p ? `<section class="bf-card bf-pf"><h3>Your portfolio <button type="button" class="bf-link" data-page="portfolio">Open ›</button></h3>
        <div class="bf-pfn"><div><span>Value</span><b>${usd(p.total.value)}</b></div><div><span>Today</span><b class="${cls(p.total.dayPnl)}">${sgnUsd(p.total.dayPnl)}</b><em class="${cls(p.total.dayPnl)}">${pct(p.total.dayPct)}</em></div>
        <div><span>Outlook</span><b class="${grade(p.outlook)}">${p.outlook ?? "—"}</b><em class="dim">/100</em></div></div>
        ${p.movers.length ? `<div class="bf-movers">${p.movers.map((m) => `<span><b>${esc(m.sym)}</b> <em class="${cls(m.pct)}">${pct(m.pct)}</em> <i class="${cls(m.dayPnl)}">${sgnUsd(m.dayPnl)}</i></span>`).join("")}</div>` : ""}
        ${p.news.length ? `<div class="bf-sub">In the news</div>${p.news.map((s) => `<button type="button" class="bf-mini" data-sid="${esc(s.id)}"><b>${esc(s.syms.join(" "))}</b> ${esc(s.title)}</button>`).join("")}` : ""}</section>`
      : `<section class="bf-card bf-pf bf-empty"><h3>Your portfolio</h3><p>Add what you own to see your day's gain or loss and an outlook for your mix here.</p>
        <button type="button" class="bf-btn" data-page="portfolio">Add holdings</button></section>`;

    const o = d.outlook;
    const ol = o ? `<section class="bf-card"><h3>Outlook, next 6–12 months <button type="button" class="bf-link" data-page="score">Scorecards ›</button></h3>
        ${o.rows.map((r) => `<div class="bf-ol"><span>${esc(r.name)}</span><span class="bf-olbar"><i class="${grade(r.score)}" style="width:${r.score}%"></i></span><b class="${grade(r.score)}">${r.score}</b><em class="${cls(r.w1)}">${r.w1 ? (r.w1 > 0 ? "▲" : "▼") + Math.abs(r.w1) : "–"}</em></div>`).join("")}
        ${o.regime ? `<p class="bf-reg"><b>${esc(o.regime.name)}.</b> ${esc(o.regime.text)}</p>` : ""}
        <p class="bf-foot">▲▼ change in the last week</p></section>` : "";

    el.innerHTML = `<div class="bf">${hero}${monitorsPanel()}${mk}
      <section class="bf-card"><h3>Top stories ${d.since ? "since you last looked" : "today"} <button type="button" class="bf-link" data-page="news">All news ›</button></h3>${stories}</section>
      <div class="bf-cols">${pf}${ol}</div></div>`;
  }

  // ---------- right pane: today ----------
  function renderDetail() {
    if (!B.active || window.WireInstrument?.isOpen()) return;
    const el = $("#bdetail"), d = B.data;
    if (!d) { el.innerHTML = window.WireUI.skeleton("detail"); return; }
    const now = Date.now();
    const ev = d.today.map((e) => {
      const out = e.actual || (e.t <= now && e.cat !== "earnings");
      const nums = e.actual ? `<span class="bf-num"><b class="${e.survey ? "" : ""}">${esc(e.actual)}</b>${e.survey ? ` <span class="dim">vs ${esc(e.survey)} exp.</span>` : ""}</span>`
        : e.survey ? `<span class="bf-num dim">exp. ${esc(e.survey)}${e.prior ? ` · prior ${esc(e.prior)}` : ""}</span>` : "";
      const rx = e.reaction?.length ? `<span class="bf-rx">${e.reaction.map((m) => `<i class="${cls(m.v)}">${esc(m.label)} ${move(m)}</i>`).join("")}</span>` : "";
      return `<div class="bf-ev${out ? " out" : ""}${e.cat === "earnings" ? " earn" : ""}"><span class="bf-t">${e.timed ? et(e.t) : "—"}</span>
        <span class="bf-e"><span class="bf-et">${e.flag || ""} ${esc(e.title)}</span>${nums}${rx}</span></div>`;
    }).join("");
    const rel = d.released.filter((r) => !d.today.some((e) => `${e.code}:${e.t}` === r.id));
    const relHtml = rel.map((r) => `<div class="bf-ev out"><span class="bf-t">${et(r.t)}</span><span class="bf-e"><span class="bf-et">${r.flag || ""} ${esc(r.items.map((i) => i.name).join(", "))}</span>
      <span class="bf-num">${r.items.slice(0, 2).map((i) => `<b>${esc(i.actual)}</b>${i.survey ? ` <span class="dim">vs ${esc(i.survey)}</span>` : ""}`).join(" · ")}</span>
      ${r.reaction?.length ? `<span class="bf-rx">${r.reaction.map((m) => `<i class="${cls(m.v)}">${esc(m.label)} ${move(m)}</i>`).join("")}</span>` : r.status === "pending" ? `<span class="bf-rx dim">measuring the reaction…</span>` : ""}</span></div>`).join("");
    const earn = d.earnings.map((e) => `<button type="button" class="bf-earn" data-sym="${esc(e.sym)}"><b>${esc(e.sym)}</b><span>${new Date(e.t + 12 * 3600e3).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</span></button>`).join("");
    el.innerHTML = `<h1>Today</h1>
      <p class="bf-sub2">Times are US Eastern. Big releases send an alert when they're out, then a second one with the market's move in the first 5 minutes.</p>
      ${ev ? `<div class="bf-evs">${ev}</div>` : `<p class="none">No major releases or Fed events today.</p>`}
      ${relHtml ? `<div class="isec">ALSO RELEASED IN THE LAST 24 HOURS</div><div class="bf-evs">${relHtml}</div>` : ""}
      ${earn ? `<div class="isec">EARNINGS THIS WEEK (YOUR STOCKS)</div><div class="bf-earns">${earn}</div>` : ""}
      <p class="bf-foot"><button type="button" class="bf-link" data-page="calendar">Full calendar ›</button></p>`;
  }

  function load() {
    if (!api?.page) return;
    api.page.invoke("brief:get", B.since).then((d) => { B.data = d; render(); renderDetail(); });
  }
  const onClick = (e) => {
    const s = e.target.closest("[data-sid]");
    if (s) { api.showStory(s.dataset.sid); return; }
    // buttons only: #app itself carries data-page (the page being shown), so a bare [data-page] matched every click
    const pg = e.target.closest("button[data-page]"); if (pg) return window.WireApp.setPage(pg.dataset.page);
    if (e.target.closest("[data-reload]")) return load();
    const mon = e.target.closest("[data-mon]"); if (mon) return window.WireFactor?.open(mon.dataset.mon);
    const q = e.target.closest("[data-sym]"); if (q) window.WireApp.openInstrument(q.dataset.sym);
  };
  $("#brief").addEventListener("click", onClick);
  $("#bdetail").addEventListener("click", onClick);
  if (api?.page) {
    // keep an open brief current without moving things under the reader: reactions and releases arrive live
    api.page.on("releases:update", () => { if (B.active) load(); });
    api.page.on("monitors:update", (m) => { B.monitors = m; if (B.active && B.data) render(); });
    api.page.invoke("monitors:get").then((m) => { B.monitors = m; if (B.active && B.data) render(); }).catch(() => {});
    setInterval(() => { if (B.active && !document.hidden) load(); }, 5 * 60e3);
  }

  (window.WirePages ||= {}).brief = {
    show() { B.active = true; render(); renderDetail(); load(); },
    hide() { B.active = false; },
    key(e) { if (e.key === "r") load(); },
    restore() { renderDetail(); },
    detail: () => $("#bdetail")
  };
})();
