/* WIRE Portfolio page. Registers with app.js through window.WirePages (see the "pages" section there).
   Your holdings with today's gain/loss, total gain against what you paid, the asset mix, and how the Scorecards
   outlooks add up for your mix. src/portfolio.js keeps the holdings (portfolio.json) and prices them. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const P = { active: false, data: null, sel: null, msg: "", busy: false };

  const usd = (v, d = 0) => (v == null ? "—" : (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sgnUsd = (v, d = 0) => (v == null ? "—" : (v > 0 ? "+" : "") + usd(v, d));
  const pct = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%");
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const price = (v) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: v < 1 ? 4 : 2, maximumFractionDigits: v < 1 ? 4 : 2 }));
  const grade = (s) => (s == null ? "" : s >= 60 ? "g-up" : s >= 40 ? "g-mid" : "g-dn");
  const word = (s) => (s == null ? "" : s >= 70 ? "Bullish" : s >= 55 ? "Leaning bullish" : s >= 45 ? "Neutral" : s >= 30 ? "Leaning bearish" : "Bearish");
  const MIX_COLORS = { stocks: "#8b93ff", bonds: "#7cc4f5", commodities: "#f2b34a", realestate: "#e88ac0", crypto: "#3ecf8e", alts: "#d9c27a", cash: "#5d6472" };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

  /** Redraw `el` without losing what's being typed: form values, focus and cursor come back after. */
  function keep(el, draw) {
    const vals = {}, a = document.activeElement, inEl = el.contains(a);
    el.querySelectorAll("form input, form select").forEach((i) => { vals[`${i.form.id}.${i.name}`] = i.value; });
    const focus = inEl && a.form ? `${a.form.id}.${a.name}` : null, sel = focus && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    draw();
    el.querySelectorAll("form input, form select").forEach((i) => { const k = `${i.form.id}.${i.name}`; if (k in vals) i.value = vals[k]; });
    if (focus) { const i = el.querySelector(`#${focus.split(".")[0]} [name="${focus.split(".")[1]}"]`); if (i) { i.focus(); if (sel) try { i.setSelectionRange(...sel); } catch {} } }
  }

  function addForm() {
    return `<form class="pf-add" id="pfadd" autocomplete="off">
      <input name="sym" placeholder="Ticker (AAPL, VOO, BTC-USD)" aria-label="Ticker" spellcheck="false" maxlength="15" required>
      <input name="shares" placeholder="Shares" aria-label="Shares" inputmode="decimal" required>
      <input name="cost" placeholder="Avg cost per share (optional)" aria-label="Average cost per share" inputmode="decimal">
      <button type="submit" ${P.busy ? "disabled" : ""}>${P.busy ? "Adding…" : "Add holding"}</button>
      <span class="pf-msg ${P.msg.startsWith("✓") ? "ok" : ""}" role="status">${esc(P.msg)}</span></form>`;
  }

  function render() { if (P.active) keep($("#portfolio"), draw); }
  function draw() {
    const el = $("#portfolio"), d = P.data;
    if (!d) { el.innerHTML = `<div class="empty">Loading…</div>`; return; }
    if (!d.rows.length) {
      el.innerHTML = `<div class="pf"><div class="pf-hello"><h2>Track what you own</h2>
        <p>Add your holdings to see today's gain or loss, how your money is split across stocks, bonds, gold, crypto and cash,
        and what the Scorecards outlooks mean for <em>your</em> mix. Your holdings stay on this Mac.</p></div>${addForm()}</div>`;
      return;
    }
    const t = d.total;
    const tiles = `<div class="pf-top">
      <div class="pf-tile"><span>Value</span><b>${usd(t.value)}</b><em class="dim">${d.rows.length} holding${d.rows.length > 1 ? "s" : ""}${d.fetchedAt ? " · " + ago(d.fetchedAt) : ""}</em></div>
      <div class="pf-tile"><span>Today</span><b class="${cls(t.dayPnl)}">${sgnUsd(t.dayPnl)}</b><em class="${cls(t.dayPnl)}">${pct(t.dayPct)}</em></div>
      <div class="pf-tile"><span>Total gain</span><b class="${cls(t.gain)}">${t.gain == null ? "—" : sgnUsd(t.gain)}</b><em class="${t.gain == null ? "dim" : cls(t.gain)}">${t.gain == null ? "add your average cost to see it" : pct(t.gainPct, 1) + (t.partialCost ? " on holdings with a cost" : "")}</em></div>
      <div class="pf-tile"><span>Your outlook</span><b class="${grade(d.outlook)}">${d.outlook ?? "—"}<small>/100</small></b><em class="dim">${d.outlook == null ? "waiting for Scorecards data" : word(d.outlook) + " for your mix, next 6–12 months"}</em></div></div>`;
    const bar = `<div class="pf-mix"><div class="pf-bar">${d.mix.map((m) => `<i style="width:${m.weight}%;background:${MIX_COLORS[m.cls]}" title="${esc(m.label)} ${m.weight.toFixed(1)}%"></i>`).join("")}</div>
      <div class="pf-leg">${d.mix.map((m) => `<span><i style="background:${MIX_COLORS[m.cls]}"></i>${esc(m.label)} <b>${m.weight.toFixed(0)}%</b>${m.score != null ? ` <em class="${grade(m.score)}" title="Scorecards outlook">${m.score}</em>` : ""}</span>`).join("")}</div></div>`;
    const rows = [...d.rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).map((r) => `<button type="button" class="pf-row" data-sym="${esc(r.sym)}" aria-selected="${r.sym === P.sel}">
      <span class="pf-n"><b>${esc(r.sym)}</b><em>${esc(r.name)}</em></span>
      <span>${r.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
      <span>${price(r.last)}${r.currency && r.currency !== "USD" ? ` <em class="dim">${esc(r.currency)}</em>` : ""}</span>
      <span class="${cls(r.pct)}">${pct(r.pct)}</span>
      <span class="${cls(r.dayPnl)}">${sgnUsd(r.dayPnl)}</span>
      <span>${usd(r.value)}</span>
      <span class="dim">${r.weight == null ? "—" : r.weight.toFixed(1) + "%"}</span>
      <span class="${cls(r.gain)}">${r.gain == null ? '<em class="dim">—</em>' : `${sgnUsd(r.gain)} <em>${pct(r.gainPct, 1)}</em>`}</span></button>`).join("");
    el.innerHTML = `<div class="pf">${tiles}${bar}${addForm()}
      <div class="pf-cols"><span>Holding</span><span>Shares</span><span>Price</span><span>Today</span><span>Today $</span><span>Value</span><span>Weight</span><span>Total gain</span></div>
      ${rows}
      ${d.missing.length ? `<p class="pf-note">No price yet for ${esc(d.missing.join(", "))}. ${d.loading ? "Loading…" : "Yahoo Finance may not carry it."}</p>` : ""}
      <p class="pf-note">Prices are delayed quotes, converted to US dollars. Holdings are saved on this Mac only.</p></div>`;
  }

  function newsList(items) {
    if (!items.length) return `<p class="none">No headlines about your holdings in the last 3 days.</p>`;
    return items.map((s) => `<button type="button" class="pf-story" data-sid="${esc(s.id)}" data-url="${esc(s.link || "")}">
      <span class="h">${s.sev === "h" ? '<span class="badge hi">HI</span>' : ""}${esc(s.title)}</span>
      <span class="dim">${esc(s.syms.join(" · "))} · ${esc(s.code)} · ${ago(s.updated)}</span></button>`).join("");
  }

  let shownSym = null; // the holding whose edit form is on screen; typed edits survive redraws of that holding only
  function renderDetail() {
    if (!P.active || window.WireInstrument?.isOpen()) return;
    const el = $("#pdetail");
    if (shownSym === P.sel) keep(el, drawDetail); else drawDetail();
    shownSym = P.sel;
  }
  function drawDetail() {
    const el = $("#pdetail"), d = P.data;
    if (!d) { el.innerHTML = ""; return; }
    const r = d.rows.find((x) => x.sym === P.sel);
    if (!r) {
      const scored = d.mix.filter((m) => m.score != null);
      el.innerHTML = `<h1>Your outlook</h1>
        ${d.outlook == null ? `<p class="none">${d.rows.length ? "The outlook appears once the Scorecards data has loaded." : "Add holdings to get an outlook for your mix."}</p>` : `
        <p>Your holdings score <b class="${grade(d.outlook)}">${d.outlook}/100</b> (${word(d.outlook).toLowerCase()}) on WIRE's 6–12 month Scorecards. That's each asset class's outlook, weighted by how much of your money is in it${d.cash ? `; the ${d.cash.toFixed(0)}% in cash isn't scored` : ""}.</p>
        <dl class="kv">${scored.map((m) => `<dt>${esc(m.label)}</dt><dd><b class="${grade(m.score)}">${m.score}</b> <span class="dim">· ${m.weight.toFixed(0)}% of your money</span></dd>`).join("")}</dl>
        <p class="pf-hint">Click a holding to change its shares, cost or asset class. Wrong class? Changing it changes the outlook.</p>`}
        <div class="isec">NEWS ABOUT YOUR HOLDINGS</div>${newsList(d.news)}`;
      return;
    }
    const opts = d.classes.map(([k, l]) => `<option value="${k}"${k === r.cls ? " selected" : ""}>${esc(l)}</option>`).join("");
    const own = d.news.filter((s) => s.syms.includes(r.sym));
    el.innerHTML = `<div class="dhead"><span class="code">${esc(r.sym)}</span><span class="nm">${esc(r.name)}</span></div>
      <h1>${price(r.last)} ${r.currency ? `<small class="dim">${esc(r.currency)}</small>` : ""} <span class="${cls(r.pct)} pf-chg">${pct(r.pct)}</span></h1>
      <dl class="kv">
        <dt>Value</dt><dd>${usd(r.value, 2)} <span class="dim">· ${r.weight == null ? "—" : r.weight.toFixed(1) + "% of portfolio"}</span></dd>
        <dt>Today</dt><dd class="${cls(r.dayPnl)}">${sgnUsd(r.dayPnl, 2)}</dd>
        <dt>Cost basis</dt><dd>${r.basis == null ? '<span class="dim">add your average cost</span>' : usd(r.basis, 2)}</dd>
        <dt>Total gain</dt><dd class="${cls(r.gain)}">${r.gain == null ? "—" : `${sgnUsd(r.gain, 2)} (${pct(r.gainPct, 1)})`}</dd>
      </dl>
      <form class="pf-edit" id="pfedit" data-sym="${esc(r.sym)}" autocomplete="off">
        <label>Shares<input name="shares" value="${r.shares}" inputmode="decimal"></label>
        <label>Avg cost<input name="cost" value="${r.cost ?? ""}" placeholder="optional" inputmode="decimal"></label>
        <label>Asset class<select name="cls">${opts}</select></label>
        <div class="pf-btns"><button type="submit" class="open">Save</button><button type="button" class="pf-ghost" data-chart="${esc(r.sym)}">Open chart</button><button type="button" class="pf-del" data-del="${esc(r.sym)}">Remove</button></div>
        <span class="pf-msg" id="pfemsg" role="status"></span>
      </form>
      <div class="isec">NEWS ABOUT ${esc(r.sym)}</div>${newsList(own)}`;
  }

  function apply(d) { if (!d) return; P.data = d; if (P.sel && !d.rows.some((r) => r.sym === P.sel)) P.sel = null; render(); renderDetail(); }
  function select(sym) { P.sel = P.sel === sym ? null : sym; if (window.WireInstrument?.isOpen()) window.WireInstrument.close(); render(); renderDetail(); }

  $("#portfolio").addEventListener("submit", (e) => {
    if (e.target.id !== "pfadd") return;
    e.preventDefault();
    const f = new FormData(e.target);
    P.busy = true; P.msg = ""; render();
    api.page.invoke("portfolio:add", f.get("sym"), f.get("shares"), f.get("cost")).then((r) => {
      P.busy = false;
      P.msg = r.ok ? `✓ Added ${r.sym}` : r.error;
      if (r.ok) { P.sel = null; $("#pfadd")?.reset(); } // a failed add keeps what you typed so you can fix it
      render();
      $("#pfadd input[name=sym]")?.focus();
    });
  });
  $("#portfolio").addEventListener("click", (e) => { const r = e.target.closest(".pf-row"); if (r) select(r.dataset.sym); });
  $("#pdetail").addEventListener("submit", (e) => {
    if (e.target.id !== "pfedit") return;
    e.preventDefault();
    const f = new FormData(e.target);
    api.page.invoke("portfolio:update", e.target.dataset.sym, { shares: f.get("shares"), cost: f.get("cost"), cls: f.get("cls") })
      .then((r) => { if (!r.ok) $("#pfemsg").textContent = r.error; });
  });
  $("#pdetail").addEventListener("change", (e) => {
    if (e.target.name !== "cls") return;
    api.page.invoke("portfolio:update", e.target.form.dataset.sym, { cls: e.target.value });
  });
  $("#pdetail").addEventListener("click", (e) => {
    const c = e.target.closest("[data-chart]"); if (c) return window.WireApp.openInstrument(c.dataset.chart);
    const del = e.target.closest("[data-del]");
    if (del) {
      if (del.dataset.confirm) { api.page.invoke("portfolio:remove", del.dataset.del); P.sel = null; return; }
      del.dataset.confirm = "1"; del.textContent = `Remove ${del.dataset.del}?`; return;
    }
    const s = e.target.closest(".pf-story");
    if (s && !window.WireInstrument.onStory?.(s.dataset.sid) && s.dataset.url) api.open?.(s.dataset.url);
  });
  if (api?.page) api.page.on("portfolio:update", apply);

  (window.WirePages ||= {}).portfolio = {
    show() { P.active = true; render(); renderDetail(); api.page.invoke("portfolio:get").then(apply); },
    hide() { P.active = false; },
    key(e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const rows = [...document.querySelectorAll("#portfolio .pf-row")].map((x) => x.dataset.sym);
      if (!rows.length) return;
      const i = rows.indexOf(P.sel);
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); P.sel = rows[Math.min(rows.length - 1, i + 1)]; render(); renderDetail(); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); P.sel = rows[Math.max(0, i - 1)]; render(); renderDetail(); }
      else if (e.key === "Escape") { P.sel = null; render(); renderDetail(); }
      else if ((e.key === "Enter" || e.key === "o") && P.sel) window.WireApp.openInstrument(P.sel);
    },
    restore() { renderDetail(); },
    detail: () => $("#pdetail")
  };
})();
