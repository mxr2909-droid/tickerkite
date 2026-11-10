/* Tickerkite terminal chrome: the function-code bar across the top, a header strip per page
   (CODE · TITLE · status on the left, "PULLED N MINUTES AGO" on the right) and the key-hint footer.
   Built once and shown only under [data-theme="terminal"] (terminal.css); the classic theme keeps the
   segmented page switcher in the title bar. Pages report their data time with WireChrome.pulled(page, ts)
   and an optional status with WireChrome.status(page, text). */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // [page, code, title, View-menu shortcut digit, key hints]
  const PAGES = [
    ["news", "TOP", "TOP NEWS", 1, "1–7 DESK · ↑↓ MOVE · ↵ OPEN · / SEARCH · ESC CLEAR · ⌘R RELOAD"],
    ["brief", "BRF", "MORNING BRIEF", 0, "R RELOAD · ⌘K GO TO"],
    ["score", "ECST", "MACRO SCORECARD", 2, "1–6 ASSET · B BOARD · ↑↓ MOVE · ↵ CHART"],
    ["calendar", "ECO", "ECONOMIC CALENDAR", 3, "1–5 REGION · ←→ WEEK · ↑↓ MOVE · T TODAY · / SEARCH · R RELOAD"],
    ["fx", "FX", "CURRENCIES AND THE DOLLAR", "X", "↵ CHART ROW · R RELOAD · YAHOO FINANCE, DELAYED"],
    ["markets", "WEI", "WORLD INDICES AND SECTORS", 4, "1–9 PERIOD · ↵ CHART · YAHOO FINANCE, DELAYED"],
    ["map", "MAP", "SECTOR MAP: SECTORS AND THEIR LARGEST COMPANIES", "H", "1–6 PERIOD · CLICK A SECTOR TO OPEN · ESC BACK · D 2D/3D · ←→ SECTOR · ↑↓ COMPANY · ↵ CHART · NASDAQ + YAHOO, DELAYED"],
    ["fed", "FED", "FED FUNDS PATH, MARKET-IMPLIED", 5, "↑↓ MOVE · R RELOAD · CME / FRED"],
    ["curve", "GC", "TREASURY YIELD CURVE", 8, "R RELOAD · US TREASURY"],
    ["graphs", "GP", "GRAPHS", 6, "/ ADD SERIES · ESC CANCEL TOOL"],
    ["factor", "FAC", "FACTOR PROBABILITIES", "R", "↵ RUN · PICK A CASE AND MACRO FACTORS · LOGISTIC REGRESSION"],
    ["warn", "WARN", "WARNING HISTORY", "W", "1–5 MONITOR · ↵ OPEN MODEL · PAST RISK WARNINGS AND WHAT FOLLOWED"],
    ["screen", "SCRN", "STOCK SCREENER", "S", "↵ OPEN COMPANY · CLICK A COLUMN TO SORT · SEC FILINGS + YAHOO PRICES"],
    ["portfolio", "PORT", "PORTFOLIO", 7, "↑↓ MOVE · ↵ CHART · ESC DESELECT"],
    ["company", "DES", "COMPANY", 9, "1–7 / ←→ TAB · ↵ CHART · / OR ⌘K LOOK UP"],
    ["mc", "MC", "PORTFOLIO MONTE CARLO", "O", "1–5 TIME FRAME · R RERUN · P PATHS · V VALUE / RETURN · 10,000 RUNS, YAHOO DAILY CLOSES"]
  ];
  // Top-level tabs and their sub-tabs (page ids). A group with one page shows no sub-row.
  const GROUPS = [
    ["NEWS", ["news", "brief"]],
    ["MACRO", ["score", "calendar", "fed", "curve", "warn", "factor"]],
    ["MARKETS", ["markets", "map", "fx"]],
    ["GRAPHS", ["graphs"]],
    ["EQUITY", ["screen", "company", "mc"]],
    ["PORTFOLIO", ["portfolio"]]
  ];
  // one-letter shortcut per page, pressed with ⌥ (Option); mnemonic: Top, Brief, Economic scorecard, Calendar, Fed, Yield curve, Warnings, fActor, Markets, sector map (Heat), fX, Graphs, Screener, Company (Des), Portfolio, mOnte carlo
  const KEYS = { news: "T", brief: "B", score: "E", calendar: "C", fed: "F", curve: "Y", warn: "W", factor: "A", markets: "M", map: "H", fx: "X", graphs: "G", screen: "S", company: "D", portfolio: "P", mc: "O" };
  const groupOf = (p) => GROUPS.findIndex((g) => g[1].includes(p));
  const lastIn = {};   // group index -> last page opened in it
  const META = Object.fromEntries(PAGES.map((p) => [p[0], { code: p[1], title: p[2], digit: p[3], hint: p[4] }]));
  const C = { page: "news", pulled: {}, status: {} };

  // ---------- build ----------
  const bar = document.createElement("header");
  bar.className = "fbar";
  bar.innerHTML = `<div class="fb-logo" aria-hidden="true"><svg viewBox="0 0 148 90" width="26" height="16"><path fill="#F47321" d="M0 0H40V64C40 76 56 81 72 81V90C30 90 0 84 0 70Z"/><path fill="#005030" d="M148 0H108V64C108 76 92 81 76 81V90C118 90 148 84 148 70Z"/></svg><span>TICKER<br>KITE</span></div>
    <nav class="fb-codes" role="tablist" aria-label="Sections">${GROUPS.map(([name, pages], i) =>
      `<button type="button" role="tab" data-g="${i}" aria-selected="false" title="${esc(name)}${pages.length === 1 ? ` (⌥${KEYS[pages[0]]})` : ""}">${name}</button>`).join("")}</nav>
    <button type="button" class="fb-upd" id="fbUpd" hidden></button>
    <button type="button" class="fb-bell" id="fbBell" aria-haspopup="dialog" aria-expanded="false" title="Alerts inbox: every notification Tickerkite has sent"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v2.6L2 11v1h12v-1l-1.5-2.4V6A4.5 4.5 0 0 0 8 1.5ZM6.3 13.2a1.8 1.8 0 0 0 3.4 0Z" fill="currentColor"/></svg><b id="fbBellN"></b></button>
    <button type="button" class="fb-health" id="fbHealth" aria-haspopup="dialog" aria-expanded="false" title="Data health: is each source loading and fresh?"><i></i><span>DATA</span></button>
    <span class="fb-clock num" id="fbClock"></span>`;
  $("#app").prepend(bar);
  const sub = document.createElement("nav");
  sub.className = "fsub"; sub.setAttribute("role", "tablist"); sub.setAttribute("aria-label", "Pages"); sub.hidden = true;
  bar.after(sub);

  // ---------- data health light (src/main.js healthSnapshot) ----------
  const pop = document.createElement("div");
  pop.className = "fb-hpop"; pop.id = "fbHealthPop"; pop.hidden = true; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Data health");
  document.body.append(pop);
  const HB = bar.querySelector("#fbHealth");
  const LABEL = { ok: "DATA OK", warn: "DATA ISSUE", bad: "DATA PROBLEM" };
  let H = null;
  function paintHealth() {
    if (!H) return;
    HB.className = `fb-health ${H.level}`;
    HB.querySelector("span").textContent = LABEL[H.level];
    pop.innerHTML = `<div class="hp-h"><b>Data health</b><span>${H.level === "ok" ? "Everything is loading and fresh." : "Some numbers may be stale; details below."}</span></div>
      ${H.rows.map((r) => `<div class="hp-r ${r.level}"><i></i><div><b>${esc(r.label)}</b><span>${esc(r.detail || "")}</span></div><em>${esc(r.ago)}</em></div>`).join("")}
      <p class="hp-f">Green: fresh. Amber: a source failed or is late, so the app is showing its last good copy. Red: no data or very old. Sources retry on their own; ⌘R refreshes news and quotes now.</p>`;
  }
  HB.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelector(".fb-ipop")?.setAttribute("hidden", "");
    pop.hidden = !pop.hidden; HB.setAttribute("aria-expanded", String(!pop.hidden));
    if (!pop.hidden) { const r = HB.getBoundingClientRect(); pop.style.top = `${r.bottom + 6}px`; pop.style.right = `${Math.max(8, innerWidth - r.right)}px`; }
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) { pop.hidden = true; HB.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { pop.hidden = true; HB.setAttribute("aria-expanded", "false"); } });
  // ---------- alerts inbox (src/inbox.js) ----------
  const ipop = document.createElement("div");
  ipop.className = "fb-hpop fb-ipop"; ipop.hidden = true; ipop.setAttribute("role", "dialog"); ipop.setAttribute("aria-label", "Alerts inbox");
  document.body.append(ipop);
  const BB = bar.querySelector("#fbBell");
  const KIND = { news: "NEWS", watchlist: "WATCHLIST", monitor: "RISK", release: "DATA", earnings: "EARNINGS", screen: "SCREEN", other: "ALERT" };
  let IB = { items: [], unread: 0 }, ikind = "";
  const when = (t) => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
  function paintInbox() {
    BB.classList.toggle("on", IB.unread > 0);
    bar.querySelector("#fbBellN").textContent = IB.unread ? (IB.unread > 99 ? "99+" : IB.unread) : "";
    const kinds = [...new Set(IB.items.map((i) => i.kind))];
    const list = IB.items.filter((i) => !ikind || i.kind === ikind).slice(0, 120);
    ipop.innerHTML = `<div class="hp-h"><b>Alerts</b><span>${IB.items.length ? `${IB.unread} unread of ${IB.items.length}` : "Nothing yet. Alerts appear here as Tickerkite sends them."}</span></div>
      ${kinds.length > 1 ? `<div class="ib-k"><button type="button" data-ik="" aria-pressed="${!ikind}">ALL</button>${kinds.map((k) => `<button type="button" data-ik="${esc(k)}" aria-pressed="${ikind === k}">${KIND[k] || k.toUpperCase()}</button>`).join("")}</div>` : ""}
      <div class="ib-l">${list.map((i) => `<button type="button" class="ib-i${i.read ? "" : " un"}" data-ib="${esc(i.id)}"${i.page || i.story || i.sym ? "" : ' data-noopen="1"'}><span class="ib-m"><em>${KIND[i.kind] || "ALERT"}</em><time>${esc(when(i.at))}</time></span><b>${esc(i.title)}</b>${i.body ? `<span>${esc(i.body)}</span>` : ""}</button>`).join("")}</div>
      ${IB.items.length ? `<div class="ib-f"><button type="button" data-ia="read">MARK ALL READ</button><button type="button" data-ia="clear">CLEAR</button></div>` : ""}`;
  }
  BB.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = true; HB.setAttribute("aria-expanded", "false");
    ipop.hidden = !ipop.hidden; BB.setAttribute("aria-expanded", String(!ipop.hidden));
    if (!ipop.hidden) { const r = BB.getBoundingClientRect(); ipop.style.top = `${r.bottom + 6}px`; ipop.style.right = `${Math.max(8, innerWidth - r.right)}px`; }
  });
  ipop.addEventListener("click", (e) => {
    e.stopPropagation();
    const k = e.target.closest("[data-ik]"); if (k) { ikind = k.dataset.ik; paintInbox(); return; }
    const a = e.target.closest("[data-ia]");
    if (a) { window.wire.page.invoke(a.dataset.ia === "clear" ? "inbox:clear" : "inbox:read"); return; }
    const it = e.target.closest("[data-ib]"); if (!it) return;
    const item = IB.items.find((x) => x.id === it.dataset.ib); if (!item) return;
    window.wire.page.invoke("inbox:read", [item.id]);
    if (item.story) window.wire.showStory(item.story);
    else if (item.sym) window.WireApp?.openInstrument(item.sym);
    else if (item.page) window.WireApp?.setPage(item.page);
    if (item.story || item.sym || item.page) { ipop.hidden = true; BB.setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("click", (e) => { if (!ipop.hidden && !ipop.contains(e.target)) { ipop.hidden = true; BB.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ipop.hidden) { ipop.hidden = true; BB.setAttribute("aria-expanded", "false"); } });

  // ---------- update button (src/updater.js): shown when a newer version is on GitHub ----------
  const UB = bar.querySelector("#fbUpd");
  function paintUpdate(u) {
    UB.hidden = !u?.available;
    if (!u?.available) return;
    UB.disabled = !!u.busy;
    UB.textContent = u.busy ? "UPDATING…" : "UPDATE AVAILABLE";
    UB.title = u.busy ? "Downloading and installing; Tickerkite restarts when done" : `Version ${u.available.version} is ready (you have ${u.available.current}). Click to update.`;
  }
  UB.addEventListener("click", () => window.wire.page.invoke("update:apply").catch(() => {}));

  if (window.wire?.page) {
    window.wire.page.on("update:state", paintUpdate);
    window.wire.page.invoke("update:get").then(paintUpdate).catch(() => {});
    window.wire.page.on("inbox:update", (d) => { IB = d; paintInbox(); });
    window.wire.page.invoke("inbox:get").then((d) => { IB = d; paintInbox(); }).catch(() => {});
    window.wire.page.on("health:update", (h) => { H = h; paintHealth(); });
    window.wire.page.invoke("health:get").then((h) => { H = h; paintHealth(); }).catch(() => {});
  }

  const head = document.createElement("div");
  head.className = "phead";
  head.innerHTML = `<b class="ph-code" id="phCode">TOP</b><span class="ph-title" id="phTitle">TOP NEWS</span><span class="ph-status" id="phStatus"></span><span class="ph-pulled num" id="phPulled"></span><button type="button" class="ph-pop" id="phPop" title="Open this page in its own window (⌘⇧N) · Window › Tile Windows (⌘⌥T) arranges them">⧉ POP OUT</button>`;
  $(".main").prepend(head);
  head.querySelector("#phPop").addEventListener("click", () => window.wire?.popout(window.WireApp?.page?.() || "news"));

  const hint = document.createElement("span");
  hint.className = "khint"; hint.id = "khint";
  $(".status #pulled").before(hint);

  bar.querySelector(".fb-codes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-g]"); if (!b) return;
    const i = +b.dataset.g; window.WireApp?.setPage(lastIn[i] || GROUPS[i][1][0]);
  });
  sub.addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (b) window.WireApp?.setPage(b.dataset.p); });
  // ⌥ + letter jumps straight to a page (by physical key, so macOS Option characters don't interfere); the pages' own plain-letter keys stay free
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || !/^Key[A-Z]$/.test(e.code)) return;
    const t = e.target; if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const page = Object.keys(KEYS).find((p) => KEYS[p] === e.code.slice(3)); if (!page) return;
    e.preventDefault(); window.WireApp?.setPage(page);
  }, true);

  // ---------- paint ----------
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60e3);
    if (m < 1) return "JUST NOW";
    if (m < 60) return `${m} MINUTE${m === 1 ? "" : "S"} AGO`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} HOUR${h === 1 ? "" : "S"} AGO`;
    return `${Math.round(h / 24)} DAYS AGO`;
  }
  function paint() {
    const m = META[C.page] || META.news;
    const gi = groupOf(C.page);
    if (gi >= 0) lastIn[gi] = C.page;
    bar.querySelectorAll("button[data-g]").forEach((b) => b.setAttribute("aria-selected", String(+b.dataset.g === gi)));
    const pages = gi >= 0 ? GROUPS[gi][1] : [];
    sub.hidden = pages.length < 2;
    if (!sub.hidden && sub.dataset.g !== String(gi)) {
      sub.dataset.g = gi;
      sub.innerHTML = pages.map((p) => `<button type="button" role="tab" data-p="${p}" aria-selected="false" title="${esc(META[p].title.charAt(0) + META[p].title.slice(1).toLowerCase())} (⌥${KEYS[p]})"><b>${META[p].code}</b><i>${KEYS[p]}</i></button>`).join("");
    }
    sub.querySelectorAll("button[data-p]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.p === C.page)));
    $("#phCode").textContent = m.code;
    $("#phTitle").textContent = m.title;
    $("#phStatus").textContent = C.status[C.page] || "";
    const p = C.pulled[C.page];
    $("#phPulled").textContent = p == null ? "" : typeof p === "string" ? p : (C.page === "news" || C.page === "brief" ? "PULLED " : "DATA PULLED ") + ago(p);
    hint.textContent = m.hint + " · ⌘K GO TO";
  }
  function clock() {
    const d = new Date();
    const f = (o) => d.toLocaleString("en-US", { timeZone: "America/New_York", ...o });
    $("#fbClock").textContent = `${f({ weekday: "short" })} ${f({ day: "numeric" })} ${f({ month: "short" })} ${f({ hour: "2-digit", minute: "2-digit", hour12: false })} ET`.toUpperCase();
  }

  window.addEventListener("tk:page", (e) => { C.page = e.detail; paint(); });
  window.WireChrome = {
    /** ts: epoch ms of the page's data, or a ready-made string ("UPDATING…"); null clears it. */
    pulled(page, ts) { C.pulled[page] = ts || null; if (page === C.page) paint(); },
    status(page, text) { C.status[page] = text || ""; if (page === C.page) paint(); },
    codes: () => PAGES.map(([p, code]) => [code, p])
  };
  // the menu toggle (View › Switch Theme); after any switch the page redraws so tile colors follow the theme
  window.wire?.page?.on("theme:toggle", () => window.TkTheme.toggle());
  window.TkTheme?.onChange(() => { const a = window.WireApp; if (a) a.setPage(a.page()); });
  clock(); paint();
  setInterval(() => { clock(); paint(); }, 20e3);
})();
