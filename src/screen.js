// Stock screener: main-process side. main.js calls register(ctx) once at startup.
//  - IPC channels start with "screen:" (the preload only forwards those)
//  - Fundamentals come from SEC "frames": one file per line item holding every filer's value for a
//    year (revenue, net income, …), so ~12 downloads cover ~2,000 companies. The universe is the
//    largest US filers by revenue (top 600, $1B+), mapped to tickers with SEC's ticker list.
//  - Prices and momentum come from Yahoo daily charts. Everything is rebuilt once a day and cached.
//  - Saved screens can notify when a company newly passes them after a rebuild.
const { getJSON } = require("./data/http");
const yahoo = require("./data/yahoo");
const company = require("./company");
const insiders = require("./insiders");

const DAY = 864e5;
const TOP = 600;

/** One frames file → Map cik → value. */
const frameMap = (j) => new Map((j?.data || []).map((d) => [d.cik, d.val]));

/** Merge line items that companies report under different tags: first tag with a value wins. */
function pick(maps, cik) { for (const m of maps) { const v = m.get(cik); if (v != null) return v; } return null; }

/** Compute screener rows from fundamentals and prices. Ratios are plain numbers; percentages are 0–100. */
function rows(fund, prices) {
  const out = [];
  for (const f of fund) {
    const px = prices[f.ticker];
    if (!px || !(px.price > 0)) continue;
    const mcap = f.shares > 0 ? px.price * f.shares : null;
    const pctOf = (a, b) => (a != null && b ? (a / b) * 100 : null);
    // filings occasionally carry a value in the wrong unit or period; ratios past these limits aren't meaningful
    const cap = (v, lo, hi) => (v == null || !Number.isFinite(v) || v < lo || v > hi ? null : v);
    out.push({
      ticker: f.ticker, name: f.name, cik: f.cik, price: px.price,
      mcap: mcap != null ? mcap / 1e9 : null, rev: f.rev / 1e9,
      pe: cap(mcap != null && f.ni > 0 ? mcap / f.ni : null, 0, 1000), ps: cap(mcap != null && f.rev > 0 ? mcap / f.rev : null, 0, 500),
      growth: f.revPrev > 0 ? (f.rev / f.revPrev - 1) * 100 : null,
      gross: pctOf(f.gp, f.rev), op: pctOf(f.oi, f.rev), net: pctOf(f.ni, f.rev),
      roe: cap(f.eq > 0 ? (f.ni / f.eq) * 100 : null, -500, 500), de: cap(f.eq > 0 && f.debt != null ? f.debt / f.eq : null, 0, 50),
      ret6: px.ret6, ret12: px.ret12, fromHigh: px.fromHigh,
      // open-market insider trades over the latest published quarters (null when the data couldn't load)
      buyers: f.ins === undefined ? null : f.ins?.buyers ?? 0,
      insiderNet: f.ins === undefined ? null : f.ins ? (f.ins.buyUsd - f.ins.sellUsd) / 1e6 : 0
    });
  }
  return out;
}

/** Does a row pass every filter? filters: [{ m: metric, op: ">=" | "<=", v: number }] (missing values fail). */
function passes(row, filters) {
  return (filters || []).every((f) => {
    const x = row[f.m], v = Number(f.v);
    if (x == null || !Number.isFinite(x) || !Number.isFinite(v)) return false;
    return f.op === "<=" ? x <= v : x >= v;
  });
}

/** Prices from a year of daily closes: last, 6- and 12-month returns (%), distance from the 52-week high (%). */
function priceStats(closes) {
  const c = closes.filter((v) => v > 0);
  if (c.length < 30) return null;
  const last = c[c.length - 1], hi = Math.max(...c);
  const back = (n) => (c.length > n ? (last / c[c.length - 1 - n] - 1) * 100 : null);
  return { price: last, ret6: back(126), ret12: c.length >= 240 ? (last / c[0] - 1) * 100 : null, fromHigh: (last / hi - 1) * 100 };
}

