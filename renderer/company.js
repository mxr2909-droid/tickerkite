/* Tickerkite company panel: fundamentals (SEC EDGAR), valuation and next earnings for watchlist stocks.
   instrument.js calls WireCompany.mount(el, sym) on every render; data is kept here per symbol. */
(() => {
  const api = window.wire;
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const C = new Map(); // sym -> { r, loading, at }
  const REFRESH_MS = 15 * 60e3; // valuation follows the price; fundamentals are cached 24h in main

  const money = (v) => {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
    return `${s}$${a.toFixed(0)}`;
  };
  const num = (v, dp = 2) => (v == null || !isFinite(v) ? "—" : (v < 0 ? "−" : "") + Math.abs(v).toFixed(dp));
  const pct = (v) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);
  const count = (v) => (v == null ? "—" : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`);
  const qLabel = (end) => new Date(end + "T12:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  const dLabel = (d) => new Date(d + "T12:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

  async function load(sym, force = false) {
    const c = C.get(sym) || {};
    c.loading = true; C.set(sym, c);
    const r = await api.getCompany(sym, force);
    Object.assign(c, { r, loading: false, at: Date.now() });
    const el = document.getElementById("icomp");
    if (el && el.dataset.sym === sym) paint(el, sym);
  }

  function mount(el, sym) {
    if (!el) return;
    el.dataset.sym = sym;
    const c = C.get(sym);
    if (!c || (!c.loading && Date.now() - c.at > REFRESH_MS)) load(sym);
    paint(el, sym);
  }

  function paint(el, sym) {
    const c = C.get(sym);
    const r = c?.r;
    if (r && !r.watch) { el.innerHTML = ""; return; }
    const head = `<div class="isec">COMPANY · ${esc(sym)}</div>`;
    if (!r) { el.innerHTML = `${head}<div class="iload">Loading SEC filings…</div>`; return; }
    if (!r.ok) { el.innerHTML = `${head}<p class="cnote">Couldn't load company data: ${esc(r.error)}</p>`; return; }
    const d = r.data;
    if (!d.sec) { el.innerHTML = `<p class="cnote">${esc(d.reason)}.</p>`; return; }
    if (d.needContact) {
      el.innerHTML = `${head}<p class="cnote">${esc(d.error)} Add one to load filings; Tickerkite sends it only to sec.gov, in the request header.</p>
        <form class="cform"><input type="email" placeholder="you@example.com" aria-label="Contact email for SEC requests" required><button type="submit">SAVE</button><span class="dim"></span></form>`;
      const f = el.querySelector("form");
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const s = await api.setSecContact(f.querySelector("input").value);
        if (!s.ok) { f.querySelector("span").textContent = s.error; return; }
        C.delete(sym); mount(el, sym);
      });
      return;
    }
    if (d.error) { el.innerHTML = `${head}<p class="cnote">${esc(d.error)}</p>`; return; }

    const v = d.valuation || {};
    const t = d.ttm;
    const e = d.earnings;
    const inDays = e ? Math.round((Date.parse(e.date + "T12:00Z") - Date.now()) / 864e5) : null;
    const pr = v.peRange;
    const rows = [
      ["Next earnings", e ? `${dLabel(e.date)} <span class="dim">· ${inDays <= 0 ? "today" : `in ${inDays} days`} · ${e.estimated ? `<b class="est">ESTIMATED</b> (${esc(e.source)})` : `confirmed (${esc(e.source)})`}</span>` : "—"],
      ["Market cap", money(v.mcap)],
      ["P/E (TTM)", v.pe != null ? num(v.pe, 1) + (pr ? ` <span class="dim">· 5y range ${num(pr.min, 0)}–${num(pr.max, 0)}, median ${num(pr.median, 0)} · now ${ordinal(Math.round(pr.pct * 100))} percentile</span>` : "") : t.eps != null && t.eps <= 0 ? `— <span class="dim">(loss-making)</span>` : "—"],
      ["Price / sales", v.ps != null ? num(v.ps, 1) : "—"],
      ["Revenue TTM", money(t.revenue)],
      ["Net income TTM", money(t.netIncome)],
      ["EPS TTM (dil.)", t.eps != null ? "$" + num(t.eps) : "—"],
      ["Margins TTM", `gross ${pct(t.grossMargin)} · operating ${pct(t.opMargin)}`],
      ["Cash · debt", `${money(d.balance.cash)} · ${money(d.balance.debt)} <span class="dim">at ${d.balance.end ? qLabel(d.balance.end) : "—"}</span>`],
      ["Shares out", count(d.shares?.val)]
    ];
    const qs = d.quarters.slice().reverse();
    el.innerHTML = `${head}
      <dl class="istats num">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join("")}</dl>
      <div class="isec">LAST ${qs.length} QUARTERS</div>
      <table class="ctab num"><thead><tr><th>Quarter</th><th>Revenue</th><th>Net inc.</th><th>EPS</th><th>Gross</th><th>Op.</th></tr></thead>
      <tbody>${qs.map((q) => `<tr><td>${qLabel(q.end)}${q.derived ? "*" : ""}</td><td>${money(q.revenue)}</td><td>${money(q.netIncome)}</td><td>${q.eps != null ? num(q.eps) : "—"}</td><td>${pct(q.grossMargin)}</td><td>${pct(q.opMargin)}</td></tr>`).join("")}</tbody></table>
      <p class="ifoot">Fundamentals from SEC EDGAR 10-Q/10-K filings, refreshed daily. Quarters are labelled by period end; * = fourth quarter, worked out as the annual figure minus the first nine months. Per-share figures are adjusted for splits. P/E uses the delayed price and trailing-twelve-month diluted EPS.</p>`;
  }

  window.WireCompany = { mount };
})();
