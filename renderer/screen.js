/* Tickerkite Stock screener (SCRN): filter the ~600 largest US companies by valuation, growth,
   profitability and momentum. Data is built in src/screen.js from SEC filings and Yahoo prices. */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const call = (ch, ...a) => api.page.invoke(ch, ...a);

  // metric, label, unit, column header, decimals
  const M = [
    ["mcap", "Market cap", "$B", "MKT CAP", 0], ["pe", "P/E", "×", "P/E", 1], ["ps", "Price / sales", "×", "P/S", 1],
    ["growth", "Revenue growth", "%", "REV GROWTH", 1], ["gross", "Gross margin", "%", "GROSS", 1], ["op", "Operating margin", "%", "OP MARGIN", 1],
    ["net", "Net margin", "%", "NET MARGIN", 1], ["roe", "Return on equity", "%", "ROE", 1], ["de", "Debt / equity", "×", "DEBT/EQ", 2],
    ["ret6", "6-month return", "%", "6 MO", 1], ["ret12", "12-month return", "%", "12 MO", 1], ["fromHigh", "From 52-week high", "%", "FROM HIGH", 1],
    ["buyers", "Insider buyers", "#", "INSIDER BUYERS", 0], ["insiderNet", "Net insider buying", "$M", "NET INSIDER $", 1]
  ];
  const ML = Object.fromEntries(M.map((m) => [m[0], m]));
  const PRESETS = [
    ["Value", [["pe", "<=", 15], ["roe", ">=", 15], ["de", "<=", 1]]],
    ["Growth", [["growth", ">=", 20], ["op", ">=", 10]]],
    ["Quality", [["roe", ">=", 20], ["net", ">=", 15], ["de", "<=", 0.5]]],
    ["Momentum", [["ret12", ">=", 25], ["fromHigh", ">=", -5]]],
    ["Beaten down", [["ps", "<=", 1], ["ret12", "<=", -20]]],
    ["Megacaps", [["mcap", ">=", 200]]],
    ["Insider buying", [["buyers", ">=", 2], ["insiderNet", ">=", 0]]]
  ];

  let R = { filters: PRESETS[0][1].map(([m, op, v]) => ({ m, op, v })), sort: "mcap", desc: true, q: "" };
  try { R = { ...R, ...JSON.parse(localStorage.getItem("wire.screen") || "{}") }; } catch {}
  const S = { active: false, data: null, saves: [], sel: null, msg: "" };
  const save = () => { try { localStorage.setItem("wire.screen", JSON.stringify(R)); } catch {} };

  const fmt = (m, v) => {
    if (v == null || !Number.isFinite(v)) return "—";
    const [, , u, , d] = ML[m];
    if (u === "$B") return v >= 1000 ? `${(v / 1000).toFixed(2)}T` : `${v.toFixed(d)}B`;
    if (u === "$M") return `${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + "B" : Math.abs(v).toFixed(d) + "M"}`;
    if (u === "#") return String(Math.round(v));
    return u === "%" ? `${v.toFixed(d)}%` : `${v.toFixed(d)}×`;
  };
  const cls = (m, v) => (v == null ? "" : ["ret6", "ret12", "growth", "insiderNet"].includes(m) ? (v > 0 ? "up" : v < 0 ? "dn" : "") : m === "buyers" && v >= 2 ? "up" : "");
  const passes = (row) => R.filters.every((f) => { const x = row[f.m], v = Number(f.v); if (x == null || !Number.isFinite(x) || !Number.isFinite(v)) return false; return f.op === "<=" ? x <= v : x >= v; });

  function results() {
    const q = R.q.trim().toLowerCase();
    const rows = (S.data?.rows || []).filter((r) => passes(r) && (!q || r.ticker.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)));
    const k = R.sort, dir = R.desc ? -1 : 1;
    return rows.sort((a, b) => (a[k] == null) - (b[k] == null) || (typeof a[k] === "string" ? a[k].localeCompare(b[k]) * dir : (a[k] - b[k]) * dir));
  }

  function render() {
    if (!S.active) return;
    const d = S.data, el = $("#screen");
    if (!d || (!d.rows?.length && d.building)) { el.innerHTML = window.WireUI?.skeleton ? window.WireUI.skeleton("rows", { n: 10, label: "Building the screener: SEC filings for ~600 companies, then a year of prices for each (about 2 minutes the first time)…" }) : `<p class="dim">Building…</p>`; renderDetail(); return; }
    if (!d.rows?.length) { el.innerHTML = `<div class="sc2"><p class="sc2-err">${esc(d.error || "The screener hasn't been built yet.")}</p><button type="button" class="sc2-btn" data-act="rebuild">BUILD NOW</button></div>`; renderDetail(); return; }
    const list = results();
    const opt = (sel, items) => items.map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${l}</option>`).join("");
    const cols = [["ticker", "TICKER"], ["name", "COMPANY"], ...M.map((m) => [m[0], m[3]])];
    el.innerHTML = `<div class="sc2">
      <div class="sc2-row"><span class="sc2-lbl">PRESETS</span>${PRESETS.map(([n], i) => `<button type="button" class="sc2-chip" data-preset="${i}">${esc(n)}</button>`).join("")}
        ${S.saves.length ? `<span class="sc2-lbl">SAVED</span>${S.saves.map((s) => `<span class="sc2-saved"><button type="button" class="sc2-chip" data-load="${esc(s.name)}" title="${s.notify ? "Notifies you of new names" : ""}">${esc(s.name)}${s.notify ? " 🔔" : ""}${s.fresh?.length ? ` <em>+${s.fresh.length}</em>` : ""}</button><button type="button" class="sc2-x" data-del="${esc(s.name)}" title="Delete">×</button></span>`).join("")}` : ""}</div>
      <div class="sc2-filters">${R.filters.map((f, i) => `<div class="sc2-f" data-i="${i}"><select data-k="m">${opt(f.m, M.map((m) => [m[0], m[1]]))}</select><select data-k="op">${opt(f.op, [[">=", "at least"], ["<=", "at most"]])}</select><input data-k="v" type="number" step="any" value="${esc(f.v)}"><span class="u">${esc(ML[f.m][2])}</span><button type="button" class="sc2-x" data-rm="${i}" title="Remove">×</button></div>`).join("")}
        <div class="sc2-row"><button type="button" class="sc2-btn" data-act="add">+ ADD FILTER</button>
          <input id="scq" class="sc2-q" placeholder="Find a ticker or company" value="${esc(R.q)}" spellcheck="false">
          <span class="sc2-n"><b>${list.length}</b> of ${d.rows.length} companies pass</span></div></div>
      <div class="sc2-tw"><table class="sc2-tab num"><thead><tr>${cols.map(([k, l]) => `<th data-sort="${k}" class="${R.sort === k ? "on" : ""}">${l}${R.sort === k ? (R.desc ? " ▼" : " ▲") : ""}</th>`).join("")}</tr></thead><tbody>
        ${list.slice(0, 300).map((r) => `<tr data-t="${esc(r.ticker)}" class="${r.ticker === S.sel ? "sel" : ""}"><td class="tk">${esc(r.ticker)}</td><td class="nm">${esc(r.name)}</td>${M.map(([m]) => `<td class="${cls(m, r[m])}">${fmt(m, r[m])}</td>`).join("")}</tr>`).join("")}
      </tbody></table>${list.length > 300 ? `<p class="sc2-note">Showing the first 300; narrow the filters to see the rest.</p>` : ""}${!list.length ? `<p class="sc2-note">No companies pass every filter. Loosen one.</p>` : ""}</div>
      <p class="sc2-note">The ${d.universe} largest US-listed filers by revenue (annual revenue over $1B). Fundamentals: SEC filings for ${d.year} (calendar year). Prices: Yahoo, updated ${new Date(d.builtAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Insider buyers and net insider $: open-market purchases and sales on Form 4 ${d.insiderQuarters ? `in ${esc(d.insiderQuarters.map((q) => q.toUpperCase().replace("Q", " Q")).join(" and "))} (the latest the SEC has published)` : "(not loaded)"}; grants and option exercises don't count. P/E and margins use reported net income, so one-off items can distort them. ${d.building ? "Rebuilding now…" : `<button type="button" class="sc2-link" data-act="rebuild">Rebuild now</button>`}</p>
    </div>`;
    renderDetail();
  }

  function renderDetail() {
    const el = $("#scdetail"); if (!el) return;
    const r = S.data?.rows?.find((x) => x.ticker === S.sel);
    const saveBox = `<div class="isec">SAVE THIS SCREEN</div>
      <form id="scsave" class="sc2-save"><input name="n" placeholder="Name, e.g. Cheap quality" maxlength="60"><label><input type="checkbox" name="notify" checked> notify me of new names</label><button type="submit" class="sc2-btn">SAVE</button></form>
      ${S.msg ? `<p class="sc2-note">${esc(S.msg)}</p>` : ""}
      <p class="sc2-note">Saved screens re-check after each daily rebuild and send a Mac notification when a company newly passes.</p>`;
    if (!r) { el.innerHTML = `<div class="sc2-d"><div class="dhead"><span class="code">SCRN</span><span class="nm">STOCK SCREENER</span></div><p class="dim">Pick a preset or build filters, click a column to sort, and click a company for its numbers.</p>${saveBox}</div>`; return; }
    el.innerHTML = `<div class="sc2-d"><div class="dhead"><span class="code">${esc(r.ticker)}</span><span class="nm">${esc(r.name)}</span></div>
      <div class="sc2-big"><b class="num">$${r.price.toFixed(2)}</b><span class="${cls("ret12", r.ret12)}">${fmt("ret12", r.ret12)} over 12 months</span></div>
      <dl class="kv">${M.map(([m, l]) => `<dt>${esc(l.toUpperCase())}</dt><dd class="${cls(m, r[m])}">${fmt(m, r[m])}</dd>`).join("")}<dt>REVENUE</dt><dd>$${r.rev.toFixed(1)}B</dd></dl>
      <div class="sc2-row"><button type="button" class="open" data-act="company">COMPANY PAGE <span>›</span></button><button type="button" class="sc2-btn" data-act="chart">CHART</button><button type="button" class="sc2-btn" data-act="watch">+ WATCHLIST</button></div>
      ${saveBox}</div>`;
  }

  async function loadSaves() { try { S.saves = await call("screen:saves"); } catch { S.saves = []; } }
  async function load() { try { S.data = await call("screen:data"); } catch {} render(); }

  // ---------- events ----------
  const onClick = async (e) => {
    if (!S.active) return;
    const t = e.target;
    const pr = t.closest("[data-preset]"); if (pr) { R.filters = PRESETS[+pr.dataset.preset][1].map(([m, op, v]) => ({ m, op, v })); save(); render(); return; }
    const ld = t.closest("[data-load]"); if (ld) { const s = S.saves.find((x) => x.name === ld.dataset.load); if (s) { R.filters = s.filters.map((f) => ({ ...f })); save(); render(); } return; }
    const dl = t.closest("[data-del]"); if (dl) { S.saves = await call("screen:delete", dl.dataset.del); render(); return; }
    const rm = t.closest("[data-rm]"); if (rm) { R.filters.splice(+rm.dataset.rm, 1); save(); render(); return; }
    const th = t.closest("th[data-sort]"); if (th) { const k = th.dataset.sort; R.desc = R.sort === k ? !R.desc : !["ticker", "name", "pe", "ps", "de"].includes(k); R.sort = k; save(); render(); return; }
    const tr = t.closest("tr[data-t]"); if (tr) { S.sel = tr.dataset.t; document.querySelectorAll("#screen tr.sel").forEach((x) => x.classList.remove("sel")); tr.classList.add("sel"); renderDetail(); return; }
    const a = t.closest("[data-act]")?.dataset.act;
    if (a === "add") { R.filters.push({ m: "roe", op: ">=", v: 10 }); save(); render(); }
    else if (a === "rebuild") { call("screen:rebuild"); S.data = { ...(S.data || {}), building: true }; render(); }
    else if (a === "company" && S.sel) window.WireCompanyPage?.open(S.sel);
    else if (a === "chart" && S.sel) window.WireApp.openInstrument(S.sel);
    else if (a === "watch" && S.sel) { const r = await api.addWatch(S.sel); S.msg = r?.ok ? `Added ${S.sel} to your watchlist.` : r?.error || "Couldn't add it."; renderDetail(); }
  };
  $("#screen").addEventListener("click", onClick);
  $("#scdetail").addEventListener("click", onClick);
  $("#screen").addEventListener("change", (e) => {
    const f = e.target.closest(".sc2-f"); if (!f || !e.target.dataset.k) return;
    const i = +f.dataset.i, k = e.target.dataset.k;
    R.filters[i][k] = k === "v" ? e.target.value : e.target.value;
    save(); render();
  });
  $("#screen").addEventListener("input", (e) => {
    if (e.target.id === "scq") { R.q = e.target.value; save(); const pos = e.target.selectionStart; render(); const q = $("#scq"); q.focus(); q.setSelectionRange(pos, pos); }
  });
  $("#scdetail").addEventListener("submit", async (e) => {
    if (e.target.id !== "scsave") return;
    e.preventDefault();
    const r = await call("screen:save", { name: e.target.n.value, filters: R.filters, notify: e.target.notify.checked });
    if (r?.ok) { S.saves = r.screens; S.msg = `Saved "${e.target.n.value.trim()}".`; } else S.msg = r?.error || "Couldn't save.";
    render();
  });
  if (api?.page) api.page.on("screen:update", () => { if (S.active) load(); });

  (window.WirePages ||= {}).screen = {
    async show() { S.active = true; await loadSaves(); await load(); },
    hide() { S.active = false; },
    key(e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === "Enter" && S.sel) window.WireCompanyPage?.open(S.sel);
      else if (e.key === "/") { e.preventDefault(); $("#scq")?.focus(); }
    },
    restore() { renderDetail(); },
    detail: () => $("#scdetail")
  };
})();
