// M&A deal alerts: the settings popover. The ALERTS button is drawn by mna.js (data-act="mna-alerts");
// everything here is delegated from #mna, so it survives the header being redrawn.
(() => {
  "use strict";
  const api = window.wire;
  const TYPES = ["Merger", "Tender offer", "Going private"];
  const SIZES = [[0, "Any"], [1e8, "$100M+"], [1e9, "$1B+"], [1e10, "$10B+"]];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let prefs = { on: false, sectors: [], watch: true, minSize: 0, types: [] };
  let loaded = false, pop = null, open = false;

  const T = (window.TkMnaAlerts = window.TkMnaAlerts || {});
  T.sectors = T.sectors || [];
  T.label = () => (prefs.on ? "ALERTS ON" : "ALERTS OFF");
  /** Called by anyone who has the snapshot (sectors minus SPACs). */
  T.setSectors = (list) => { if (Array.isArray(list)) { T.sectors = list.filter((s) => s !== "SPACs & shells"); if (open) paint(); } };

  const btn = () => document.querySelector('#mna [data-act="mna-alerts"]');
  function paintBtn() {
    const b = btn();
    if (b) { b.textContent = T.label(); b.setAttribute("aria-pressed", String(!!prefs.on)); }
  }

  async function load() {
    try { prefs = (await api.page.invoke("mna:alerts:get")) || prefs; loaded = true; } catch {}
    paintBtn();
  }
  async function loadSectors() {
    if (T.sectors.length) return;
    try { const s = await api.page.invoke("mna:get"); T.setSectors(s?.sectors); } catch {}
  }
  async function save(next) {
    prefs = next; paintBtn();
    try { prefs = (await api.page.invoke("mna:alerts:set", next)) || next; } catch {}
    paintBtn();
  }

  function el() {
    const root = document.getElementById("mna");
    if (!root) return null;
    if (!pop) {
      pop = document.createElement("div");
      pop.className = "mnal-pop"; pop.hidden = true;
      pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Deal alerts");
    }
    if (pop.parentNode !== root) root.append(pop);
    return pop;
  }

  function paint() {
    if (!pop) return;
    const chk = (attr, val, label, on, extra = "") => `<label class="mnal-chk"><input type="checkbox" ${attr}="${esc(val)}"${on ? " checked" : ""}${extra}><span>${esc(label)}</span></label>`;
    pop.innerHTML = `<div class="mnal-h"><b>Deal alerts</b></div>
      <label class="mnal-sw"><input type="checkbox" data-al="on"${prefs.on ? " checked" : ""}><span class="mnal-tr"><i></i></span><span>Tell me about new deals</span></label>
      <div class="mnal-body"${prefs.on ? "" : ' data-off="1"'}>
        ${chk("data-al", "watch", "My watchlist tickers (always)", prefs.watch)}
        <div class="mnal-g">Sectors <em>${prefs.sectors.length ? "" : "any"}</em></div>
        <div class="mnal-grid">${T.sectors.map((s) => chk("data-sec", s, s, prefs.sectors.includes(s))).join("") || '<span class="mnal-dim">Loading…</span>'}</div>
        <div class="mnal-g">Deal types <em>${prefs.types.length ? "" : "any"}</em></div>
        <div class="mnal-grid">${TYPES.map((t) => chk("data-typ", t, t, prefs.types.includes(t))).join("")}</div>
        <div class="mnal-g">Minimum size</div>
        <div class="mnal-seg" role="group" aria-label="Minimum size">${SIZES.map(([v, l]) => `<button type="button" data-min="${v}" aria-pressed="${prefs.minSize === v}">${esc(l)}</button>`).join("")}</div>
      </div>
      <p class="mnal-help">A deal is announced here when its first SEC filing appears, usually days to weeks after the news. Deals with no stated size only alert when the minimum is Any.</p>`;
  }

  function place() {
    const b = btn(), root = document.getElementById("mna");
    if (!b || !root || !pop) return;
    const br = b.getBoundingClientRect(), rr = root.getBoundingClientRect();
    const w = Math.min(340, Math.max(220, rr.width - 24));
    pop.style.width = w + "px";
    const left = Math.max(8, Math.min(br.right - rr.left - w, rr.width - w - 8));
    pop.style.left = left + "px";
    pop.style.top = (br.bottom - rr.top + root.scrollTop + 6) + "px";
  }

  function show() {
    if (!el()) return;
    open = true; paint(); pop.hidden = false; place();
    btn()?.setAttribute("aria-expanded", "true");
    loadSectors();
  }
  function hide() {
    if (!open) return;
    open = false;
    if (pop) pop.hidden = true;
    btn()?.setAttribute("aria-expanded", "false");
  }

  function wire() {
    const root = document.getElementById("mna");
    if (!root) return;
    root.addEventListener("click", (e) => {
      if (e.target.closest('[data-act="mna-alerts"]')) { e.stopPropagation(); return open ? hide() : show(); }
      const m = e.target.closest("[data-min]");
      if (m && pop?.contains(m)) { save({ ...prefs, minSize: Number(m.dataset.min) }); paint(); }
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (!pop?.contains(t)) return;
      if (t.dataset.al === "on") save({ ...prefs, on: t.checked }).then(paint);
      else if (t.dataset.al === "watch") save({ ...prefs, watch: t.checked });
      else if (t.dataset.sec !== undefined) save({ ...prefs, sectors: toggle(prefs.sectors, t.dataset.sec, t.checked) });
      else if (t.dataset.typ !== undefined) save({ ...prefs, types: toggle(prefs.types, t.dataset.typ, t.checked) });
      if (t.dataset.al === "on") paint();
    });
    document.addEventListener("click", (e) => {
      if (open && pop && !pop.contains(e.target) && !e.target.closest('[data-act="mna-alerts"]')) hide();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { e.stopPropagation(); hide(); btn()?.focus(); } }, true);
    window.addEventListener("resize", () => open && place());
    // the page hides by changing the app's data-page: close with it
    const app = document.querySelector(".app");
    if (app) new MutationObserver(() => { if (app.dataset.page !== "mna") hide(); }).observe(app, { attributes: true, attributeFilter: ["data-page"] });
    // mna.js redraws the header often: put the label back whenever the button is new
    new MutationObserver(() => { const b = btn(); if (b && b.textContent !== T.label()) paintBtn(); }).observe(root, { childList: true, subtree: true });
  }
  const toggle = (list, v, on) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

  wire();
  load();
})();
