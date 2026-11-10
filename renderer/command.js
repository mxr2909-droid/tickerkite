/* Tickerkite command bar (⌘K, or View › Go To…). Type a page, a ticker or company name, a headline, or a
   Bloomberg-style mnemonic after a ticker ("AAPL FA", "NVDA HDS", "GC"). Pages, commands, your tickers and
   headlines match instantly here; every other symbol comes from src/command.js (Yahoo search). */
(() => {
  const api = window.wire;
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const app = () => window.WireApp;

  // [mnemonic(s), label, page]
  const PAGES = [
    [["BRIEF", "BRF", "B"], "Brief", "brief"], [["N", "TOP", "NEWS"], "News", "news"], [["PORT", "PF"], "Portfolio", "portfolio"],
    [["SC", "ECST", "SCORE"], "Scorecards", "score"], [["ECO", "CAL"], "Calendar", "calendar"], [["WEI", "MKT", "HEAT"], "Markets heatmap", "markets"], [["MAP", "IMAP", "TREE"], "Sector map", "map"], [["FX", "CCY", "DXY"], "Currencies", "fx"],
    [["FED", "WIRP"], "Fed rate path", "fed"], [["GC", "CURVE", "YC"], "Yield curve", "curve"], [["G", "GP", "GRAPH"], "Graphs", "graphs"], [["COMPANY", "DES"], "Company", "company"], [["MC", "MONTE", "SIM"], "Portfolio Monte Carlo", "mc"]
  ];
  // [mnemonic(s), label, company-page tab or special action]
  const TICKER = [
    [["DES"], "Overview", "overview"], [["FA"], "Financials", "financials"], [["HDS"], "Institutional holders", "holders"],
    [["INSD", "INS"], "Insider trades", "insiders"], [["CF", "FIL"], "SEC filings", "filings"], [["CN"], "News", "news"], [["GP"], "Chart", "chart"]
  ];
  const COMMANDS = [
    [["REFRESH", "R"], "Refresh news and quotes", () => api.refresh()],
    [["UPDATE"], "Update economic data (Scorecards)", () => api.refreshScores()],
    [["WIDGET"], "Show or hide the floating widget", () => api.widget.toggle()]
  ];

  const K = { open: false, q: "", items: [], idx: 0, remote: [], seq: 0, timer: null };
  const el = document.createElement("div");
  el.className = "cmdk"; el.hidden = true;
  el.innerHTML = `<div class="cmdk-back"></div><div class="cmdk-box" role="dialog" aria-label="Go to">
    <input class="cmdk-in" placeholder="Type a ticker, company, page or headline…   e.g. AAPL FA, GC, Nvidia" spellcheck="false" autocomplete="off" aria-label="Search">
    <div class="cmdk-list" role="listbox"></div>
    <div class="cmdk-foot"><span><b>↑↓</b> move</span><span><b>↵</b> open</span><span><b>esc</b> close</span><span class="cmdk-mn">After a ticker: DES overview · FA financials · HDS holders · INSD insiders · CF filings · CN news · GP chart</span></div></div>`;
  document.body.appendChild(el);
  const input = el.querySelector(".cmdk-in"), list = el.querySelector(".cmdk-list");

  function open(prefill = "") {
    K.open = true; el.hidden = false; input.value = prefill; K.q = prefill; K.remote = []; build(); input.focus(); input.select();
  }
  function close() { K.open = false; el.hidden = true; input.blur(); }

  const norm = (s) => String(s || "").toUpperCase().trim();
  const symRe = /^[A-Z0-9^][A-Z0-9.^=\-]{0,14}$/;
  /** Local symbols: your watchlist, portfolio and the sidebar markets, with names. */
  function localSyms() {
    const out = new Map();
    for (const w of app()?.watch?.() || []) out.set(w.sym, { sym: w.sym, name: w.name, kind: "Watchlist" });
    for (const q of app()?.quotes?.() || []) if (!out.has(q.sym)) out.set(q.sym, { sym: q.sym, name: q.name || q.label, kind: q.watch ? "Watchlist" : "Market" });
    return [...out.values()];
  }

  function build() {
    const raw = K.q.trim(), q = norm(raw), words = q.split(/\s+/).filter(Boolean);
    const items = [];
    const add = (it) => { if (!items.some((x) => x.key === it.key)) items.push(it); };
    if (!q) {
      for (const [, label, p] of PAGES) add({ key: "p:" + p, group: "Go to", label, hint: "", run: () => app().setPage(p) });
      K.items = items; K.idx = 0; paint(); return;
    }
    // "AAPL FA": a ticker followed by a mnemonic
    const last = words.length > 1 ? words[words.length - 1] : null;
    const tk = last && TICKER.find(([m]) => m.includes(last));
    const head = tk ? words.slice(0, -1).join(" ") : q;
    // pages and commands by mnemonic or name
    for (const [m, label, p] of PAGES) if (m.includes(q) || label.toUpperCase().includes(q)) add({ key: "p:" + p, group: "Go to", label, hint: m[0], run: () => app().setPage(p) });
    for (const [m, label, fn] of COMMANDS) if (m.includes(q) || label.toUpperCase().includes(q)) add({ key: "c:" + m[0], group: "Commands", label, hint: "", run: fn });

    // tickers: exact symbol first (with its actions), then local and remote matches
    const local = localSyms();
    const remote = K.remote;
    const all = [...local, ...remote.filter((r) => !local.some((l) => l.sym === r.sym))];
    // until the search answers, anything ticker-shaped is treated as a ticker; after, only real symbols are
    const exact = symRe.test(head) ? (all.find((s) => s.sym === head) || (!remote.length && head.length <= 5 ? { sym: head, name: "", kind: "" } : null)) : null;
    const tickerActions = (s, only) => {
      const acts = only ? [only] : TICKER;
      for (const [m, label, tab] of acts) add({ key: `t:${s.sym}:${tab}`, group: s.sym, label: `${s.sym} · ${label}`, sub: s.name, hint: m[0], run: () => openTicker(s.sym, tab) });
      if (!only) {
        add({ key: `w:${s.sym}`, group: s.sym, label: `Add ${s.sym} to watchlist`, hint: "", run: () => api.addWatch(s.sym) });
        add({ key: `pf:${s.sym}`, group: s.sym, label: `Add ${s.sym} to portfolio…`, hint: "", run: () => { app().setPage("portfolio"); setTimeout(() => { const i = document.querySelector("#pfadd input[name=sym]"); if (i) { i.value = s.sym; document.querySelector("#pfadd input[name=shares]")?.focus(); } }, 150); } });
      }
    };
    if (exact) tickerActions(exact, tk);
    const matches = all.filter((s) => s !== exact && (s.sym.startsWith(head) || (s.name || "").toUpperCase().includes(head))).slice(0, 8);
    for (const s of matches) add({ key: `t:${s.sym}:${tk?.[2] || "overview"}`, group: "Symbols", label: s.sym, sub: `${s.name}${s.kind ? " · " + s.kind : ""}${s.exch ? " · " + s.exch : ""}`, hint: tk ? tk[0][0] : "", run: () => openTicker(s.sym, tk?.[2] || "overview") });

    // headlines
    if (raw.length >= 3) {
      const ws = raw.toLowerCase().split(/\s+/);
      const hs = (app()?.stories?.() || []).filter((s) => ws.every((w) => s.title.toLowerCase().includes(w))).sort((a, b) => b.updated - a.updated).slice(0, 5);
      for (const s of hs) add({ key: "s:" + s.id, group: "Headlines", label: s.title, sub: s.code, hint: "", run: () => api.showStory(s.id) });
    }
    K.items = items; K.idx = Math.min(K.idx, Math.max(0, items.length - 1)); paint();
    // remote symbol search, debounced; skip pure mnemonics
    clearTimeout(K.timer);
    if (head.length >= 1 && !(PAGES.some(([m]) => m.includes(q)) && words.length === 1 && q.length <= 4 && !exact)) {
      const seq = ++K.seq, term = head;
      K.timer = setTimeout(() => api.page.invoke("cmd:search", term).then((r) => { if (seq === K.seq && K.open) { K.remote = r || []; build(); } }), 160);
    }
  }

  function paint() {
    let g = null;
    list.innerHTML = K.items.length ? K.items.map((it, i) => {
      const hdr = it.group !== g ? `<div class="cmdk-g">${esc((g = it.group))}</div>` : "";
      return `${hdr}<button type="button" class="cmdk-it" role="option" data-i="${i}" aria-selected="${i === K.idx}">
        <span class="cmdk-l">${esc(it.label)}${it.sub ? `<em>${esc(it.sub)}</em>` : ""}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ""}</button>`;
    }).join("") : `<div class="cmdk-none">No matches. Try a ticker (NVDA), a company (Nvidia) or a page (Calendar).</div>`;
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }
  function run(i) { const it = K.items[i]; if (!it) return; close(); it.run(); }

  function openTicker(sym, tab) {
    if (tab === "chart") { app().setPage("company"); window.WireCompanyPage?.open(sym, "overview"); setTimeout(() => app().openInstrument(sym), 50); return; }
    window.WireCompanyPage?.open(sym, tab);
  }

  input.addEventListener("input", () => { K.q = input.value; K.remote = K.q.trim() ? K.remote : []; K.idx = 0; build(); });
  el.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the page underneath must not see these keys
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) { e.preventDefault(); K.idx = Math.min(K.items.length - 1, K.idx + 1); paint(); }
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) { e.preventDefault(); K.idx = Math.max(0, K.idx - 1); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); run(K.idx); }
  });
  list.addEventListener("click", (e) => { const b = e.target.closest(".cmdk-it"); if (b) run(+b.dataset.i); });
  list.addEventListener("mousemove", (e) => { const b = e.target.closest(".cmdk-it"); if (b && +b.dataset.i !== K.idx) { K.idx = +b.dataset.i; list.querySelectorAll(".cmdk-it").forEach((x) => x.setAttribute("aria-selected", String(+x.dataset.i === K.idx))); } });
  el.querySelector(".cmdk-back").addEventListener("click", close);
  // ⌘K normally arrives through the menu (main sends cmd:open); this catches it if the menu doesn't
  document.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); K.open ? close() : open(); } }, true);
  api?.page?.on("cmd:open", () => (K.open ? close() : open()));

  window.WireCommand = { open, close };
})();
