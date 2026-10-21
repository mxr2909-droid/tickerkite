/* Tickerkite settings (⌘,), the first-launch terms screen and the license lock. Main-process side: src/settings.js and src/license.js.
   Order at launch: terms not yet accepted → the terms screen; trial over and no license → the lock screen; otherwise nothing. */
(() => {
  const api = window.wire;
  const call = (ch, ...a) => api.page.invoke(ch, ...a);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = { settings: null, license: null, view: null, msg: "", busy: false };

  /** Just enough Markdown for the legal files: headings, lists, bold, links as text, paragraphs. */
  function md(src) {
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
    const out = [];
    let list = false;
    for (const block of src.split(/\n\s*\n/)) {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*] /.test(l))) {
        out.push("<ul>" + lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("") + "</ul>");
        continue;
      }
      const h = /^(#{1,3}) (.*)/.exec(lines[0]);
      if (h) { out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); if (lines.length > 1) out.push(`<p>${inline(lines.slice(1).join(" "))}</p>`); continue; }
      out.push(`<p>${inline(lines.join(" "))}</p>`);
    }
    return out.join("");
  }

  const el = document.createElement("div");
  el.className = "wset"; el.hidden = true;
  document.body.appendChild(el);

  const chip = document.createElement("button");
  chip.type = "button"; chip.className = "refresh trial"; chip.hidden = true;
  chip.addEventListener("click", () => open("settings"));
  document.querySelector(".status #pulled")?.before(chip);

  function paintChip() {
    const l = S.license;
    if (!l || l.mode === "licensed" || l.mode === "dev") { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = l.mode === "trial" ? `Trial · ${l.trialLeft} day${l.trialLeft === 1 ? "" : "s"} left` : "License";
  }

  const fmtDate = (t) => (t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never");

  function licenseBlock(l, { lock = false } = {}) {
    const state = {
      licensed: `Licensed${l.customer ? " to <b>" + esc(l.customer) + "</b>" : ""} · key ${esc(l.key)} · checked ${fmtDate(l.validatedAt)}`,
      trial: `Free trial · <b>${l.trialLeft} day${l.trialLeft === 1 ? "" : "s"}</b> left of ${l.trialDays}`,
      expired: "Your free trial has ended.",
      offline: esc(l.message || ""),
      invalid: esc(l.message || ""),
      dev: "Development build · licensing is off."
    }[l.mode] || "";
    const has = l.mode === "licensed" || l.mode === "offline";
    return `<p class="wset-state">${state}</p>${l.message && l.mode === "trial" ? `<p class="wset-note">${esc(l.message)}</p>` : ""}
      ${has ? `<div class="wset-row"><button type="button" data-act="check">Check again</button><button type="button" data-act="deactivate" class="ghost">Move to another Mac…</button></div>`
        : `<form class="wset-row" data-form="license"><input name="key" placeholder="License key" aria-label="License key" spellcheck="false" autocomplete="off"><button type="submit">Activate</button>
          ${l.checkoutUrl ? `<button type="button" data-act="buy" class="${lock ? "" : "ghost"}">Buy Tickerkite</button>` : ""}</form>`}`;
  }

  function render() {
    const st = S.settings, l = S.license || st?.license;
    if (!S.view || !st) { el.hidden = true; return; }
    el.hidden = false;
    let body = "", closable = true;
    if (S.view === "gate-terms") {
      closable = false;
      body = `<h2>Before you start</h2>
        <div class="wset-warn"><b>Tickerkite is not investment advice.</b> Prices and data are delayed, come from third-party sources, and can be wrong or missing.
        Headlines link to their publishers, who own them. Don't make trading decisions on Tickerkite alone.</div>
        <div class="wset-doc" data-doc="terms">Loading…</div>
        <form class="wset-row" data-form="terms"><label class="wset-check"><input type="checkbox" name="ok" required> I've read and agree to the License Agreement and Privacy Policy</label>
        <button type="submit">Continue</button><button type="button" class="ghost" data-act="privacy">Privacy Policy</button></form>`;
    } else if (S.view === "gate-lock") {
      closable = false;
      body = `<h2>${l.mode === "expired" ? "Your free trial has ended" : "Tickerkite needs a license"}</h2>
        <p>Buy a license to keep using Tickerkite, or enter the key you received by email.</p>${licenseBlock(l, { lock: true })}`;
    } else if (S.view === "settings") {
      body = `<h2>Settings</h2>
        <section><h3>License</h3>${licenseBlock(l)}</section>
        <section><h3>Stock quotes</h3>
          <p>Tickerkite gets prices from Yahoo Finance's public pages by default. Add your own free <b>Finnhub</b> key (finnhub.io › Get free API key) and prices for US stocks and ETFs on your watchlist and portfolio come from Finnhub instead. Indices, futures, FX and charts still use Yahoo.</p>
          ${st.finnhub.set ? `<div class="wset-row"><span class="wset-state">Finnhub key ${esc(st.finnhub.masked)} · in use</span><button type="button" class="ghost" data-act="rmkey">Remove</button></div>`
            : `<form class="wset-row" data-form="finnhub"><input name="key" placeholder="Finnhub API key" aria-label="Finnhub API key" spellcheck="false" autocomplete="off"><button type="submit">Save</button></form>`}
          <p class="wset-note">The key is stored in your macOS Keychain and sent only to finnhub.io.</p></section>
        <section><h3>About</h3><p>Tickerkite ${esc(st.version)}</p>
          <div class="wset-row"><button type="button" class="ghost" data-act="updates">Check for updates</button><button type="button" class="ghost" data-act="terms">License Agreement</button>
          <button type="button" class="ghost" data-act="privacy">Privacy Policy</button><button type="button" class="ghost" data-act="sources">Data Sources</button></div></section>`;
    } else {
      body = `<div class="wset-doc" data-doc="${S.view}">Loading…</div>`;
    }
    el.innerHTML = `<div class="wset-back"${closable ? ' data-act="close"' : ""}></div><div class="wset-box" role="dialog" aria-modal="true" aria-label="Tickerkite">
      ${closable ? '<button type="button" class="wset-x" data-act="close" aria-label="Close">×</button>' : ""}${body}
      <p class="wset-msg" role="status" aria-live="polite">${esc(S.msg)}</p></div>`;
    el.querySelectorAll("[data-doc]").forEach(async (d) => { d.innerHTML = md(await call("settings:legal", d.dataset.doc)); });
    el.querySelector("input:not([type=checkbox])")?.focus();
  }

  /** Which gate (if any) is due. */
  function gate() {
    if (!S.settings?.terms.accepted) return "gate-terms";
    if ((S.license || S.settings.license)?.locked) return "gate-lock";
    return null;
  }
  function settle() {
    const g = gate();
    if (g) S.view = g;
    else if (S.view?.startsWith("gate-")) S.view = null;
    paintChip(); render();
  }
  function open(view) {
    if (gate()) return; // the gate stays until it's resolved
    S.view = view; S.msg = ""; render();
  }

  async function act(name, form) {
    if (S.busy) return;
    S.busy = true; S.msg = "Working…"; el.querySelector(".wset-msg") && (el.querySelector(".wset-msg").textContent = S.msg);
    try {
      if (name === "terms-accept") { S.settings = await call("settings:acceptTerms"); S.msg = ""; }
      else if (name === "license") {
        const r = await call("license:activate", form.key.value);
        if (r.ok) { S.license = r.status; S.msg = "License activated. Thank you!"; } else S.msg = r.error;
      }
      else if (name === "check") { S.license = await call("license:check"); S.msg = S.license.mode === "licensed" ? "License checked." : S.license.message || ""; }
      else if (name === "deactivate") {
        if (confirm("Remove the license from this Mac? You can then activate it on another one.")) { S.license = await call("license:deactivate"); S.msg = "License removed from this Mac."; } else S.msg = "";
      }
      else if (name === "buy") { S.msg = (await call("license:buy")) ? "Opening the store in your browser…" : "The store link isn't set up yet."; }
      else if (name === "finnhub" || name === "rmkey") {
        const r = await call("settings:setFinnhub", name === "rmkey" ? "" : form.key.value);
        if (r.ok) { S.settings = r.settings; S.msg = name === "rmkey" ? "Key removed. Prices come from Yahoo again." : "Key saved. Prices update within a minute."; } else S.msg = r.error;
      }
      else if (name === "updates") { await call("settings:checkUpdates"); S.msg = ""; }
    } catch (e) { S.msg = String(e.message || e); }
    S.busy = false;
    settle();
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "close") { S.view = null; S.msg = ""; render(); }
    else if (["terms", "privacy", "sources"].includes(a)) {
      if (S.view === "gate-terms") { const d = el.querySelector("[data-doc]"); d.dataset.doc = a; call("settings:legal", a).then((t) => { d.innerHTML = md(t); d.scrollTop = 0; }); }
      else { S.view = a; S.msg = ""; render(); }
    }
    else act(a);
  });
  el.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target.dataset.form;
    act(f === "terms" ? "terms-accept" : f, e.target);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.view && !S.view.startsWith("gate-")) { e.stopPropagation(); S.view = null; render(); }
  }, true);

  api.page.on("settings:open", (v) => open(v || "settings"));
  api.page.on("license:update", (l) => { S.license = l; settle(); });
  (async () => { S.settings = await call("settings:get"); S.license = S.settings.license; settle(); })();
})();
