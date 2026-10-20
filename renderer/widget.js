/* WIRE floating widget: top-ranked or latest headlines plus four key quotes. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const QUOTE_SYMS = ["^GSPC", "^IXIC", "^TNX", "BZ=F"];
  const SHORT = { "^GSPC": "SPX", "^IXIC": "NASDAQ", "^TNX": "UST 10Y", "BZ=F": "BRENT" };
  const COUNT = 15;
  const W = { stories: [], pulledAt: 0, refreshing: false, view: "top", quotes: [] };

  // same read list as the main window, so NEW clears in both places
  const READ_KEY = "wire.read.v1";
  const readSet = () => { try { return new Set(JSON.parse(localStorage.getItem(READ_KEY)) || []); } catch { return new Set(); } };
  function markRead(id) {
    const r = readSet(); if (r.has(id)) return;
    r.add(id);
    try { localStorage.setItem(READ_KEY, JSON.stringify([...r].slice(-5000))); } catch {}
  }
  window.addEventListener("storage", (e) => { if (e.key === READ_KEY) render(); });

  try { W.view = localStorage.getItem("wire.widget.view") === "latest" ? "latest" : "top"; } catch {}

  const fmtTime = (ts) => {
    const d = new Date(ts), now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  };

  function render() {
    document.querySelectorAll("#seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === W.view)));
    const now = Date.now();
    const pool = W.stories.filter((s) => s.kind === "news" && now - s.updated <= 24 * 3600e3);
    const list = (W.view === "top" ? [...pool].sort((a, b) => b.score - a.score) : [...pool].sort((a, b) => b.updated - a.updated)).slice(0, COUNT);
    const read = readSet();
    if (!list.length) {
      $("#list").innerHTML = `<li class="empty">${W.refreshing || !W.pulledAt ? "Pulling feeds…" : "No stories in the last 24 hours. Check your connection."}</li>`;
    } else {
      $("#list").innerHTML = list.map((s, i) => {
        const isNew = now - s.ts < 30 * 60e3 && !read.has(s.id);
        return `<li class="it" data-id="${esc(s.id)}" title="Click: open in WIRE · ⌥-click: open article">
          <span class="sev ${s.sev}"></span><span class="n">${i + 1}</span>
          <span class="h">${s.sev === "h" ? '<span class="badge hi">HI</span>' : ""}${isNew ? '<span class="badge nw">NEW</span>' : ""}${esc(s.title)}</span>
          <span class="meta"><span class="s">${esc(s.code)}</span><span>${esc(s.signal)}</span><span class="x">${s.sources.length > 1 ? "+" + (s.sources.length - 1) + " · " : ""}${fmtTime(s.updated)}</span></span></li>`;
      }).join("");
    }
    $("#fHigh").textContent = pool.filter((s) => s.sev === "h").length;
    $("#fAll").textContent = pool.length;
    renderPulled();
  }

  function renderPulled() {
    const el = $("#pulled");
    el.classList.toggle("busy", W.refreshing);
    if (W.refreshing) { el.textContent = "Updating…"; return; }
    if (!W.pulledAt) { el.textContent = "—"; return; }
    const m = Math.round((Date.now() - W.pulledAt) / 60000);
    el.textContent = m < 1 ? "Just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
  }

  function renderQuotes() {
    const by = new Map((W.quotes || []).map((q) => [q.sym, q]));
    $("#quotes").innerHTML = QUOTE_SYMS.map((sym) => {
      const q = by.get(sym);
      if (!q || q.last == null) return `<div class="qt" data-sym="${sym}" title="Open chart in WIRE"><span class="lb">${SHORT[sym]}</span><span class="px">—</span><span class="pc"></span></div>`;
      const up = q.chg >= 0;
      const px = q.type === "yld" ? q.last.toFixed(3) + "%" : q.last >= 1000 ? q.last.toLocaleString("en-US", { maximumFractionDigits: 0 }) : q.last.toFixed(2);
      const pc = q.type === "yld" ? `${up ? "+" : ""}${(q.chg * 100).toFixed(1)}bp` : `${up ? "+" : ""}${q.pct.toFixed(2)}%`;
      return `<div class="qt" data-sym="${sym}" title="Open chart in WIRE"><span class="lb">${SHORT[sym]}</span><span class="px">${px}</span><span class="pc ${up ? "up" : "dn"}">${pc}</span></div>`;
    }).join("");
  }

  // ---------- events ----------
  $("#seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    W.view = b.dataset.v;
    try { localStorage.setItem("wire.widget.view", W.view); } catch {}
    render(); $("#list").scrollTop = 0;
  });
  $("#list").addEventListener("click", (e) => {
    const li = e.target.closest(".it"); if (!li) return;
    const s = W.stories.find((x) => x.id === li.dataset.id); if (!s) return;
    markRead(s.id); render();
    if (e.altKey) api?.open(s.link); else api?.showStory(s.id);
  });
  $("#app").addEventListener("click", () => api?.showStory(null));
  $("#quotes").addEventListener("click", (e) => { const q = e.target.closest(".qt[data-sym]"); if (q) api?.showInstrument(q.dataset.sym); });
  $("#close").addEventListener("click", () => api?.widget.close());
  $("#refresh").addEventListener("click", () => api?.refresh());
  $("#pin").addEventListener("click", () => {
    const next = $("#pin").getAttribute("aria-pressed") !== "true";
    api?.widget.setOnTop(next);
  });
  const setPin = (v) => { $("#pin").setAttribute("aria-pressed", String(!!v)); $("#pin").title = v ? "Pinned above other windows. Click to put it back on the desktop." : "On the desktop. Click to pin it above other windows."; };

  // ---------- data ----------
  const applyNews = (d) => { if (!d) return; W.stories = d.stories || []; W.pulledAt = d.pulledAt || 0; W.refreshing = !!d.refreshing; render(); };
  const applyQuotes = (q) => { W.quotes = q || []; renderQuotes(); };

  renderQuotes();
  if (!api) { $("#list").innerHTML = `<li class="empty">Open this inside the WIRE app.</li>`; return; }
  api.onNews(applyNews);
  api.onQuotes(applyQuotes);
  api.widget.onOnTop(setPin);
  api.widget.state().then((s) => setPin(s.onTop));
  api.getNews().then(applyNews);
  api.getQuotes().then(applyQuotes);
  setInterval(renderPulled, 20000);
  setInterval(() => { if (!document.hidden) render(); }, 60000);
})();
