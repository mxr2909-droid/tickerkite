/* WIRE Alerts page. Registers with app.js through window.WirePages (see the "pages" section there).
   Left (#alerts): add form, rule list (click to select, ● toggles, × deletes), then the firing log.
   Right (#adetail): the selected rule and its recent firings. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const time = (t) => { const d = new Date(t); const today = new Date().toDateString() === d.toDateString(); return today ? d.toTimeString().slice(0, 5) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toTimeString().slice(0, 5); };
  const TYPES = { price: "PRICE", score: "SCORE", ind: "INDIC", news: "NEWS" };

  let D = { rules: [], log: [], symbols: [], assets: [], inds: [] };
  let sel = null, type = "price", shown = false, err = "", formDirty = true;

  function form() {
    const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(t)}</option>`;
    const lvl = `<select name="op">${opt("above", "above")}${opt("below", "below")}</select><input name="value" type="number" step="any" placeholder="level">`;
    const f = {
      price: `<select name="sym">${D.symbols.map((s) => opt(s.sym, (s.watch ? "★ " : "") + s.label)).join("")}</select>
        <select name="op">${opt("move", "day move ≥ ±%")}${opt("above", "price above")}${opt("below", "price below")}</select><input name="value" type="number" step="any" placeholder="value">`,
      score: `<select name="asset">${D.assets.map((a) => opt(a.k, a.n)).join("")}</select>${lvl}`,
      ind: `<select name="ind">${D.inds.map((i) => opt(i.id, i.name + (i.v != null ? ` (${+i.v.toFixed(2)})` : ""))).join("")}</select>${lvl}`,
      news: `<input name="keyword" placeholder="keyword or ticker"><label class="al-chk"><input name="high" type="checkbox"> HIGH only</label>`
    }[type];
    return `<form class="cform al-form" id="alform">
      <select name="type">${Object.entries({ price: "Price", score: "Scorecard", ind: "Indicator", news: "Headline" }).map(([k, t]) => opt(k, t, type)).join("")}</select>
      ${f}<label class="al-cd">cooldown <input name="cooldown" type="number" min="0" value="60"> min</label><button type="submit">ADD</button>
      <span class="dn al-err"></span></form>`;
  }

  function logRows(entries) {
    if (!entries.length) return `<div class="empty">Nothing has fired yet.</div>`;
    return entries.map((e) => `<button type="button" class="al-log${e.story ? " al-link" : ""}" data-story="${esc(e.story || "")}" data-rule="${esc(e.rule)}">
      <span class="dim">${time(e.ts)}</span><span class="s">${TYPES[e.type] || ""}</span><span class="h">${esc(e.label)} — ${esc(e.text)}</span></button>`).join("");
  }

  function render() {
    if (!shown) return;
    const rules = D.rules.map((r) => `<div class="row al-rule${r.enabled ? "" : " off"}" data-id="${r.id}" aria-selected="${r.id === sel}">
      <button type="button" class="al-tog ${r.enabled ? "up" : "dim"}" data-act="toggle" title="${r.enabled ? "Disable" : "Enable"}">${r.enabled ? "●" : "○"}</button>
      <span class="h">${esc(r.label)}</span>
      <span class="s">${TYPES[r.type]}</span>
      <span class="t">${r.on ? `<b class="dn">ON</b>` : r.now != null ? esc(r.now) : ""}<button type="button" class="al-del" data-act="delete" title="Delete">×</button></span></div>`).join("");
    // the form is rebuilt only when its type changes (or on first show), so refreshes don't eat typing
    if (!$("#alform") || formDirty) { $("#alerts").innerHTML = `${form()}<div id="albody"></div>`; formDirty = false; }
    $("#alerts").querySelector(".al-err").textContent = err;
    $("#albody").innerHTML = `
      <div class="al-sec">RULES <span class="dim">${D.rules.length}</span></div>
      ${rules || `<div class="empty">No rules yet. Add one above: a price move, a scorecard threshold, an indicator level or a headline keyword.</div>`}
      <div class="al-sec">LOG <span class="dim">${D.log.length}</span>${D.log.length ? `<button type="button" class="al-clear" id="alclear">CLEAR</button>` : ""}</div>
      ${logRows(D.log.slice(0, 100))}`;
    detail();
  }

  function detail() {
    const el = $("#adetail");
    const r = D.rules.find((x) => x.id === sel);
    if (!r) {
      el.innerHTML = `<h1>Alerts</h1><p>Rules are checked after every quote, news and scorecard refresh. A rule fires when its condition becomes true (not again until it resets and the cooldown has passed), with a Mac notification and a log entry.</p>
        <p class="none">Select a rule to see its recent firings.</p>`;
      return;
    }
    const hits = D.log.filter((e) => e.rule === r.id);
    el.innerHTML = `<h1>${esc(r.label)}</h1>
      <dl class="kv"><dt>Type</dt><dd>${TYPES[r.type]}</dd><dt>Status</dt><dd>${r.enabled ? (r.on ? "Condition true now" : "Watching") : "Disabled"}</dd>
      ${r.now != null ? `<dt>Now</dt><dd>${esc(r.now)}</dd>` : ""}<dt>Cooldown</dt><dd>${r.cooldown} min</dd><dt>Created</dt><dd>${time(r.created)}</dd><dt>Fired</dt><dd>${hits.length}×</dd></dl>
      <div class="al-sec">RECENT FIRINGS</div>${logRows(hits.slice(0, 50))}`;
  }

  async function load() { D = await api.page.invoke("alerts:get"); render(); }
  api?.page?.on("alerts:update", (d) => {
    // symbols only arrive after the first quote refresh: rebuild the form then, unless the user is in it
    if (d.symbols.length !== D.symbols.length && !document.activeElement?.closest?.("#alform")) formDirty = true;
    D = d; render();
  });

  document.addEventListener("change", (e) => { if (e.target.name === "type" && e.target.closest("#alform")) { type = e.target.value; err = ""; formDirty = true; render(); } });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "alform") return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.high = !!f.high;
    const res = await api.page.invoke("alerts:add", f);
    err = res?.error || "";
    if (!err) formDirty = true;
    render();
  });
  document.addEventListener("click", async (e) => {
    if (!shown) return;
    const lg = e.target.closest(".al-log");
    if (lg && e.target.closest("#alerts, #adetail")) {
      if (lg.dataset.story) api.page.invoke("alerts:open", lg.dataset.story);
      else { sel = lg.dataset.rule; render(); }
      return;
    }
    if (e.target.id === "alclear") { api.page.invoke("alerts:clear-log"); return; }
    const row = e.target.closest(".al-rule");
    if (!row) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "toggle") api.page.invoke("alerts:toggle", row.dataset.id);
    else if (act === "delete") { if (sel === row.dataset.id) sel = null; api.page.invoke("alerts:delete", row.dataset.id); }
    else { sel = sel === row.dataset.id ? null : row.dataset.id; render(); }
  });

  (window.WirePages ||= {}).alerts = {
    show() { shown = true; formDirty = true; if (api?.page) load(); else $("#alerts").innerHTML = `<div class="empty">Run inside the WIRE app to use alerts.</div>`; },
    hide() { shown = false; },
    key(e) {
      if (e.target.closest?.("input, select")) return;
      const ids = D.rules.map((r) => r.id);
      const i = ids.indexOf(sel);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))] ?? null; render(); }
      else if (e.key === " " && sel) { e.preventDefault(); api.page.invoke("alerts:toggle", sel); }
      else if (e.key === "Escape") { sel = null; render(); }
    },
    restore() { detail(); },
    detail: () => $("#adetail")
  };
})();
