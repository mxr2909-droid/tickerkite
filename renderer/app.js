/* Tickerkite renderer: draws the terminal from ranked stories sent by the main process. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TABS = [["TOP", "Top News"], ["US", "US Macro"], ["GLB", "Global"], ["FED", "Fed / Rates"], ["ERN", "Earnings"], ["NRG", "Energy"], ["ALL", "All"]];
  const DESK_NAMES = { US: "US MACRO", GLB: "GLOBAL", FED: "FED / RATES", ERN: "EARNINGS", NRG: "ENERGY / GEO" };
  const S = { stories: [], status: [], pulledAt: 0, refreshing: false, tab: "TOP", mode: "news", view: "all", q: "", src: "", hours: 24, topN: 3, sel: null, idx: 0, list: [], watch: [], quotes: [] };

  // ---------- read tracking: NEW clears once you open a story ----------
  const READ_KEY = "wire.read.v1";
  const read = new Set((() => { try { return JSON.parse(localStorage.getItem(READ_KEY)) || []; } catch { return []; } })());
  function markRead(s) {
    if (!s || read.has(s.id)) return;
    read.add(s.id);
    try { localStorage.setItem(READ_KEY, JSON.stringify([...read].slice(-5000))); } catch {}
    // the story can be listed twice (ranked + time ordered), so clear every copy
    document.querySelectorAll(`.row[data-id="${s.id}"] .badge.nw`).forEach((b) => b.remove());
  }

  // ---------- chrome ----------
  $("#tabs").insertAdjacentHTML("afterbegin", TABS.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === S.tab}">${l}</button>`).join(""));

  const fmtTime = (ts) => {
    const d = new Date(ts), now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  };
  const fmtLong = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  // ---------- filtering ----------
  function pool() {
    const now = Date.now(), win = S.hours * 3600e3, q = S.q;
    return S.stories.filter((s) =>
      s.kind === S.mode &&
      now - s.updated <= win &&
      (S.tab === "TOP" || S.tab === "ALL" || s.desks.includes(S.tab)) &&
      (S.view === "all" || (S.view === "high" ? s.sev === "h" : S.view === "watch" ? s.watch?.length > 0 : now - s.updated < 3600e3)) &&
      (!S.src || s.sources.some((x) => x.code === S.src)) &&
      (!q || [s.title, s.summary, s.code, s.publisher, s.signal, s.region, ...s.assets, ...(s.watch || []), ...s.sources.map((x) => x.name)].join(" ").toLowerCase().includes(q))
    );
  }

  // one outlet often posts a batch at once (a dozen NKA stories at 11:24): show the first few of a run
  // in time order and fold the rest under a "+N more from NKA" row you can open
  const RUN_MAX = 3;
  const expanded = new Set(); // run keys (code + first story id) the user opened
  function foldRuns(timed) {
    const out = [];
    for (let i = 0; i < timed.length; ) {
      let j = i;
      while (j < timed.length && timed[j].code === timed[i].code) j++;
      const run = timed.slice(i, j), key = run[0].code + ":" + run[0].id;
      if (run.length > RUN_MAX + 1 && !expanded.has(key)) {
        out.push(...run.slice(0, RUN_MAX).map((s) => ({ s })));
        out.push({ fold: { key, code: run[0].code, hidden: run.length - RUN_MAX } });
      } else out.push(...run.map((s) => ({ s })));
      i = j;
    }
    return out;
  }
  // NEW: published in the last 30 minutes and not opened yet. Undated feed items never count,
  // since their time is only when Tickerkite first saw them.
  const isNew = (s) => !s.undated && Date.now() - s.ts < 30 * 60e3 && !read.has(s.id);

  function render() {
    const p = pool();
    const ranked = [...p].sort((a, b) => b.score - a.score).slice(0, S.topN);
    const timed = foldRuns([...p].sort((a, b) => b.updated - a.updated));
    S.list = [...ranked, ...timed.filter((x) => x.s).map((x) => x.s)];
    let i = 0;
    const row = (s, top) => {
      i++;
      const extra = s.sources.length > 1 ? `<span class="x">+${s.sources.length - 1}</span>` : "";
      const sev = { h: "High", m: "Medium", l: "Low" }[s.sev];
      return `<button type="button" role="option" class="row sev-${s.sev}${top ? " top" : ""}" data-i="${i - 1}" data-id="${s.id}" aria-selected="false">
        <span class="n">${i})</span><span class="imp" title="Impact: ${sev} · ${s.score} of 100">${s.score}</span><span class="h">${s.watch?.length ? `<span class="badge wl">★ ${esc(s.watch.join(" "))}</span>` : ""}${isNew(s) ? '<span class="badge nw">NEW</span>' : ""}${esc(s.title)}${extra}</span>
        <span class="s">${esc(s.code)}</span><span class="t">${fmtTime(s.updated)}</span></button>`;
    };
    const fold = (f) => `<button type="button" class="fold" data-fold="${esc(f.key)}">+${f.hidden} more from ${esc(f.code)}</button>`;
    const UI = window.WireUI;
    if (!S.stories.length) {
      $("#list").innerHTML = S.refreshing || !S.pulledAt ? UI.skeleton("rows", { n: 14, label: "Pulling feeds…" })
        : UI.empty("No stories yet", "Check your connection, then press ⌘R.", `<button type="button" class="es-btn" data-refresh>Refresh</button>`);
    } else if (!p.length && S.view === "watch" && !S.watch.length) {
      $("#list").innerHTML = UI.empty("Your watchlist is empty", "Type a ticker like NVDA into <b>+ Add ticker</b> in the sidebar, and stories that mention it show up here.");
    } else if (!p.length && S.view === "watch") {
      $("#list").innerHTML = UI.empty("No watchlist stories", `Nothing in the last ${S.hours} hours mentions ${esc(S.watch.map((w) => w.sym).join(", "))}. Widen the time window or clear the search.`);
    } else if (!p.length) {
      $("#list").innerHTML = UI.empty("Nothing matches these filters", "Widen the time window, clear the search (Esc) or pick another tab.");
    } else {
      $("#list").innerHTML = ranked.map((s) => row(s, true)).join("") + `<div class="subhead">Time Ordered News</div>` + timed.map((x) => x.s ? row(x.s, false) : fold(x.fold)).join("");
    }

    $("#sHigh").textContent = p.filter((s) => s.sev === "h").length;
    $("#sShown").textContent = p.length;
    $("#sSrc").textContent = new Set(p.flatMap((s) => s.sources.map((x) => x.code))).size;
    const news = S.stories.filter((s) => s.kind === "news" && Date.now() - s.updated <= 24 * 3600e3);
    $("#cHigh").textContent = news.filter((s) => s.sev === "h").length;
    $("#cAll").textContent = news.length;
    $("#cNew").textContent = news.filter((s) => Date.now() - s.updated < 3600e3).length;
    $("#cWatch").textContent = news.filter((s) => s.watch?.length).length;
    $("#pgView").textContent = { all: "All", high: "High", new: "1H", watch: "★ Watch" }[S.view];
    $("#more").textContent = S.topN > 3 ? "Less «" : "More »";

    let idx = S.list.findIndex((s) => s.id === S.sel);
    select(idx >= 0 ? idx : 0, false, false);
  }

  function renderSources() {
    const counts = new Map();
    for (const s of S.stories) for (const x of s.sources) counts.set(x.code, (counts.get(x.code) || 0) + 1);
    const opts = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    const cur = S.src;
    $("#src").innerHTML = `<option value="">Sources</option>` + opts.map(([c, n]) => `<option value="${esc(c)}"${c === cur ? " selected" : ""}>${esc(c)} (${n})</option>`).join("");
  }

  function renderFeeds() {
    const ok = S.status.filter((f) => f.ok).length;
    const bad = S.status.filter((f) => !f.ok);
    $("#feeds").innerHTML = S.status.length
      ? `${ok}/${S.status.length} feeds live` + (bad.length ? `<div class="bad">${bad.map((f) => esc(f.name) + " · " + esc(f.error)).join("<br>")}</div>` : "")
      : "Waiting for first pull";
  }

  function renderPulled() {
    const el = $("#pulled");
    el.classList.toggle("busy", S.refreshing);
    if (S.refreshing) { el.textContent = "Updating…"; return; }
    if (!S.pulledAt) { el.textContent = "Not updated yet"; return; }
    const m = Math.round((Date.now() - S.pulledAt) / 60000);
    el.textContent = m < 1 ? "Updated just now" : m < 60 ? `Updated ${m}m ago` : `Updated ${Math.round(m / 60)}h ago`;
  }

  // ---------- detail ----------
  // the publisher's domain ("nikkei.com"), never a Google News redirect; the publisher's name when there's no domain
  function siteName(s) {
    const host = s.site || (() => { try { return new URL(s.link).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    return host && !/(^|\.)news\.google\.com$/.test(host) ? host : s.publisher;
  }
  // byUser: true when you clicked or arrowed to it (marks it read); false for automatic selection on load/refresh
  function select(i, scroll = true, byUser = true) {
    const s = S.list[i];
    document.querySelectorAll(".row").forEach((r) => r.setAttribute("aria-selected", String(+r.dataset.i === i)));
    if (scroll) document.querySelector(`.row[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
    const Inst = window.WireInstrument;
    if (Inst?.isOpen()) {
      // background refreshes keep the chart on screen; choosing a story yourself goes back to stories
      if (!byUser) { if (s) { S.sel = s.id; S.idx = i; } return; }
      Inst.close();
    }
    if (!s) {
      $("#detail").innerHTML = !S.stories.length && (S.refreshing || !S.pulledAt) ? window.WireUI.skeleton("detail")
        : window.WireUI.empty("No story selected", "Pick a headline on the left. ↑ ↓ move, Enter opens it.");
      S.sel = null; return;
    }
    S.sel = s.id; S.idx = i;
    if (byUser) markRead(s);
    const others = s.sources.slice(1);
    $("#detail").innerHTML = `
      <div class="dhead"><span class="code">${esc(s.code)}</span><span class="nm">${esc(s.publisher)}</span><span class="dt">${fmtLong(s.ts)}</span></div>
      <h1>${esc(s.title)}</h1>
      ${s.summary ? `<p>${esc(s.summary)}</p>` : `<p class="none">The feed carries no summary for this story. Open it for the full text.</p>`}
      <dl class="kv">
        <dt>Why it matters</dt><dd>${esc(s.why)}</dd><hr>
        <dt>Impact</dt><dd>${{ h: "High", m: "Medium", l: "Low" }[s.sev]} · ${s.score}<span class="meter"><i style="width:${s.score}%"></i></span></dd>
        <dt>Signal</dt><dd>${esc(s.signal)}</dd>
        <dt>Region</dt><dd>${esc(s.region)}</dd>
        <dt>Desk</dt><dd>${s.desks.map((d) => DESK_NAMES[d] || d).join(" / ")}</dd>
        ${s.watch?.length ? `<dt>Watchlist</dt><dd>★ ${s.watch.map((sym) => esc(sym)).join("  ·  ")}</dd>` : ""}
        <dt>Assets</dt><dd>${s.assets.length ? s.assets.map(esc).join("  ·  ") : "—"}</dd>
        <dt>Coverage</dt><dd>${s.sources.length} outlet${s.sources.length > 1 ? "s" : ""}</dd>
        <dt>Confidence</dt><dd>${s.conf.toFixed(2)}</dd>
      </dl>
      <div class="openrow"><button type="button" class="open" data-url="${esc(s.link)}" title="${esc(s.link)}">Open story <span>›</span></button>
        <span class="url" title="${esc(s.link)}">${esc(siteName(s))}</span><button type="button" class="copy" data-copy="${esc(s.link)}" title="Copy link">Copy link</button></div>
      ${others.length ? `<div class="cov"><div class="lbl">Also reported by</div>${others.map((x) => `<button type="button" data-url="${esc(x.link)}"><span class="c">${esc(x.code)}</span><span class="t">${esc(x.title)}</span></button>`).join("")}</div>` : ""}`;
  }

  // ---------- events ----------
  $("#list").addEventListener("click", (e) => {
    const f = e.target.closest("[data-fold]");
    if (f) { expanded.add(f.dataset.fold); render(); return; }
    if (e.target.closest("[data-refresh]")) { api?.refresh(); return; }
    const r = e.target.closest(".row"); if (r) select(+r.dataset.i, false);
  });
  $("#list").addEventListener("dblclick", (e) => { const r = e.target.closest(".row"); if (r) openSel(); });
  $("#detail").addEventListener("click", (e) => {
    if (window.WireInstrument?.isOpen()) return; // the instrument view handles its own clicks
    const c = e.target.closest("[data-copy]");
    if (c) {
      navigator.clipboard?.writeText(c.dataset.copy).then(() => { c.textContent = "Copied"; setTimeout(() => { c.textContent = "Copy link"; }, 1500); }, () => {});
      return;
    }
    const b = e.target.closest("[data-url]"); if (b) api?.open(b.dataset.url);
  });

  // ---------- pages ----------
  // News lives here. Every other page registers itself in window.WirePages from its own script:
  //   { show(), hide(), key(e), restore(), detail: () => element for the right-hand pane }
  // and adds a #pages button (data-p), "<page>-only" elements, and a CSS rule hiding them elsewhere.
  const PAGES = (window.WirePages ||= {});
  PAGES.score = { show: () => window.WireScore.show(), hide: () => window.WireScore.hide(), key: (e) => window.WireScore.key(e), restore: () => window.WireScore.restore(), detail: () => $("#sdetail") };
  S.page = "news";
  function setPage(p) {
    if (p !== "news" && !PAGES[p]) return;
    if (window.WireInstrument.isOpen()) window.WireInstrument.close();
    PAGES[S.page]?.hide?.();
    S.page = p;
    $("#app").dataset.page = p;
    document.querySelectorAll("#pages button[data-p]").forEach((b) => { b.setAttribute("aria-selected", String(b.dataset.p === p)); if (b.getAttribute("role") === "menuitemradio") b.setAttribute("aria-checked", String(b.dataset.p === p)); });
    // a group shows the page you're on ("Curve ▾") and lights up; otherwise its own name
    document.querySelectorAll("#pages .pgrp").forEach((g) => {
      const on = g.querySelector(`[data-p="${p}"]`);
      g.querySelector(".gbtn").setAttribute("aria-current", String(!!on));
      g.querySelector(".gbtn span").textContent = on ? on.firstChild.textContent : g.dataset.g;
    });
    closeMenus();
    try { localStorage.setItem("wire.page", p); } catch {}
    if (PAGES[p]) PAGES[p].show?.();
    else select(S.idx, false, false);
  }
  window.WireApp = { setPage, openInstrument: (sym) => openInstrument(sym), page: () => S.page, stories: () => S.stories, quotes: () => S.quotes, watch: () => S.watch };
  // grouped pages open a small menu; ↑ ↓ move inside it, Esc or a click elsewhere closes it
  function closeMenus(except) {
    document.querySelectorAll("#pages .pgrp").forEach((g) => {
      if (g === except) return;
      g.querySelector(".gmenu").hidden = true; g.querySelector(".gbtn").setAttribute("aria-expanded", "false");
    });
  }
  function toggleMenu(g, focusFirst) {
    const m = g.querySelector(".gmenu"), open = m.hidden;
    closeMenus(g);
    m.hidden = !open; g.querySelector(".gbtn").setAttribute("aria-expanded", String(open));
    if (open && focusFirst) (m.querySelector('[aria-selected="true"]') || m.querySelector("button")).focus();
  }
  $("#pages").addEventListener("click", (e) => {
    const gb = e.target.closest(".gbtn");
    if (gb) { toggleMenu(gb.parentElement, e.detail === 0); return; } // keyboard activation focuses the menu
    const b = e.target.closest("button[data-p]"); if (b) setPage(b.dataset.p);
  });
  $("#pages").addEventListener("keydown", (e) => {
    const g = e.target.closest(".pgrp");
    if (!g || e.metaKey) return; // keys inside a group stay there, so Enter doesn't also open a story
    e.stopPropagation();
    const m = g.querySelector(".gmenu"), items = [...m.querySelectorAll("button")];
    if (e.key === "Escape") { closeMenus(); g.querySelector(".gbtn").focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (m.hidden) { toggleMenu(g, true); return; }
      const k = items.indexOf(e.target);
      items[k < 0 ? 0 : (k + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest("#pages .pgrp")) closeMenus(); });
  window.addEventListener("blur", () => closeMenus());

  // ---------- instrument view ----------
  const detailEl = () => PAGES[S.page]?.detail?.() || $("#detail");
  function openInstrument(sym) {
    window.WireInstrument.open(sym, detailEl());
    detailEl().scrollTop = 0;
  }
  function closeInstrument() {
    window.WireInstrument.close();
    if (PAGES[S.page]) PAGES[S.page].restore?.();
    else select(S.idx, false, false);
  }
  window.WireInstrument.onClose = closeInstrument;
  window.WireScore.init({ openInstrument });
  window.WireInstrument.onStory = (id) => {
    if (S.page !== "news") setPage("news");
    const i = S.list.findIndex((s) => s.id === id);
    if (i < 0) return false; // not in the current filter: open the article instead
    select(i);
    return true;
  };
  $("#quotes").addEventListener("click", (e) => { const q = e.target.closest(".q[data-sym]"); if (q) openInstrument(q.dataset.sym); });
  $("#watchq").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { e.stopPropagation(); removeWatch(rm.dataset.rm); return; }
    const q = e.target.closest(".q[data-sym]"); if (q) openInstrument(q.dataset.sym);
  });
  $("#watchq").addEventListener("keydown", (e) => {
    if (e.target.closest("[data-rm]")) return; // the × button handles its own Enter/Space
    const q = e.target.closest(".q[data-sym]");
    if (q && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openInstrument(q.dataset.sym); }
    else if (q && (e.key === "Backspace" || e.key === "Delete")) { e.preventDefault(); removeWatch(q.dataset.sym); }
  });
  function removeWatch(sym) {
    if (window.WireInstrument.current() === sym && !S.quotes.some((q) => !q.watch && q.sym === sym)) closeInstrument();
    S.watch = S.watch.filter((w) => w.sym !== sym); renderWatch();
    api?.removeWatch(sym);
  }
  $("#wform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#wadd"), msg = $("#werr");
    const sym = input.value.trim();
    if (!sym || !api) return;
    input.disabled = true; msg.className = "werr"; msg.textContent = "Checking " + sym.toUpperCase() + "…";
    const r = await api.addWatch(sym);
    input.disabled = false;
    if (r?.ok) {
      input.value = ""; msg.className = "werr ok"; msg.textContent = `Added ${r.entry.sym}${r.entry.name && r.entry.name !== r.entry.sym ? " · " + r.entry.name : ""}`;
      setTimeout(() => { if (msg.classList.contains("ok")) msg.textContent = ""; }, 3500);
    } else {
      msg.className = "werr"; msg.textContent = r?.error || "Couldn't add that ticker.";
    }
    input.focus();
  });
  $("#quotes").addEventListener("keydown", (e) => { const q = e.target.closest(".q[data-sym]"); if (q && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openInstrument(q.dataset.sym); } });
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]"); if (!b) return;
    S.tab = b.dataset.k; document.querySelectorAll("#tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    S.sel = null; render(); $("#list").scrollTop = 0;
  });
  $("#mode").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.mode = b.dataset.m; document.querySelectorAll("#mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    S.sel = null; render();
  });
  document.querySelectorAll(".sitem[data-view]").forEach((b) => b.addEventListener("click", () => {
    S.view = b.dataset.view; document.querySelectorAll(".sitem[data-view]").forEach((x) => x.setAttribute("aria-current", String(x === b)));
    S.sel = null; render();
  }));
  $("#more").addEventListener("click", () => { S.topN = S.topN > 3 ? 3 : 10; render(); });
  $("#src").addEventListener("change", (e) => { S.src = e.target.value; S.sel = null; render(); });
  $("#win").addEventListener("change", (e) => { S.hours = +e.target.value; render(); });
  $("#sform").addEventListener("submit", (e) => { e.preventDefault(); $("#q").blur(); });
  $("#q").addEventListener("input", (e) => { S.q = e.target.value.trim().toLowerCase(); S.sel = null; render(); });
  $("#refresh").addEventListener("click", () => api?.refresh());
  $("#widgetBtn").addEventListener("click", () => api?.widget?.toggle());
  // a story opened from the widget clears its NEW tag here too
  window.addEventListener("storage", (e) => {
    if (e.key !== READ_KEY) return;
    try { for (const id of JSON.parse(e.newValue) || []) read.add(id); } catch {}
    render();
  });

  function openSel() { const s = S.list[S.idx]; if (s) api?.open(s.link); }
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "q") { if (e.key === "Escape") { e.target.value = ""; S.q = ""; render(); e.target.blur(); } return; }
    if (e.target.id === "wadd") { if (e.key === "Escape") { e.target.value = ""; $("#werr").textContent = ""; e.target.blur(); } return; }
    if (e.target.tagName === "SELECT") return;
    const instOpen = window.WireInstrument.isOpen();
    if (instOpen && e.key === "Escape") { closeInstrument(); return; }
    if (instOpen && (e.key === "[" || e.key === "]")) { window.WireInstrument.cycleRange(e.key === "]" ? 1 : -1); return; }
    if (PAGES[S.page]) { PAGES[S.page].key?.(e); return; }
    if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
    else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); select(Math.min(S.list.length - 1, S.idx + 1)); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); select(Math.max(0, S.idx - 1)); }
    else if (e.key === "Enter" || e.key === "o") openSel();
    else if (e.key === "Escape") { S.q = ""; $("#q").value = ""; S.src = ""; $("#src").value = ""; render(); }
    else if (/^[1-7]$/.test(e.key) && !e.metaKey) document.querySelector(`#tabs button[data-k="${TABS[+e.key - 1][0]}"]`).click();
  });

  // ---------- quotes ----------
  function spark(vals, up) {
    if (!vals || vals.length < 2) return "";
    const min = Math.min(...vals), max = Math.max(...vals), r = max - min || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${13 - ((v - min) / r) * 12}`).join(" ");
    return `<svg viewBox="0 0 100 14" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${up ? "#3ecf8e" : "#f2706b"}" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function quoteRow(q, cur, watch = null) {
    const name = watch ? watch.name : q.label;
    const attrs = `class="q${watch ? " wq" : ""}${q.sym === cur ? " on" : ""}" data-sym="${esc(q.sym)}" tabindex="0" role="button" title="${esc(name)}: click for chart, momentum and drivers"`;
    const rm = watch ? `<button type="button" class="wx" data-rm="${esc(q.sym)}" title="Remove ${esc(q.sym)} from watchlist" aria-label="Remove ${esc(q.sym)} from watchlist">×</button>` : "";
    const nm = watch && watch.name && watch.name !== q.sym ? `<span class="nm">${esc(watch.name)}</span>` : "";
    if (q.last == null) return `<div ${attrs}><span class="lb">${esc(q.label)}</span><span class="px dim">—</span><span class="pc dim"></span>${nm}${rm}</div>`;
    const up = q.chg >= 0;
    const px = q.type === "yld" ? q.last.toFixed(3) + "%" : q.type === "fx" ? q.last.toFixed(q.last > 20 ? 2 : 4) : q.last >= 1000 ? q.last.toLocaleString("en-US", { maximumFractionDigits: 0 }) : q.last.toFixed(2);
    const pc = q.type === "yld" ? `${up ? "+" : ""}${(q.chg * 100).toFixed(1)}bp` : `${up ? "+" : ""}${q.pct.toFixed(2)}%`;
    return `<div ${attrs}><span class="lb">${esc(q.label)}</span><span class="px">${px}</span><span class="pc ${up ? "up" : "dn"}">${pc}</span>${nm}${spark(q.spark, up)}${rm}</div>`;
  }
  function renderQuotes(qs) {
    if (qs) S.quotes = qs;
    const cur = window.WireInstrument.current();
    const market = S.quotes.filter((q) => !q.watch);
    $("#quotes").innerHTML = market.length ? market.map((q) => quoteRow(q, cur)).join("") : `<div class="q dim">Loading quotes…</div>`;
    renderWatch();
  }
  // watchlist rows follow the saved list, so a ticker you just added shows before its first quote arrives
  function renderWatch() {
    const cur = window.WireInstrument.current();
    const by = new Map(S.quotes.filter((q) => q.watch).map((q) => [q.sym, q]));
    $("#watchq").innerHTML = S.watch.length
      ? S.watch.map((w) => quoteRow(by.get(w.sym) || { sym: w.sym, label: w.sym, last: null }, cur, w)).join("")
      : `<div class="wempty">Add tickers to follow their price and every story that mentions them.</div>`;
  }

  // ---------- data wiring ----------
  function applyNews(d) {
    if (!d) return;
    S.stories = d.stories || []; S.status = d.status || []; S.pulledAt = d.pulledAt || 0; S.refreshing = !!d.refreshing;
    if (d.watch) S.watch = d.watch;
    renderSources(); renderFeeds(); renderPulled(); renderWatch(); render();
  }

  if (!api) {
    $("#list").innerHTML = `<div class="empty">Run this page inside the Tickerkite app (npm start) to load live feeds.</div>`;
    return;
  }
  api.onNews(applyNews);
  api.onQuotes(renderQuotes);
  api.onSelect((id) => {
    setPage("news");
    S.view = "all"; S.mode = "news"; S.q = ""; $("#q").value = "";
    document.querySelectorAll(".sitem[data-view]").forEach((x) => x.setAttribute("aria-current", String(x.dataset.view === "all")));
    document.querySelectorAll("#mode button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.m === "news")));
    document.querySelector('#tabs button[data-k="TOP"]').click();
    const i = S.list.findIndex((s) => s.id === id); if (i >= 0) select(i); });
  api.onInstrument?.((sym) => openInstrument(sym));
  api.onPage?.(setPage);
  try { const p = localStorage.getItem("wire.page"); if (p && PAGES[p]) setPage(p); } catch {}
  api.getNews().then(applyNews);
  api.getQuotes().then(renderQuotes);
  setInterval(() => { renderPulled(); }, 20000);
  setInterval(() => { if (!document.hidden) render(); }, 60000); // keep NEW badges and time window current
})();
