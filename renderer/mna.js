/* Tickerkite M&A page. Registers with app.js through window.WirePages (see the "pages" section there).
   Deals for US-listed targets found in SEC filings (tender offers, merger proxies, going-private statements),
   with filters, headline numbers, a sortable deal table and the deal's filings on the right.
   src/mna.js downloads and folds the filings; renderer/mnastats.js does the filtering and arithmetic;
   window.TkMnaCharts (if loaded) draws the charts into #mna-charts.
   Snapshots arrive every few seconds while sizes are read, so the page is split into regions that are only
   replaced when their HTML changed, and never while one of their inputs has focus. */
(() => {
  const api = window.wire;
  const S = window.TkMnaStats;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAY = 864e5, PAGE = 60;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const day = (s) => (s ? new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
  const money = (v) => S.money(v);
  const chg = (v) => (v == null || !isFinite(v) ? "" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) >= 10 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`);
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");

  const P = { active: false, snap: null, F: S.defaults(), sort: { key: "date", dir: -1 }, limit: PAGE, sel: null, charts: true, v: null, chartSig: "", dirty: false, cache: {}, detailHTML: null, typing: 0 };
  try { const f = JSON.parse(localStorage.getItem("wire.mna.filters") || "null"); if (f && typeof f === "object") for (const k of Object.keys(P.F)) if (k !== "q" && typeof f[k] === typeof P.F[k]) P.F[k] = f[k]; } catch {}
  try { P.charts = localStorage.getItem("wire.mna.charts") !== "0"; } catch {}
  // the search text is not remembered: a forgotten search would silently hide deals next time
  const saveF = () => { try { const { q, ...rest } = P.F; localStorage.setItem("wire.mna.filters", JSON.stringify(rest)); } catch {} };
  const isDefault = () => { const d = S.defaults(); return Object.keys(d).every((k) => (k === "q" ? !P.F.q.trim() : P.F[k] === d[k])); };

  // plain-English words for the codes in the data
  const TYPE_WORDS = {
    Merger: "The target's shareholders vote to approve the sale.",
    "Tender offer": "The buyer offers to buy shares straight from shareholders, usually for cash, without a vote.",
    "Going private": "Insiders, management or a controlling holder buy out the public shareholders and delist the company.",
    "SPAC merger": "A listed blank-check company (a SPAC) merges with a private business, which becomes listed through it."
  };
  const STAGE_WORDS = {
    "Tender offer filed": "The offer has been made to shareholders. Offers usually stay open at least 20 business days.",
    "Preliminary proxy": "The first draft of the document shareholders vote on is filed; the SEC may comment before it is final.",
    "Vote scheduled": "The final proxy is out, so a shareholder meeting has a date.",
    "Going-private filing": "The buyout statement the SEC requires when insiders take a company private."
  };
  const FORMS = { "SC TO-T": "Tender offer statement", PREM14A: "Preliminary merger proxy", DEFM14A: "Final merger proxy", "SC 13E3": "Going-private statement" };
  const formWords = (f) => { const base = String(f).replace(/\/A$/, ""), w = FORMS[base] || base; return /\/A$/.test(f) ? `Amendment: ${w.charAt(0).toLowerCase() + w.slice(1)}` : w; };
  const SIZE_SHORT = { u100: "< $100M", "100m": "$100M–1B", "1b": "$1–10B", "10b": "$10B+", na: "Undisclosed" };
  const RANGE_WORDS = { "3M": "3 months", "6M": "6 months", "1Y": "12 months", "2Y": "2 years", "3Y": "3 years" };
  const COLS = [["date", "Date"], ["target", "Target"], ["buyer", "Buyer"], ["sector", "Sector"], ["industry", "Sub-sector"], ["type", "Type"], ["stage", "Stage"], ["value", "Size"]];

  const spanWords = (sp) => {
    if (P.F.range !== "custom" && RANGE_WORDS[P.F.range]) return RANGE_WORDS[P.F.range];
    const n = sp.days;
    return n < 45 ? `${n} days` : n < 700 ? `${Math.round(n / 30.44)} months` : `${+(n / 365.25).toFixed(1)} years`;
  };
  const dataStart = (now) => iso(now - (P.snap?.years || 3) * 365.25 * DAY);
  const findDeal = (id) => P.snap?.deals.find((d) => d.id === id) || null;

  // ---------- derived data, memoized per snapshot + filters (+ sort) ----------
  function view(now) {
    const key = iso(now) + JSON.stringify(P.F);
    if (P.v && P.v.snap === P.snap && P.v.key === key) return P.v;
    const all = P.snap.deals, deals = S.filter(all, P.F, now), prev = S.previous(all, P.F, now);
    return (P.v = { snap: P.snap, key, now, deals, prev, all: S.allTime(all, P.F), sum: S.summary(deals, prev), sp: S.span(P.F, now), sorted: null, sortKey: "" });
  }
  const sortVal = {
    date: (d) => d.date, target: (d) => d.target.name.toLowerCase(), buyer: (d) => (d.acquirers[0]?.name || "").toLowerCase(),
    sector: (d) => d.sector, industry: (d) => d.industry, type: (d) => d.type, stage: (d) => d.stage, value: (d) => d.value
  };
  function sorted(v) {
    const k = `${P.sort.key}:${P.sort.dir}`;
    if (v.sortKey === k) return v.sorted;
    const f = sortVal[P.sort.key] || sortVal.date, dir = P.sort.dir;
    // unknown sizes and unnamed buyers go last whichever way the column is sorted
    const blank = (x) => x == null || x === "";
    v.sorted = [...v.deals].sort((a, b) => {
      const x = f(a), y = f(b);
      if (blank(x) || blank(y)) return blank(x) - blank(y) || (a.date < b.date ? 1 : -1);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    });
    v.sortKey = k;
    return v.sorted;
  }

  // ---------- regions ----------
  /** Replace one region's HTML if it changed. A region holding the focused input is left alone (and redrawn on blur),
      unless `force`, which is for the control that just changed: it is redrawn and focus goes back to it. */
  function put(name, html, force) {
    const el = $(`#mna [data-r="${name}"]`);
    if (!el || P.cache[name] === html) return;
    const a = document.activeElement, inside = el.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
    if (inside && !force) { P.dirty = true; return; }
    const f = inside ? a.dataset.f : null;
    el.innerHTML = html; P.cache[name] = html;
    if (f) el.querySelector(`[data-f="${f}"]`)?.focus();
  }
  /** A whole-page state (loading, error, empty) instead of the regions. */
  function state(html) {
    const el = $("#mna");
    if (P.cache.state === html) return;
    el.innerHTML = html; P.cache = { state: html }; P.chartSig = "";
  }
  function shell() {
    const el = $("#mna");
    if (el.querySelector(".mna")) return;
    el.innerHTML = `<div class="mna">
      <div data-r="head"></div><div data-r="contact"></div>
      <div class="mna-bar"><div class="mna-q"><input id="mnaq" type="search" placeholder="Search target, buyer, ticker, industry" aria-label="Search deals" spellcheck="false" autocomplete="off"><kbd>/</kbd></div><div data-r="bar" class="mna-ctl"></div></div>
      <div data-r="tiles"></div>
      <div id="mna-charts"></div>
      <div data-r="table"></div></div>`;
    $("#mnaq").value = P.F.q;
    P.cache = {}; P.chartSig = "";
  }

  function head() {
    const s = P.snap, z = s.sizing || {};
    const when = s.fetchedAt ? new Date(s.fetchedAt) : null;
    const time = when ? when.toLocaleString("en-US", iso(when) === iso(Date.now()) ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    const status = s.loading ? "Loading filings…" : s.error ? `<span class="dn">${esc(s.error)}</span>` : when ? `Updated ${esc(time)}` : "";
    const sizes = z.active ? `Reading deal sizes from the filings: ${Number(z.left || 0).toLocaleString("en-US")} to go · known for ${z.known} of ${z.total}`
      : z.total && z.known < z.total && !s.needsContact ? `Sizes known for ${z.known} of ${z.total} deals; the rest don't state a value Tickerkite can read` : "";
    return `<div class="mna-head"><div class="mna-ttl"><h2>Mergers and acquisitions</h2>
        <p class="dim">US-listed targets, from SEC filings: tender offers, merger proxies and going-private statements</p>
        <p class="mna-st dim" role="status">${status}${sizes ? `<span class="mna-sz">${z.active ? '<i class="mna-spin"></i>' : ""}${esc(sizes)}</span>` : ""}</p></div>
      <div class="mna-hb"><button type="button" class="mna-btn" data-charts aria-pressed="${P.charts}" title="Show or hide the charts">Charts ${P.charts ? "on" : "off"}</button>
        <button type="button" class="mna-btn" data-ref ${s.loading ? "disabled" : ""} title="Check for new filings (r) · shift-click re-downloads all three years">${s.loading ? "Loading…" : "↻ Refresh"}</button></div></div>`;
  }

  function contact() {
    if (!P.snap.needsContact) return "";
    return `<form class="cform mna-contact" id="mnacontact" autocomplete="off"><span class="mna-cx"><b>Deal sizes need a contact email.</b> The SEC asks apps to say who is calling. Tickerkite sends this only to sec.gov.</span>
      <input type="email" name="email" placeholder="you@example.com" aria-label="Contact email for SEC requests" required><button type="submit">Save</button><span class="dim mna-cmsg" role="status"></span></form>`;
  }

  function seg(attr, cur, opts, label) {
    return `<div class="mna-seg" role="group" aria-label="${esc(label)}">${opts.map(([k, l, t]) => `<button type="button" data-${attr}="${esc(k)}" aria-pressed="${k === cur}"${t ? ` title="${esc(t)}"` : ""}>${esc(l)}</button>`).join("")}</div>`;
  }
  function bar(v) {
    const F = P.F, deals = P.snap.deals, now = v.now;
    const secN = {};
    for (const d of S.filter(deals, { ...F, sector: "", industry: "" }, now)) secN[d.sector] = (secN[d.sector] || 0) + 1;
    const secs = P.snap.sectors.filter((s) => secN[s] || s === F.sector);
    const inds = F.sector ? S.industries(S.filter(deals, { ...F, industry: "" }, now)) : [];
    if (F.industry && !inds.some(([n]) => n === F.industry)) inds.push([F.industry, 0]);
    const opt = (val, label, cur) => `<option value="${esc(val)}"${val === cur ? " selected" : ""}>${esc(label)}</option>`;
    const lo = dataStart(now), hi = iso(now), custom = F.range === "custom";
    return `<div class="mna-row1">
        ${seg("range", F.range, [...Object.keys(S.RANGES).map((k) => [k, k, `The last ${RANGE_WORDS[k]}`]), ["custom", "Custom", "Pick your own dates"]], "Date frame")}
        ${custom ? `<label class="mna-date">From <input type="date" data-f="from" min="${lo}" max="${hi}" value="${esc(F.from)}"></label><label class="mna-date">to <input type="date" data-f="to" min="${lo}" max="${hi}" value="${esc(F.to || hi)}"></label>` : ""}
        ${seg("status", F.status, [["", "All"], ["active", "In progress", "A deal filing in the last 90 days"], ["past", "Past", "No deal filing for 90 days: completed or abandoned"]], "Status")}
        ${isDefault() ? "" : `<button type="button" class="mna-btn mna-reset" data-reset title="Back to the last 12 months, every sector and size">Reset</button>`}</div>
      <div class="mna-row2">
        <select data-f="sector" aria-label="Sector">${opt("", "All sectors", F.sector)}${secs.map((s) => opt(s, `${s} (${secN[s] || 0})`, F.sector)).join("")}</select>
        <select data-f="industry" aria-label="Sub-sector"${inds.length ? "" : " disabled"}>${opt("", "All sub-sectors", F.industry)}${inds.map(([n, c]) => opt(n, `${n} (${c})`, F.industry)).join("")}</select>
        <select data-f="type" aria-label="Deal type">${opt("", "All types", F.type)}${S.TYPES.map((t) => opt(t, t, F.type)).join("")}</select>
        ${seg("size", F.size, [["", "Any size"], ...S.SIZES.map(([k, l]) => [k, SIZE_SHORT[k] || l, l])], "Deal size")}
        <label class="mna-chk" title="SPACs are listed shells that merge with a private company to take it public. They are left out unless you include them or pick the SPAC merger type."><input type="checkbox" data-f="spacs"${F.spacs ? " checked" : ""}> Include SPAC mergers</label></div>`;
  }

  function tiles(v) {
    const { cur, prev, nChg, valueChg, medianChg, bigChg, topSector, largest } = v.sum, sp = v.sp, n = cur.n;
    const words = `vs the ${spanWords(sp)} before`;
    // the window before must be inside the downloaded years, or the comparison is against a half-empty period
    const comparable = sp.prevFrom >= iso(Date.parse(dataStart(v.now)) - 7 * DAY);
    // sizes are read newest first, so compare values only once both periods are mostly sized
    const sized = (x) => !x.n || x.known / x.n >= 0.8;
    const valOk = comparable && sized(cur) && sized(prev);
    const known = n && cur.known < n ? `sizes known for ${cur.known} of ${n}` : "";
    const sub = (txt, c = "dim") => `<em class="${c}">${txt}</em>`;
    const delta = (txt, v2, ok) => (!comparable ? sub("no earlier data to compare") : !ok ? sub(known || "not enough sizes yet to compare") : txt ? sub(`${txt} ${words}`, cls(v2)) : sub(`none in the ${spanWords(sp)} before`));
    const big = !bigChg ? "same count" : `${bigChg > 0 ? "+" : "−"}${Math.abs(bigChg)}`;
    return `<div class="mna-tiles">
      <div class="mna-tile"><span>Deals announced</span><b>${n.toLocaleString("en-US")}</b>${delta(chg(nChg), nChg, true)}</div>
      <div class="mna-tile"><span>Total disclosed value</span><b>${cur.known ? money(cur.value) : "—"}</b>${valOk && known ? sub(known) : ""}${delta(chg(valueChg), valueChg, valOk)}</div>
      <div class="mna-tile"><span>Median deal size</span><b>${money(cur.median)}</b>${delta(chg(medianChg), medianChg, valOk)}</div>
      <div class="mna-tile" title="Deals valued at $1 billion or more"><span>Deals of $1B+</span><b>${cur.known ? cur.big : "—"}</b>${delta(bigChg ? `${big} deals` : big, bigChg, valOk)}</div>
      ${topSector ? `<button type="button" class="mna-tile" data-set="sector" data-v="${esc(topSector.name)}" title="Show only ${esc(topSector.name)}"><span>Busiest sector</span><b class="mna-tw">${esc(topSector.name)}</b>${sub(`${topSector.share.toFixed(0)}% of deals (${topSector.n})`)}</button>` : `<div class="mna-tile"><span>Busiest sector</span><b>—</b></div>`}
      ${largest ? `<button type="button" class="mna-tile" data-sel="${esc(largest.id)}" title="Show this deal"><span>Largest deal</span><b>${money(largest.value)}</b>${sub(esc(largest.target.name))}</button>` : `<div class="mna-tile"><span>Largest deal</span><b>—</b>${sub(known || "no sizes known yet")}</div>`}</div>`;
  }

  function row(d) {
    const tk = d.target.tickers[0], a = d.acquirers;
    const dot = d.active ? `<i class="mna-dot" title="In progress: a deal filing in the last 90 days"></i>` : "";
    const buyer = a.length ? `${esc(a[0].name)}${a.length > 1 ? ` <em class="dim">+${a.length - 1}</em>` : ""}` : `<span class="dimmer" title="This deal's filings don't name the buyer on the cover; open a filing to read it">—</span>`;
    return `<div class="mna-r" role="row" data-id="${esc(d.id)}" aria-selected="${d.id === P.sel}">
      <span class="c-date">${day(d.date)}${d.active ? '<i class="mna-dot n"></i>' : ""}</span>
      <span class="c-tgt"><b>${esc(d.target.name)}</b>${tk ? `<em class="mna-tk">${esc(tk)}</em>` : ""}</span>
      <span class="c-buy">${buyer}</span>
      <span class="c-sec"><button type="button" class="mna-cb" data-set="sector" data-v="${esc(d.sector)}" title="Show only ${esc(d.sector)}">${esc(d.sector)}</button></span>
      <span class="c-ind"><button type="button" class="mna-cb" data-set="industry" data-v="${esc(d.industry)}" data-sector="${esc(d.sector)}" title="Show only ${esc(d.industry)}">${esc(d.industry)}</button></span>
      <span class="c-typ">${esc(d.type)}</span>
      <span class="c-stg">${dot}${esc(d.stage)}</span>
      <span class="c-val">${d.value != null ? money(d.value) : '<span class="dimmer">—</span>'}</span></div>`;
  }
  function table(v) {
    const list = sorted(v);
    if (!list.length) {
      return window.WireUI.empty("No deals match these filters", P.snap.loading ? "Filings are still downloading; more may appear." : "Try a longer date frame, another sector or fewer filters.",
        isDefault() ? "" : `<button type="button" class="es-btn" data-reset>Reset filters</button>`);
    }
    const c = v.sum.cur;
    const head = COLS.map(([k, l]) => {
      const on = P.sort.key === k;
      return `<button type="button" class="c-${k === "industry" ? "ind" : k === "stage" ? "stg" : k === "value" ? "val" : k}" data-sort="${k}" aria-sort="${on ? (P.sort.dir > 0 ? "ascending" : "descending") : "none"}">${l}${on ? `<i>${P.sort.dir > 0 ? "▲" : "▼"}</i>` : ""}</button>`;
    }).join("");
    const shown = list.slice(0, P.limit), left = list.length - shown.length;
    return `<p class="mna-count"><b>${list.length.toLocaleString("en-US")} deal${list.length === 1 ? "" : "s"}</b> · ${c.known ? `${money(c.value)} disclosed` : "no sizes known yet"}${c.known && c.known < c.n ? ` <span class="dim">(sizes known for ${c.known})</span>` : ""}
        <span class="dim mna-keys">↑↓ select · Enter opens the filing · click a sector to filter</span></p>
      <div class="mna-t" role="grid" aria-label="Deals"><div class="mna-r mna-h" role="row">${head}</div>${shown.map(row).join("")}</div>
      ${left > 0 ? `<button type="button" class="mna-btn mna-more" data-more>Show ${Math.min(PAGE, left)} more <span class="dim">of ${left.toLocaleString("en-US")}</span></button>` : ""}`;
  }

  function dataSig(s) { return `${s.deals.length}:${s.sizing?.known}:${s.fetchedAt}:${s.loading}:${s.closings?.filter((x) => x[1] != null).length}:${s.spend?.length}`; }
  function charts(v) {
    const box = $("#mna-charts");
    if (!box) return;
    box.hidden = !P.charts;
    if (!P.charts || !window.TkMnaCharts?.render) return;
    const sig = `${dataSig(P.snap)}|${v.key}`;
    if (sig === P.chartSig) return;
    P.chartSig = sig;
    try {
      window.TkMnaCharts.render(box, { snap: P.snap, F: { ...P.F }, deals: v.deals, prev: v.prev, all: v.all, now: v.now, selected: P.sel, select: (id) => select(id, true), setFilter });
    } catch (e) { console.error("M&A charts:", e); }
  }

  // ---------- page ----------
  function render(force) {
    if (!P.active) return;
    const s = P.snap;
    if (!s) return state(window.WireUI.skeleton("rows", { n: 10, label: "Loading deals…" }));
    if (!s.deals.length) {
      if (s.loading || (!s.error && !s.fetchedAt)) return state(window.WireUI.skeleton("rows", { n: 10, label: "Downloading three years of deal filings from the SEC…" }));
      if (s.error) return state(window.WireUI.error(s.error, "data-ref"));
      return state(window.WireUI.empty("No deals found", "SEC EDGAR returned no deal filings for the last three years.", `<button type="button" class="es-btn" data-ref>Try again</button>`));
    }
    shell();
    const v = view(Date.now());
    put("head", head());
    put("contact", contact());
    put("bar", bar(v), force);
    put("tiles", tiles(v));
    put("table", table(v));
    charts(v);
  }

  function renderDetail(force) {
    if (!P.active || window.WireInstrument?.isOpen()) return;
    const el = $("#mnadetail"), html = detail();
    if (!force && html === P.detailHTML) return;
    el.innerHTML = html; P.detailHTML = html;
  }
  function detail() {
    const s = P.snap;
    if (!s || (!s.deals.length && s.loading)) return window.WireUI.skeleton("detail");
    const d = P.sel && findDeal(P.sel);
    if (!d) {
      return `<h1>Deals in SEC filings</h1>
        <p>Every deal here has a US-listed company as the target: one that files with the SEC and has to tell shareholders when it is being bought. Tickerkite finds three kinds of filing: <b>tender offers</b> (the buyer offers to buy shares directly), <b>merger proxies</b> (shareholders vote on the sale) and <b>going-private statements</b> (insiders buy out the public).</p>
        <div class="isec">WHAT TO KEEP IN MIND</div>
        <dl class="kv mna-kv">
          <dt>Missing</dt><dd>Deals for private companies, and most deals for foreign ones, file nothing with the SEC, so they are not here. That leaves out much of the market by count.</dd>
          <dt>Date</dt><dd>The first SEC filing, usually days to weeks after the deal was announced.</dd>
          <dt>Size</dt><dd>The "transaction valuation" from the filing-fee table: the equity value of the shares being bought. It is not enterprise value (it leaves out debt), and some filings don't state it.</dd>
          <dt>Stage</dt><dd>Inferred from the filings so far. A deal with no new filing for 90 days counts as past, but the filings can't tell a completed deal from an abandoned one.</dd>
        </dl>
        <p class="mna-hint">Click a deal to see its filings. Keys: ↑↓ or j/k select, Enter opens the newest filing, / searches, r refreshes.</p>`;
    }
    const tk = d.target.tickers[0], z = s.sizing || {};
    const ago = Math.max(0, Math.round((Date.now() - Date.parse(d.lastDate)) / DAY));
    const size = d.value != null
      ? `<div class="mna-big">${money(d.value)}${d.price != null ? `<small>${esc(`$${d.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a share`)}</small>` : ""}</div>
        <p class="mna-note">The transaction valuation from the filing-fee table: what the shares being bought are worth at the offer, not counting debt.</p>`
      : `<div class="mna-big dim">Size not known</div><p class="mna-note">${s.needsContact ? "Add a contact email (on the left) so Tickerkite can read sizes from the filings." : !d.sized && z.active ? "Tickerkite is still reading sizes from the filings." : "The filing-fee table doesn't state a value Tickerkite can read; the filing itself may."}</p>`;
    const buyers = d.acquirers.length ? d.acquirers.slice(0, 4).map((a) => `<div>${esc(a.name)}${a.tickers[0] ? ` <button type="button" class="mna-tk" data-inst="${esc(a.tickers[0])}" title="Open ${esc(a.tickers[0])}">${esc(a.tickers[0])}</button>` : ""}</div>`).join("") + (d.acquirers.length > 4 ? `<div class="dim">and ${d.acquirers.length - 4} more</div>` : "")
      : `<span class="dim">Not named on the filing cover; open a filing to read it</span>`;
    const stage = `${esc(d.stage)}<div class="dim">${d.active ? `<i class="mna-dot"></i>In progress · last filing ${ago ? `${ago} day${ago === 1 ? "" : "s"} ago` : "today"}` : `No new filing for ${ago} days: completed or abandoned (the filings don't say which)`}</div>`;
    const fil = d.filings.map((f) => `<button type="button" class="mna-fil" data-url="${esc(f.url)}" title="Open on sec.gov"><b>${esc(f.form)}</b><span>${esc(formWords(f.form))}</span><em>${day(f.date)}</em></button>`).join("");
    return `<div class="dhead">${tk ? `<span class="code">${esc(tk)}</span>` : ""}<span class="nm">${esc(d.type)} · ${esc(d.sector)}</span></div>
      <h1>${esc(d.target.name)}</h1>${size}
      <dl class="kv mna-kv">
        <dt>Buyer${d.acquirers.length > 1 ? "s" : ""}</dt><dd>${buyers}</dd>
        <dt>Type</dt><dd>${esc(d.type)}<div class="dim">${esc(TYPE_WORDS[d.type] || "")}</div></dd>
        <dt>Stage</dt><dd>${stage}${STAGE_WORDS[d.stage] ? `<div class="dim">${esc(STAGE_WORDS[d.stage])}</div>` : ""}</dd>
        <dt>Sector</dt><dd><button type="button" class="mna-cb" data-set="sector" data-v="${esc(d.sector)}">${esc(d.sector)}</button></dd>
        <dt>Sub-sector</dt><dd><button type="button" class="mna-cb" data-set="industry" data-v="${esc(d.industry)}" data-sector="${esc(d.sector)}">${esc(d.industry)}</button></dd>
        ${d.state ? `<dt>State</dt><dd>${esc(d.state)}</dd>` : ""}
        <dt>First filing</dt><dd>${day(d.date)}</dd>
        <dt>Latest filing</dt><dd>${day(d.lastDate)}</dd>
      </dl>
      <div class="openrow mna-open">${tk ? `<button type="button" class="open" data-inst="${esc(tk)}">Open ${esc(tk)}</button>` : ""}${d.filings[0] ? `<button type="button" class="mna-btn" data-url="${esc(d.filings[0].url)}">Newest filing ↗</button>` : ""}</div>
      <div class="isec">FILINGS · NEWEST FIRST</div><div class="mna-fils">${fil}</div>`;
  }

  // ---------- actions ----------
  function apply(snap) {
    if (!snap) return;
    P.snap = snap;
    window.WireChrome?.pulled("mna", snap.fetchedAt || null);
    window.WireChrome?.status("mna", snap.loading && !snap.deals.length ? "LOADING" : `${snap.deals.length.toLocaleString("en-US")} DEALS · ${snap.years || 3} YEARS${snap.sizing?.active ? " · READING SIZES" : ""}`);
    if (P.sel && !findDeal(P.sel)) P.sel = null;
    render(); renderDetail();
  }
  function refresh(full) {
    if (P.snap) { P.snap = { ...P.snap, loading: true }; render(); }
    api.page.invoke("mna:refresh", !!full).then(apply);
  }
  function changed(force) { saveF(); P.limit = PAGE; render(force); }
  /** Merge a patch into the filters (from the charts, the tiles, or a table cell). */
  function setFilter(patch) {
    const p = { ...patch };
    if ("sector" in p && p.sector !== P.F.sector && !("industry" in p)) p.industry = "";
    if (("from" in p || "to" in p) && !("range" in p)) p.range = "custom";
    Object.assign(P.F, p);
    if ("q" in p && $("#mnaq")) $("#mnaq").value = P.F.q;
    changed();
  }
  /** Select a deal: highlight its row (showing more rows if needed), scroll to it, show it on the right. */
  function select(id, keep) {
    P.sel = !keep && P.sel === id ? null : id;
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    const t = $("#mna .mna-t");
    if (P.sel && P.snap && P.active) {
      const i = sorted(view(Date.now())).findIndex((d) => d.id === P.sel);
      if (i >= P.limit) { P.limit = Math.ceil((i + 1) / PAGE) * PAGE; render(); }
    }
    // flip the highlight in place rather than redrawing the table (and never the charts)
    if (t) {
      t.querySelectorAll('.mna-r[aria-selected="true"]').forEach((r) => r.setAttribute("aria-selected", "false"));
      const r = P.sel && t.querySelector(`.mna-r[data-id="${CSS.escape(P.sel)}"]`);
      if (r) { r.setAttribute("aria-selected", "true"); r.scrollIntoView({ block: "nearest" }); }
      P.cache.table = null;
    }
    window.TkMnaCharts?.select?.(P.sel);
    renderDetail();
  }
  function move(step) {
    if (!P.snap?.deals.length) return;
    const list = sorted(view(Date.now()));
    if (!list.length) return;
    const i = list.findIndex((d) => d.id === P.sel);
    select(list[i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + step))].id, true);
  }
  function openFiling() { const d = P.sel && findDeal(P.sel); if (d?.filings[0]) api.open?.(d.filings[0].url); }

  /** Clicks shared by the page and the detail pane: filter cells, tickers, filing links. */
  function common(e) {
    const set = e.target.closest("[data-set]");
    if (set) { setFilter(set.dataset.set === "industry" ? { sector: set.dataset.sector, industry: set.dataset.v } : { sector: set.dataset.v, industry: "" }); return true; }
    const inst = e.target.closest("[data-inst]"); if (inst) { window.WireApp.openInstrument(inst.dataset.inst); return true; }
    const u = e.target.closest("[data-url]"); if (u) { api.open?.(u.dataset.url); return true; }
    return false;
  }

  const root = $("#mna");
  root.addEventListener("click", (e) => {
    if (common(e)) return;
    if (e.target.closest("[data-ref]")) return refresh(e.shiftKey);
    if (e.target.closest("[data-charts]")) {
      P.charts = !P.charts; try { localStorage.setItem("wire.mna.charts", P.charts ? "1" : "0"); } catch {}
      P.chartSig = ""; return render();
    }
    if (e.target.closest("[data-reset]")) { P.F = S.defaults(); if ($("#mnaq")) $("#mnaq").value = ""; return changed(); }
    const r = e.target.closest("[data-range]");
    if (r) {
      const k = r.dataset.range;
      // custom starts from the window on screen, so switching changes nothing until a date is edited
      if (k === "custom" && P.F.range !== "custom") { const sp = S.span(P.F, Date.now()); Object.assign(P.F, { from: sp.from, to: sp.to }); }
      P.F.range = k; return changed();
    }
    const st = e.target.closest("[data-status]"); if (st) { P.F.status = st.dataset.status; return changed(); }
    const sz = e.target.closest("[data-size]"); if (sz) { P.F.size = sz.dataset.size; return changed(); }
    const so = e.target.closest("[data-sort]");
    if (so) {
      const k = so.dataset.sort;
      P.sort = P.sort.key === k ? { key: k, dir: -P.sort.dir } : { key: k, dir: k === "date" || k === "value" ? -1 : 1 };
      return render();
    }
    if (e.target.closest("[data-more]")) { P.limit += PAGE; return render(); }
    const tile = e.target.closest("[data-sel]"); if (tile) return select(tile.dataset.sel, true);
    const row = e.target.closest(".mna-r[data-id]"); if (row) select(row.dataset.id);
  });
  root.addEventListener("change", (e) => {
    const f = e.target.dataset?.f;
    if (!f) return;
    if (f === "spacs") { P.F.spacs = e.target.checked; return changed(true); }
    if (f === "from" || f === "to") {
      // a date input reports half-typed years (0002-…); wait for a real one, and keep the input itself until blur
      const val = e.target.value;
      if (val && !(val >= "1990-01-01" && val <= "2100-01-01")) return;
      P.F[f] = val;
      if (P.F.from && P.F.to && P.F.from > P.F.to) [P.F.from, P.F.to] = [P.F.to, P.F.from];
      return changed();
    }
    P.F[f] = e.target.value;
    if (f === "sector") P.F.industry = "";
    changed(true);
  });
  root.addEventListener("input", (e) => {
    if (e.target.id !== "mnaq") return;
    P.F.q = e.target.value;
    // filtering is cheap, the charts are not: redraw once typing pauses
    clearTimeout(P.typing); P.typing = setTimeout(() => { P.limit = PAGE; render(); }, 140);
  });
  root.addEventListener("focusout", () => { if (P.dirty) { P.dirty = false; setTimeout(render, 0); } });
  root.addEventListener("submit", async (e) => {
    if (e.target.id !== "mnacontact") return;
    e.preventDefault();
    const msg = e.target.querySelector(".mna-cmsg"), btn = e.target.querySelector("button");
    btn.disabled = true;
    const r = await window.wire.setSecContact(e.target.querySelector("input").value);
    btn.disabled = false;
    if (!r?.ok) { msg.textContent = r?.error || "Couldn't save the email."; return; }
    msg.textContent = "Saved. Reading deal sizes…";
    api.page.invoke("mna:get").then(apply);
  });
  $("#mnadetail").addEventListener("click", (e) => { common(e); });
  if (api?.page) api.page.on("mna:update", apply);

  (window.WirePages ||= {}).mna = {
    show() { P.active = true; render(); renderDetail(true); api.page.invoke("mna:get").then(apply); },
    hide() { P.active = false; },
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.id === "mnaq") {
        if (e.key === "Escape") { e.preventDefault(); e.target.value = ""; P.F.q = ""; e.target.blur(); changed(); }
        else if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); e.target.blur(); move(P.sel ? 0 : 1); }
        return;
      }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === "/") { e.preventDefault(); $("#mnaq")?.focus(); $("#mnaq")?.select(); }
      else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter" || e.key === "o") openFiling();
      else if (e.key === "Escape" && P.sel) select(P.sel);
      else if (e.key === "r" || e.key === "R") refresh(e.key === "R");
    },
    restore() { renderDetail(true); },
    detail: () => $("#mnadetail")
  };
})();