function register(ctx) {
  const { ipcMain, send, readJSON, writeJSON, Notification, showPage } = ctx;
  let data = readJSON("screen-data.json", null);
  let building = false, lastError = null;
  const headers = () => { const c = ctx.prefs?.().secContact; return { "User-Agent": c ? `${company.UA_BASE} ${c}` : company.UA_BASE }; };
  const report = (level, detail) => ctx.reportHealth?.("screen", { label: "Screener data (SEC + Yahoo)", at: data?.builtAt, level, detail });

  async function frames(tag, unit, period, tax = "us-gaap") {
    try { return frameMap(await getJSON(`https://data.sec.gov/api/xbrl/frames/${tax}/${tag}/${unit}/${period}.json`, { headers: headers(), timeoutMs: 30000 })); }
    catch (e) { if (e.status === 403) throw Object.assign(new Error("The SEC asks for a contact email: add it on any Company page"), { needContact: true }); return new Map(); }
  }

  async function build() {
    if (building) return;
    building = true; send("screen:update", meta());
    try {
      const tick = await getJSON("https://www.sec.gov/files/company_tickers.json", { headers: headers(), timeoutMs: 30000 });
      const byCik = new Map();
      for (const t of Object.values(tick)) if (!byCik.has(t.cik_str)) byCik.set(t.cik_str, { ticker: String(t.ticker).toUpperCase().replace(/\./g, "-"), name: t.title });
      // the most recent calendar year most companies have filed for (annual reports land by ~April)
      let Y = new Date().getUTCFullYear() - 1, rev = [];
      for (let k = 0; k < 2; k++, Y--) {
        rev = [await frames("Revenues", "USD", `CY${Y}`), await frames("RevenueFromContractWithCustomerExcludingAssessedTax", "USD", `CY${Y}`)];
        if (rev[0].size + rev[1].size > 2500) break;
      }
      const [revP1, revP2, ni, oi, gp, eq, debt1, debt2, sh] = await Promise.all([
        frames("Revenues", "USD", `CY${Y - 1}`), frames("RevenueFromContractWithCustomerExcludingAssessedTax", "USD", `CY${Y - 1}`),
        frames("NetIncomeLoss", "USD", `CY${Y}`), frames("OperatingIncomeLoss", "USD", `CY${Y}`), frames("GrossProfit", "USD", `CY${Y}`),
        frames("StockholdersEquity", "USD", `CY${Y}Q4I`), frames("LongTermDebtNoncurrent", "USD", `CY${Y}Q4I`), frames("LongTermDebt", "USD", `CY${Y}Q4I`),
        frames("WeightedAverageNumberOfDilutedSharesOutstanding", "shares", `CY${Y}`)
      ]);
      const ciks = new Set([...rev[0].keys(), ...rev[1].keys()]);
      const fund = [...ciks].map((cik) => ({ cik, r: pick(rev, cik), t: byCik.get(cik) })).filter((x) => x.t && x.r >= 1e9)
        .sort((a, b) => b.r - a.r).slice(0, TOP)
        .map(({ cik, r, t }) => ({ cik, ticker: t.ticker, name: t.name, rev: r, revPrev: pick([revP1, revP2], cik), ni: ni.get(cik) ?? null, oi: oi.get(cik) ?? null, gp: gp.get(cik) ?? null, eq: eq.get(cik) ?? null, debt: pick([debt1, debt2], cik), shares: sh.get(cik) ?? null }));

      // insider buying and selling (cached per quarter; a failure just leaves the columns empty)
      let ins = null;
      try { ins = await insiders.latest({ headers: headers(), cache: { get: (q) => readJSON(`insiders-${q}.json`, null), set: (q, v) => writeJSON(`insiders-${q}.json`, v) } }); } catch { ins = null; }
      for (const f of fund) f.ins = ins ? ins.map.get(f.cik) || null : undefined;

      // a year of prices for each, 6 at a time
      const prices = {}, priceErr = {};
      let next = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < fund.length) {
          const f = fund[next++];
          try { const r = (await yahoo.chart(f.ticker, { range: "1y", interval: "1d" }, 12000)).chart.result[0]; const s = priceStats(r.indicators.quote[0].close || []); if (s) prices[f.ticker] = s; else priceErr[f.ticker] = "too little history"; }
          catch (e) { priceErr[f.ticker] = String(e.status || e.message).slice(0, 60); }
        }
      }));
      // Yahoo sometimes throttles a burst: retry the failures once, one at a time (404s are real)
      for (const t of Object.keys(priceErr).filter((t) => priceErr[t] !== "404")) {
        await new Promise((r) => setTimeout(r, 400));
        try { const r = (await yahoo.chart(t, { range: "1y", interval: "1d" }, 12000)).chart.result[0]; const st = priceStats(r.indicators.quote[0].close || []); if (st) { prices[t] = st; delete priceErr[t]; } } catch {}
      }
      data = { builtAt: Date.now(), year: Y, rows: rows(fund, prices), universe: fund.length, priceErr, insiderQuarters: ins?.quarters || null };
      writeJSON("screen-data.json", data);
      lastError = null;
      report(data.rows.length > fund.length * 0.8 ? "ok" : "warn", `${data.rows.length} of ${fund.length} companies with prices · fundamentals for ${Y}`);
      notifySaved();
    } catch (e) {
      lastError = String(e.message || e);
      report(data ? "warn" : "bad", `rebuild failed: ${lastError}${data ? " · showing the last good copy" : ""}`);
    } finally { building = false; send("screen:update", meta()); }
  }

  const meta = () => ({ insiderQuarters: data?.insiderQuarters || null, builtAt: data?.builtAt || 0, year: data?.year || null, count: data?.rows?.length || 0, universe: data?.universe || 0, building, error: lastError });

  // ---------- saved screens ----------
  const saves = () => readJSON("screens.json", { screens: [] }).screens || [];
  const writeSaves = (s) => writeJSON("screens.json", { screens: s });
  function notifySaved() {
    const list = saves();
    if (!list.length || !data?.rows) return;
    for (const s of list) {
      const now = data.rows.filter((r) => passes(r, s.filters)).map((r) => r.ticker);
      const fresh = s.last ? now.filter((t) => !s.last.includes(t)) : [];
      if (s.notify && fresh.length && Notification?.isSupported?.()) {
        const n = new Notification({ title: `Screen "${s.name}": ${fresh.length} new name${fresh.length > 1 ? "s" : ""}`, body: fresh.slice(0, 8).join(", ") + (fresh.length > 8 ? "…" : ""), tk: { kind: "screen", page: "screen" } });
        n.on("click", () => showPage("screen"));
        n.show();
      }
      s.last = now;
      s.fresh = fresh;
    }
    writeSaves(list);
  }

  ipcMain.handle("screen:data", () => ({ ...meta(), rows: data?.rows || [] }));
  ipcMain.handle("screen:rebuild", () => { build(); return true; });
  ipcMain.handle("screen:saves", () => saves());
  ipcMain.handle("screen:save", (_e, s) => {
    const name = String(s?.name || "").trim().slice(0, 60);
    if (!name) return { ok: false, error: "Give the screen a name." };
    const list = saves().filter((x) => x.name !== name);
    const now = data?.rows ? data.rows.filter((r) => passes(r, s.filters)).map((r) => r.ticker) : null;
    list.push({ name, filters: (s.filters || []).slice(0, 12), sort: s.sort || null, notify: !!s.notify, last: now, fresh: [] });
    writeSaves(list);
    return { ok: true, screens: list };
  });
  ipcMain.handle("screen:delete", (_e, name) => { writeSaves(saves().filter((x) => x.name !== name)); return saves(); });

  report(data ? "ok" : "warn", data ? `${data.rows.length} companies · fundamentals for ${data.year}` : "not built yet");
  setTimeout(() => { if (!data || Date.now() - data.builtAt > DAY) build(); }, 90e3); // after everything else has loaded
  setInterval(() => { if (!data || Date.now() - data.builtAt > DAY) build(); }, 3600e3);
}

module.exports = { register, rows, passes, priceStats, frameMap, pick };
