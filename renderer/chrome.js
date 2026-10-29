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
    ["markets", "WEI", "WORLD INDICES AND SECTORS", 4, "1–9 PERIOD · ↵ CHART · YAHOO FINANCE, DELAYED"],
    ["fed", "FED", "FED FUNDS PATH, MARKET-IMPLIED", 5, "↑↓ MOVE · R RELOAD · CME / FRED"],
    ["curve", "GC", "TREASURY YIELD CURVE", 8, "R RELOAD · US TREASURY"],
    ["graphs", "GP", "GRAPHS", 6, "/ ADD SERIES · ESC CANCEL TOOL"],
    ["portfolio", "PORT", "PORTFOLIO", 7, "↑↓ MOVE · ↵ CHART · ESC DESELECT"],
    ["company", "DES", "COMPANY", 9, "1–6 / ←→ TAB · ↵ CHART · / OR ⌘K LOOK UP"]
  ];
  const META = Object.fromEntries(PAGES.map((p) => [p[0], { code: p[1], title: p[2], digit: p[3], hint: p[4] }]));
  const C = { page: "news", pulled: {}, status: {} };

  // ---------- build ----------
  const bar = document.createElement("header");
  bar.className = "fbar";
  bar.innerHTML = `<div class="fb-logo" aria-hidden="true"><svg viewBox="0 0 148 90" width="26" height="16"><path fill="#F47321" d="M0 0H40V64C40 76 56 81 72 81V90C30 90 0 84 0 70Z"/><path fill="#005030" d="M148 0H108V64C108 76 92 81 76 81V90C118 90 148 84 148 70Z"/></svg><span>TICKER<br>KITE</span></div>
    <nav class="fb-codes" role="tablist" aria-label="Functions">${PAGES.map(([p, code, title, d]) =>
      `<button type="button" role="tab" data-p="${p}" aria-selected="false" title="${esc(title.charAt(0) + title.slice(1).toLowerCase())} (⌘⌥${d})">${code}</button>`).join("")}</nav>
    <span class="fb-clock num" id="fbClock"></span>`;
  $("#app").prepend(bar);

  const head = document.createElement("div");
  head.className = "phead";
  head.innerHTML = `<b class="ph-code" id="phCode">TOP</b><span class="ph-title" id="phTitle">TOP NEWS</span><span class="ph-status" id="phStatus"></span><span class="ph-pulled num" id="phPulled"></span><button type="button" class="ph-pop" id="phPop" title="Open this page in its own window (⌘⇧N) · Window › Tile Windows (⌘⌥T) arranges them">⧉ POP OUT</button>`;
  $(".main").prepend(head);
  head.querySelector("#phPop").addEventListener("click", () => window.wire?.popout(window.WireApp?.page?.() || "news"));

  const hint = document.createElement("span");
  hint.className = "khint"; hint.id = "khint";
  $(".status #pulled").before(hint);

  bar.querySelector(".fb-codes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]"); if (b) window.WireApp?.setPage(b.dataset.p);
  });

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
    bar.querySelectorAll("button[data-p]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.p === C.page)));
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
