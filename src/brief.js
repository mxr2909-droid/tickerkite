// Morning brief: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, get, expose, bus }
//  - IPC channels must start with "brief:" (the preload only forwards those)
// Everything here is assembled from what other modules already hold (stories, quotes, scorecards, the calendar,
// release reactions, the portfolio), plus index futures, so the brief opens instantly. The renderer decides when to
// show it (first look of the day, or after 4+ hours away) and passes `since`, the time you last had Tickerkite in front of you.
const quotes = require("./quotes");

const MARKETS = ["^GSPC", "^IXIC", "^TNX", "DX-Y.NYB", "BZ=F", "GC=F", "BTC-USD", "^VIX", "^STOXX50E", "^N225"];
const FUTURES = [["ES=F", "S&P futures", "idx"], ["NQ=F", "Nasdaq futures", "idx"]];
const MAX_SINCE = 24 * 3600e3; // "since you last looked" never reaches back further than a day

/** The biggest stories updated since `since` (at least the last 12 hours' worth, so a short break still shows some). */
function topStories(stories, since, now = Date.now(), n = 6) {
  const from = Math.min(Math.max(since || 0, now - MAX_SINCE), now - 12 * 3600e3);
  return (stories || []).filter((s) => s.kind === "news" && s.updated >= from)
    .sort((a, b) => b.score - a.score).slice(0, n)
    .map((s) => ({ id: s.id, title: s.title, code: s.code, sev: s.sev, signal: s.signal, updated: s.updated, why: s.why, sources: s.sources?.length || 1, watch: s.watch || [] }));
}

/** Scorecard outlooks with their change over the last week, biggest movers first. */
function outlooks(result) {
  const a = result?.assets;
  if (!a) return null;
  const names = { stocks: "Stocks", bonds: "Bonds", commodities: "Commodities", realestate: "Real Estate", crypto: "Crypto", alts: "Alts" };
  const rows = Object.entries(names).filter(([k]) => a[k]).map(([k, name]) => ({
    key: k, name, score: a[k].score, label: a[k].label, w1: a[k].changes?.w1?.score ?? null,
    why: (a[k].changes?.w1?.rows || []).slice(0, 2).map((r) => ({ id: r.id, pts: r.pts }))
  }));
  return { rows, regime: result.regime ? { name: result.regime.name, text: result.regime.text } : null };
}

/** Today's events worth a line in the brief: high-importance releases (US + G10), Fed events, your earnings. */
function todayEvents(events, releases) {
  const rx = new Map((releases || []).map((r) => [`${r.code}:${r.t}`, r]));
  return (events || []).filter((e) => e.cat === "earnings" || e.cat === "fed" || (e.rel >= 3 && (e.code === "US" || e.g10)))
    .slice(0, 14).map((e) => ({
      id: e.id, t: e.t, timed: e.timed !== false, title: e.title, cat: e.cat, code: e.code, flag: e.flag,
      survey: e.survey || "", actual: e.actual || "", prior: e.prior || "", sym: e.sym || null,
      reaction: rx.get(`${e.code}:${e.t}`)?.reaction || null
    }));
}

function register(ctx) {
  let fut = [], futAt = 0;
  async function futures() {
    if (Date.now() - futAt < 60e3) return fut;
    futAt = Date.now();
    fut = (await Promise.all(FUTURES.map((f) => quotes.quoteOne(f)))).filter((q) => q.last != null);
    return fut;
  }

  async function build(since) {
    const now = Date.now();
    const g = ctx.get();
    const byS = new Map((g.quotes || []).map((q) => [q.sym, q]));
    const markets = [...(await futures().catch(() => [])), ...MARKETS.map((s) => byS.get(s)).filter((q) => q && q.last != null)]
      .map(({ sym, label, type, last, chg, pct }) => ({ sym, label, type, last, chg, pct }));
    const releases = ctx.expose.releases?.() || [];
    ctx.expose.refreshPortfolio?.();
    const pf = ctx.expose.portfolio?.();
    const week = ctx.expose.calendarWeek?.() || [];
    return {
      now, since: since || null,
      stories: topStories(g.stories, since, now),
      markets,
      today: todayEvents(ctx.expose.calendarToday?.(), releases),
      released: releases.filter((r) => now - r.t < 24 * 3600e3),
      earnings: week.filter((e) => e.cat === "earnings" && e.t >= now - 24 * 3600e3).slice(0, 8).map((e) => ({ t: e.t, sym: e.sym, title: e.title, timed: e.timed !== false })),
      outlook: outlooks(g.scores),
      portfolio: pf && pf.rows.length ? {
        total: pf.total, outlook: pf.outlook, cash: pf.cash,
        movers: pf.rows.filter((r) => r.pct != null).sort((a, b) => Math.abs(b.dayPnl || 0) - Math.abs(a.dayPnl || 0)).slice(0, 4)
          .map(({ sym, name, pct, dayPnl }) => ({ sym, name, pct, dayPnl })),
        news: pf.news.filter((s) => s.updated >= Math.max(since || 0, now - MAX_SINCE)).slice(0, 5)
      } : null
    };
  }

  ctx.ipcMain.handle("brief:get", (_e, since) => build(Number(since) || 0));
}

module.exports = { register, topStories, outlooks, todayEvents };
