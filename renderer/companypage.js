/* Tickerkite Company page. Registers with app.js through window.WirePages (see the "pages" section there).
   Any US-listed stock: overview, financial statements, institutional holders, insider trades, SEC filings and
   Tickerkite's headlines about it. Open it from the command bar (⌘K, "AAPL FA") or WireCompanyPage.open(sym, tab).
   src/companypage.js does the fetching (SEC EDGAR, Nasdaq for holders, Yahoo for the price). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TABS = [["overview", "Overview"], ["financials", "Financials"], ["holders", "Holders"], ["insiders", "Insiders"], ["filings", "Filings"], ["news", "News"]];
  const C = { active: false, sym: null, tab: "overview", data: null, loading: false, err: null, chart: null, holders: null, insiders: null, news: null, period: "annual", onlyTrades: true, seq: 0 };
  try { C.sym = localStorage.getItem("wire.company.sym") || null; C.period = localStorage.getItem("wire.company.period") || "annual"; } catch {}
  const recent = () => { try { return JSON.parse(localStorage.getItem("wire.company.recent") || "[]"); } catch { return []; } };
  const remember = (sym, name) => { try { localStorage.setItem("wire.company.recent", JSON.stringify([{ sym, name }, ...recent().filter((r) => r.sym !== sym)].slice(0, 8))); localStorage.setItem("wire.company.sym", sym); } catch {} };

  // ---------- formatting ----------
  const money = (v, dp) => {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(dp ?? 2)}T`;
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(dp ?? (a >= 1e11 ? 0 : 1))}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(dp ?? 0)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
    return `${s}$${a.toFixed(0)}`;
  };
  const num = (v, dp = 2) => (v == null || !isFinite(v) ? "—" : (v < 0 ? "−" : "") + Math.abs(v).toFixed(dp));
  const pct = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%`);
  const count = (v) => (v == null ? "—" : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v)));
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const dLabel = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const pLabel = (end, q) => q ? new Date(end + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : `FY${end.slice(2, 4)}`;
  const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  const md = (iso) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: iso.slice(0, 4) === String(new Date().getFullYear()) ? undefined : "2-digit", timeZone: "UTC" }) : "");
  const fyEnd = (s) => (s && s.length === 4 ? new Date(`2000-${s.slice(0, 2)}-${s.slice(2)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "");

  // ---------- loading ----------
  function open(sym, tab) {
    sym = String(sym || "").toUpperCase().trim();
    if (!sym) return;
    if (tab && TABS.some(([k]) => k === tab)) C.tab = tab;
    if (sym !== C.sym || !C.data) { Object.assign(C, { sym, data: null, chart: null, holders: null, insiders: null, news: null, err: null }); }
    if (window.WireApp?.page() !== "company") window.WireApp.setPage("company");
    else if (C.data) { if (window.WireInstrument?.isOpen()) window.WireInstrument.close(); render(); renderDetail(); loadTab(); }
    else load();
  }
  function load(force) {
    if (!C.sym) { render(); renderDetail(); return; }
    const seq = ++C.seq, sym = C.sym;
    C.loading = true; render(); renderDetail();
    api.page.invoke("company:page", sym, !!force).then((d) => {
      if (seq !== C.seq) return;
      C.loading = false; C.data = d; C.err = d.ok ? null : d.error;
      if (d.ok) remember(sym, d.profile?.name || "");
      render(); renderDetail(); loadTab();
    });
    api.getInstrument(sym, "1Y").then((r) => { if (seq === C.seq && r?.ok) { C.chart = r.data; if (C.tab === "overview") render(); renderDetail(); } });
  }
  function loadTab() {
    const sym = C.sym, d = C.data;
    if (!d?.ok) return;
    if ((C.tab === "news" || C.tab === "overview") && !C.news) api.page.invoke("company:news", sym, d.profile?.name || "").then((n) => { if (sym === C.sym) { C.news = n; render(); } });
    if (C.tab === "holders" && !C.holders && d.sec) api.page.invoke("company:holders", sym).then((h) => { if (sym === C.sym) { C.holders = h; render(); } });
    if (C.tab === "insiders" && !C.insiders && d.sec && !d.needContact) { C.insiders = { loading: true }; render(); api.page.invoke("company:insiders", sym).then((r) => { if (sym === C.sym) { C.insiders = r; render(); } }); }
  }

  // ---------- pieces ----------
  function priceChart(pts, w = 760, h = 200) {
    if (!pts || pts.length < 2) return `<div class="co-chart-empty">Loading chart…</div>`;
    const ys = pts.map((p) => p.c), lo0 = Math.min(...ys), hi0 = Math.max(...ys), pad = (hi0 - lo0) * 0.08 || 1, lo = lo0 - pad, hi = hi0 + pad;
    const X = (i) => (i / (pts.length - 1)) * w, Y = (v) => h - ((v - lo) / (hi - lo)) * h;
    const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.c).toFixed(1)}`).join(" ");
    const up = ys[ys.length - 1] >= ys[0], col = up ? "var(--up)" : "var(--down)";
    const first = new Date(pts[0].t), last = new Date(pts[pts.length - 1].t);
    return `<div class="co-chart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="One-year price chart"><polygon points="0,${h} ${line} ${w},${h}" fill="${col}" opacity=".1"/><polyline points="${line}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>
      <span class="co-cy t">${num(hi0)}</span><span class="co-cy b">${num(lo0)}</span></div>
      <div class="co-cx"><span>${first.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span><span>1 year · <b class="${up ? "up" : "dn"}">${pct(ys[ys.length - 1] / ys[0] - 1)}</b></span><span>${last.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>`;
  }
  function bars(rows) {
    const rs = rows.filter((r) => r.revenue != null);
    if (rs.length < 2) return "";
    const max = Math.max(...rs.map((r) => Math.max(r.revenue, Math.abs(r.netIncome || 0))));
    return `<div class="co-bars">${rs.map((r) => `<div class="co-bar" title="${pLabel(r.end)}: revenue ${money(r.revenue)}, net income ${money(r.netIncome)}">
      <div class="co-bw"><i class="rev" style="height:${(r.revenue / max) * 100}%"></i><i class="ni ${r.netIncome < 0 ? "neg" : ""}" style="height:${(Math.abs(r.netIncome || 0) / max) * 100}%"></i></div><span>${pLabel(r.end)}</span></div>`).join("")}</div>
      <div class="co-legend"><span><i class="rev"></i>Revenue</span><span><i class="ni"></i>Net income</span></div>`;
  }
  function newsList(items, max = 25) {
    if (!items) return `<p class="none">Loading headlines…</p>`;
    if (!items.length) return `<p class="none">No headlines about ${esc(C.sym)} in Tickerkite's current news (the last 3 days).</p>`;
    return items.slice(0, max).map((s) => `<button type="button" class="co-story" data-sid="${esc(s.id)}" data-url="${esc(s.link || "")}"><span class="h">${s.sev === "h" ? '<span class="badge hi">HI</span>' : ""}${esc(s.title)}</span><span class="dim">${esc(s.code)} · ${new Date(s.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></button>`).join("");
  }
  const contactForm = () => `<div class="co-contact"><h3>One-time setup</h3><p>The SEC asks apps that read its filings to include a contact email in each request. Tickerkite sends it only to sec.gov, in the request header.</p>
    <form class="cform" id="cocontact"><input type="email" placeholder="you@example.com" aria-label="Contact email for SEC requests" required><button type="submit">Save</button><span class="dim"></span></form></div>`;

  // ---------- tabs ----------
  function overview(d) {
    const s = d.summary, v = d.valuation || {}, p = d.profile || {};
    const stats = s ? [
      ["Market cap", money(v.mcap)], ["P/E (TTM)", v.pe != null ? num(v.pe, 1) : s.ttm.eps != null && s.ttm.eps <= 0 ? "loss" : "—"], ["Price / sales", v.ps != null ? num(v.ps, 1) : "—"],
      ["Revenue (TTM)", money(s.ttm.revenue)], ["Net income (TTM)", money(s.ttm.netIncome)], ["EPS (TTM)", s.ttm.eps != null ? "$" + num(s.ttm.eps) : "—"],
      ["Gross margin", pct(s.ttm.grossMargin)], ["Operating margin", pct(s.ttm.opMargin)], ["Cash", money(s.balance.cash)], ["Debt", money(s.balance.debt)]
    ] : [];
    const pr = v.peRange;
    return `${priceChart(C.chart?.points)}
      ${s ? `<div class="co-stats">${stats.map(([k, x]) => `<div><span>${k}</span><b>${x}</b></div>`).join("")}</div>
      ${pr ? `<p class="co-note">P/E is in the <b>${ordinal(Math.round(pr.pct * 100))} percentile</b> of its own 5-year range (${num(pr.min, 0)}–${num(pr.max, 0)}, median ${num(pr.median, 0)}).</p>` : ""}
      <div class="co-sec">Revenue and net income by fiscal year</div>${bars(d.statements.annual)}` : `<p class="co-note">${esc(d.reason || "No SEC financials for this symbol.")}</p>`}
      <div class="co-sec">Latest headlines</div>${newsList(C.news, 5)}`;
  }

  const LINES = [
    ["Income statement"], ["Revenue", "revenue", "money"], ["  Growth", "revenue", "growth"], ["Gross profit", "grossProfit", "money"], ["  Gross margin", "grossProfit", "margin"],
    ["R&D", "rnd", "money"], ["Operating income", "opIncome", "money"], ["  Operating margin", "opIncome", "margin"], ["Net income", "netIncome", "money"], ["  Net margin", "netIncome", "margin"], ["EPS (diluted)", "eps", "eps"],
    ["Cash flow", null, null, "annual"], ["Operating cash flow", "ocf", "money", "annual"], ["Capital spending", "capex", "money", "annual"], ["Free cash flow", "fcf", "money", "annual"], ["Dividends paid", "dividends", "money", "annual"], ["Buybacks", "buybacks", "money", "annual"],
    ["Balance sheet"], ["Cash", "cash", "money"], ["Total debt", "debt", "money"], ["Total assets", "assets", "money"], ["Total liabilities", "liabilities", "money"], ["Shareholders' equity", "equity", "money"]
  ];
  function financials(d) {
    if (!d.sec || !d.statements?.annual?.length) return `<p class="co-note">${esc(d.reason || "No financial statements in this company's SEC filings (foreign companies file 20-F reports, which aren't in the same format).")}</p>`;
    const q = C.period === "quarterly";
    const rows = q ? d.statements.quarterly : d.statements.annual;
    const back = q ? 4 : 1;
    const cell = (r, i, key, kind) => {
      const v = r[key];
      if (kind === "money") return v == null ? "—" : money(v);
      if (kind === "eps") return v == null ? "—" : num(v);
      if (kind === "margin") return v == null || !r.revenue ? "—" : pct(v / r.revenue);
      if (kind === "growth") { const p = rows[i - back]?.[key]; return v == null || !p ? "—" : `<span class="${cls(v - p)}">${pct(v / p - 1)}</span>`; }
      return "";
    };
    const head = `<tr><th></th>${rows.map((r) => `<th>${pLabel(r.end, q)}</th>`).join("")}</tr>`;
    const body = LINES.filter((l) => !(q && l[3] === "annual")).map(([label, key, kind]) => !key
      ? `<tr class="co-fs-h"><td colspan="${rows.length + 1}">${label}</td></tr>`
      : `<tr class="${label.startsWith("  ") ? "co-fs-sub" : ""}"><td>${esc(label.trim())}</td>${rows.map((r, i) => `<td>${cell(r, i, key, kind)}</td>`).join("")}</tr>`).join("");
    return `<div class="co-fs-bar"><span class="co-seg">${[["annual", "Annual"], ["quarterly", "Quarterly"]].map(([k, l]) => `<button type="button" data-period="${k}" aria-pressed="${C.period === k}">${l}</button>`).join("")}</span>
        <span class="dim">${q ? "Quarters by period end. Cash flow is reported year-to-date in quarterly filings, so it's shown annually only." : "Fiscal years. Growth is year over year."}</span></div>
      <div class="co-fs-wrap"><table class="co-fs num"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <p class="co-note">From the company's 10-K and 10-Q filings (SEC EDGAR XBRL). Per-share figures are adjusted for splits; restated numbers replace the originals.</p>`;
  }

  function holders() {
    const h = C.holders;
    if (!C.data.sec) return `<p class="co-note">${esc(C.data.reason)}</p>`;
    if (!h) return `<p class="none">Loading holders…</p>`;
    if (!h.ok) return `<p class="co-note">${esc(h.error)}</p>`;
    if (h.empty || !h.top?.length) return `<p class="co-note">No institutional holdings reported for ${esc(C.sym)}.</p>`;
    const inc = h.increased, dec = h.decreased;
    const tilt = inc && dec ? (inc.shares > dec.shares ? "More shares bought than sold" : "More shares sold than bought") : "";
    return `<div class="co-stats">
        <div><span>Owned by institutions</span><b>${h.pct != null ? h.pct.toFixed(1) + "%" : "—"}</b></div>
        <div><span>Institutions</span><b>${h.count != null ? h.count.toLocaleString() : "—"}</b></div>
        <div><span>Value held</span><b>${money(h.value)}</b></div>
        <div><span>Added to positions</span><b class="up">${inc ? inc.holders.toLocaleString() : "—"}</b><em>${inc ? count(inc.shares) + " shares" : ""}</em></div>
        <div><span>Cut positions</span><b class="dn">${dec ? dec.holders.toLocaleString() : "—"}</b><em>${dec ? count(dec.shares) + " shares" : ""}</em></div>
        <div><span>New · sold out</span><b>${h.newPos?.holders ?? "—"} · ${h.soldOut?.holders ?? "—"}</b></div></div>
      ${tilt ? `<p class="co-note"><b>${tilt}</b> by institutions in their latest quarterly filings.</p>` : ""}
      <div class="co-tw"><table class="co-tab co-hds num"><thead><tr><th>Holder</th><th>Shares</th><th>Change</th><th>Value</th><th>As of</th></tr></thead><tbody>${h.top.map((x) => `<tr><td>${esc(x.name)}</td><td>${count(x.shares)}</td><td class="${cls(x.change)}">${x.change == null ? "—" : `${x.change > 0 ? "+" : x.change < 0 ? "−" : ""}${count(Math.abs(x.change))} <em>${x.changePct != null ? (x.changePct > 0 ? "+" : "") + x.changePct.toFixed(1) + "%" : ""}</em>`}</td><td>${money(x.value)}</td><td class="dim">${esc(x.date ? md(new Date(x.date).toISOString().slice(0, 10)) : "")}</td></tr>`).join("")}</tbody></table></div>
      <p class="co-note">From institutions' quarterly 13F filings with the SEC, as compiled by Nasdaq. 13Fs are filed up to 45 days after each quarter, so these are a few months old.</p>`;
  }

  function insiders() {
    const d = C.data;
    if (!d.sec) return `<p class="co-note">${esc(d.reason)}</p>`;
    const r = C.insiders;
    if (!r || r.loading) return `<p class="none">Reading this year's Form 4 filings… (up to 40, a few per second)</p>`;
    if (r.needContact) return contactForm();
    if (!r.ok) return `<p class="co-note">${esc(r.error)}</p>`;
    const s = r.summary;
    const rows = r.filings.flatMap((f) => f.rows.map((x) => ({ ...x, owner: f.owner, role: f.role, url: f.url })))
      .filter((x) => !C.onlyTrades || x.code === "P" || x.code === "S").sort((a, b) => b.date.localeCompare(a.date));
    const verdict = s.buys && !s.sells ? "Insiders have only been buying." : s.sells && !s.buys ? "Insiders have only been selling." : s.buys || s.sells ? (s.buyValue > s.sellValue ? "More insider buying than selling." : "More insider selling than buying.") : "No open-market insider trades.";
    return `<div class="co-stats">
        <div><span>Bought, last 6 months</span><b class="${s.buys ? "up" : ""}">${money(s.buyValue)}</b><em>${s.buys} trade${s.buys === 1 ? "" : "s"} · ${s.buyers.length} insider${s.buyers.length === 1 ? "" : "s"}</em></div>
        <div><span>Sold, last 6 months</span><b class="${s.sells ? "dn" : ""}">${money(s.sellValue)}</b><em>${s.sells} trade${s.sells === 1 ? "" : "s"} · ${s.sellers.length} insider${s.sellers.length === 1 ? "" : "s"}</em></div>
        <div><span>Pre-planned sales</span><b>${s.sells ? Math.round((s.planSells / s.sells) * 100) + "%" : "—"}</b><em>under 10b5-1 plans</em></div></div>
      <p class="co-note"><b>${verdict}</b> Only open-market buys and sells count here: stock awards, option exercises and shares withheld for tax are pay, not a bet on the stock. Pre-planned (10b5-1) sales are scheduled months ahead and say less.</p>
      <div class="co-fs-bar"><label class="co-chk"><input type="checkbox" id="coonly" ${C.onlyTrades ? "checked" : ""}> Buys and sells only</label><span class="dim">${r.checked} filings from the last 12 months</span></div>
      ${rows.length ? `<div class="co-tw"><table class="co-tab co-ins num"><thead><tr><th>Date</th><th>Insider</th><th>Type</th><th>Shares</th><th>Price</th><th>Value</th><th>Owns after</th></tr></thead><tbody>${rows.slice(0, 120).map((x) => `<tr>
        <td class="dim">${esc(md(x.date))}</td><td><span class="co-who">${esc(x.owner)}</span><em>${esc(x.role)}</em></td>
        <td class="${x.code === "P" ? "up" : x.code === "S" ? "dn" : "dim"}">${esc(x.what)}${x.plan && x.code === "S" ? ' <em title="Pre-planned under a 10b5-1 plan">plan</em>' : ""}</td>
        <td>${count(x.shares)}</td><td>${x.price != null ? "$" + num(x.price) : "—"}</td><td>${money(x.value)}</td><td>${count(x.after)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="none">No ${C.onlyTrades ? "open-market buys or sells" : "transactions"} in the last 12 months.</p>`}
      <p class="co-note">From Form 4 filings on SEC EDGAR: insiders must report trades within two business days.</p>`;
  }

  function filings(d) {
    if (!d.sec || !d.filings?.length) return `<p class="co-note">${esc(d.reason || "No filings.")}</p>`;
    const what = { "10-K": "Annual report", "10-Q": "Quarterly report", "8-K": "Major event", "DEF 14A": "Proxy statement", "20-F": "Annual report (foreign)", "6-K": "Foreign filer report", "S-1": "Registration", "SC 13D": "5%+ stake, active", "SC 13G": "5%+ stake, passive", "S-3": "Shelf registration", "S-4": "Merger registration" };
    const items = { "2.02": "Results", "5.02": "Executive change", "1.01": "Agreement", "7.01": "Reg FD", "8.01": "Other events", "5.07": "Shareholder vote", "2.01": "Acquisition", "1.02": "Agreement ended", "2.03": "New debt" };
    return `<div class="co-tw"><table class="co-tab co-fil"><thead><tr><th>Filed</th><th>Form</th><th>What</th><th>Period</th></tr></thead><tbody>${d.filings.map((f) => `<tr class="co-link" data-url="${esc(f.url)}" title="Open on sec.gov">
      <td class="dim">${esc(md(f.date))}</td><td><b>${esc(f.form)}</b></td><td>${esc(what[f.form.replace(/\/A$/, "")] || f.desc || "")}${f.form === "8-K" && f.items ? `<em>${esc(f.items.split(",").map((i) => items[i.trim()] || i.trim()).join(", "))}</em>` : ""}${/\/A$/.test(f.form) ? " <em>amended</em>" : ""}</td><td class="dim">${esc(md(f.report))}</td></tr>`).join("")}</tbody></table></div>
      <p class="co-note">Click a filing to open it on sec.gov.</p>`;
  }

  // ---------- page ----------
  function render() {
    if (!C.active) return;
    const el = $("#company");
    if (!C.sym) {
      const rs = recent();
      el.innerHTML = `<div class="co"><div class="co-hello"><h2>Look up a company</h2><p>Type a ticker or name in the search bar above (or press <kbd>/</kbd>), or use <kbd>⌘K</kbd>. Add a code after the ticker to jump straight in:
        <b>FA</b> financials, <b>HDS</b> holders, <b>INSD</b> insiders, <b>CF</b> filings, for example <span class="co-ex">AAPL FA</span>.</p>
        <button type="button" class="open" data-cmdk>Search companies</button>
        ${rs.length ? `<div class="co-sec">Recently viewed</div><div class="co-recent">${rs.map((r) => `<button type="button" data-open="${esc(r.sym)}"><b>${esc(r.sym)}</b><span>${esc(r.name || "")}</span></button>`).join("")}</div>` : ""}</div></div>`;
      return;
    }
    const d = C.data;
    const name = d?.profile?.name || recent().find((r) => r.sym === C.sym)?.name || "";
    const q = d?.quote, ch = C.chart, prev = ch?.points?.[ch.points.length - 2]?.c; // yesterday's close (1Y chart is daily)
    const dayPct = q?.price != null && prev ? q.price / prev - 1 : null;
    const head = `<div class="co-head"><div><div class="co-sym">${esc(C.sym)}${d?.profile?.exchanges?.length ? ` <em>${esc(d.profile.exchanges[0])}</em>` : ""}</div><h2>${esc(name || C.sym)}</h2></div>
      <div class="co-px">${q?.price != null ? `<b>${num(q.price)}</b> <span class="dim">${esc(q.currency || "")}</span> ${dayPct != null ? `<span class="${cls(dayPct)}">${pct(dayPct, 2)}</span>` : ""}` : ""}</div></div>
      <nav class="co-tabs">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" aria-selected="${k === C.tab}">${l}</button>`).join("")}</nav>`;
    let body;
    if (C.loading && !d) body = window.WireUI.skeleton("rows", { n: 8, label: `Loading ${C.sym} from SEC EDGAR…` });
    else if (C.err) body = `<p class="co-note">${esc(C.err)}</p>`;
    else if (d?.needContact) body = contactForm();
    else if (d?.error) body = `<p class="co-note">${esc(d.error)}</p>`;
    else if (d) body = ({ overview, financials, holders, insiders, filings, news: () => newsList(C.news) })[C.tab](d);
    el.innerHTML = `<div class="co">${head}<div class="co-body">${body || ""}</div></div>`;
    const fs = el.querySelector(".co-fs-wrap"); if (fs) fs.scrollLeft = fs.scrollWidth; // latest period in view
  }

  function renderDetail() {
    if (!C.active || window.WireInstrument?.isOpen()) return;
    const el = $("#codetail"), d = C.data;
    if (!C.sym || !d?.ok) { el.innerHTML = C.sym && C.loading ? "" : `<p class="none">${C.sym ? "" : "Press ⌘K to look up any US-listed company."}</p>`; return; }
    const p = d.profile || {}, e = d.earnings;
    const inDays = e ? Math.round((Date.parse(e.date + "T12:00:00Z") - Date.now()) / 864e5) : null;
    const facts = d.sec && p.name ? [
      ["Industry", p.sic], ["Based in", p.city], ["Incorporated", p.state], ["Fiscal year ends", fyEnd(p.fiscalYearEnd)], ["Filer type", p.category],
      ["Next earnings", e ? `${dLabel(e.date)} <span class="dim">· ${inDays <= 0 ? "today" : `in ${inDays} days`} · ${e.estimated ? "estimated" : "confirmed"}</span>` : ""],
      ["Formerly", p.formerNames?.filter((n) => n.toUpperCase() !== p.name.toUpperCase()).slice(0, 2).join(", ")]
    ].filter(([, v]) => v) : [];
    el.innerHTML = `<div class="dhead"><span class="code">${esc(C.sym)}</span><span class="nm">${esc(d.sec ? "Company" : (d.quote?.type || "").toLowerCase())}</span></div>
      <h1>${esc(p.name || C.sym)}</h1>
      ${facts.length ? `<dl class="kv">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${k === "Next earnings" ? v : esc(v)}</dd>`).join("")}</dl>` : d.reason ? `<p>${esc(d.reason)}</p>` : ""}
      <div class="co-acts">
        <button type="button" class="open" data-chart>Open chart</button>
        ${d.watch ? `<span class="co-tag">★ On your watchlist</span>` : `<button type="button" class="co-ghost" data-watch>★ Add to watchlist</button>`}
        ${d.held ? `<span class="co-tag">In your portfolio</span>` : `<button type="button" class="co-ghost" data-port>Add to portfolio</button>`}
      </div>
      ${d.sec && d.cik ? `<p class="co-note">SEC CIK ${esc(d.cik)} · <button type="button" class="co-linkb" data-url="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${esc(d.cik)}">All filings on sec.gov ↗</button>${d.fetchedAt ? ` · data from ${new Date(d.fetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} <button type="button" class="co-linkb" data-reload>Refresh</button>` : ""}</p>` : ""}`;
  }

  // ---------- events ----------
  const onClick = (e) => {
    const t = e.target.closest("[data-tab]"); if (t) { C.tab = t.dataset.tab; render(); loadTab(); return; }
    const p = e.target.closest("[data-period]"); if (p) { C.period = p.dataset.period; try { localStorage.setItem("wire.company.period", C.period); } catch {} render(); return; }
    const o = e.target.closest("[data-open]"); if (o) return open(o.dataset.open);
    if (e.target.closest("[data-cmdk]")) return window.WireCommand?.open();
    if (e.target.closest("[data-chart]")) return window.WireApp.openInstrument(C.sym);
    if (e.target.closest("[data-reload]")) { C.holders = null; C.insiders = null; C.news = null; return load(true); }
    if (e.target.closest("[data-watch]")) { api.addWatch(C.sym).then((r) => { if (r.ok && C.data) { C.data.watch = true; renderDetail(); } }); return; }
    if (e.target.closest("[data-port]")) { const sym = C.sym; window.WireApp.setPage("portfolio"); setTimeout(() => { const i = $("#pfadd input[name=sym]"); if (i) { i.value = sym; $("#pfadd input[name=shares]")?.focus(); } }, 150); return; }
    const s = e.target.closest("[data-sid]"); if (s) { if (!window.WireInstrument.onStory?.(s.dataset.sid) && s.dataset.url) api.open(s.dataset.url); return; }
    const u = e.target.closest("[data-url]"); if (u && u.dataset.url) api.open(u.dataset.url);
  };
  // ---------- search bar (stays above the page, so typing survives re-renders) ----------
  const bar = document.createElement("div");
  bar.className = "co-search company-only";
  bar.innerHTML = `<form autocomplete="off"><input id="cosearch" type="search" spellcheck="false" placeholder="Search any company: ticker or name, e.g. NVDA or Microsoft  ( / )" aria-label="Search companies" aria-autocomplete="list" aria-controls="coresults"><button type="submit">Go</button></form><div class="co-results" id="coresults" role="listbox" hidden></div>`;
  $("#company").before(bar);
  const sIn = bar.querySelector("input"), sOut = bar.querySelector("#coresults");
  const S = { list: [], idx: 0, seq: 0, t: null };
  function drawResults() {
    sOut.hidden = !S.list.length;
    sOut.innerHTML = S.list.map((r, i) => `<button type="button" role="option" data-pick="${esc(r.sym)}" aria-selected="${i === S.idx}"><b>${esc(r.sym)}</b><span>${esc(r.name)}</span><em>${esc([r.kind, r.exch].filter(Boolean).join(" · "))}</em></button>`).join("");
  }
  function pick(sym) {
    S.list = []; drawResults(); sIn.value = ""; sIn.blur();
    if (sym) open(sym, C.tab);
  }
  sIn.addEventListener("input", () => {
    clearTimeout(S.t);
    const q = sIn.value.trim();
    if (!q) { S.list = []; drawResults(); return; }
    S.t = setTimeout(async () => {
      const seq = ++S.seq;
      const list = await api.page.invoke("cmd:search", q).catch(() => []);
      if (seq !== S.seq) return;
      S.list = (list || []).slice(0, 8); S.idx = 0; drawResults();
    }, 180);
  });
  sIn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (S.list.length) { S.idx = (S.idx + (e.key === "ArrowDown" ? 1 : S.list.length - 1)) % S.list.length; drawResults(); } }
    else if (e.key === "Escape") { e.preventDefault(); sIn.value = ""; S.list = []; drawResults(); sIn.blur(); }
    e.stopPropagation(); // keep page shortcuts (1–6, arrows) out of the search box
  });
  bar.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    // a highlighted suggestion wins; otherwise treat what was typed as a ticker
    pick(S.list[S.idx]?.sym || sIn.value.trim().split(/\s+/)[0]);
  });
  sOut.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-pick]"); if (b) { e.preventDefault(); pick(b.dataset.pick); } });
  sIn.addEventListener("blur", () => setTimeout(() => { S.list = []; drawResults(); }, 120));

  $("#company").addEventListener("click", onClick);
  $("#codetail").addEventListener("click", onClick);
  $("#company").addEventListener("change", (e) => { if (e.target.id === "coonly") { C.onlyTrades = e.target.checked; render(); } });
  $("#company").addEventListener("submit", async (e) => {
    if (e.target.id !== "cocontact") return;
    e.preventDefault();
    const r = await api.setSecContact(e.target.querySelector("input").value);
    if (!r.ok) { e.target.querySelector("span").textContent = r.error; return; }
    C.insiders = null; load(true);
  });

  (window.WirePages ||= {}).company = {
    show() { C.active = true; if (C.sym && !C.data) load(); else { render(); renderDetail(); loadTab(); } },
    hide() { C.active = false; },
    key(e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const i = TABS.findIndex(([k]) => k === C.tab);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); C.tab = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0]; render(); loadTab(); }
      else if (/^[1-6]$/.test(e.key) && !e.metaKey) { C.tab = TABS[+e.key - 1][0]; render(); loadTab(); }
      else if (e.key === "/" ) { e.preventDefault(); sIn.focus(); }
      else if ((e.key === "Enter" || e.key === "o") && C.sym) window.WireApp.openInstrument(C.sym);
    },
    restore() { renderDetail(); },
    detail: () => $("#codetail")
  };
  window.WireCompanyPage = { open };
})();
