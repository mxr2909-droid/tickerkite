// What news is relevant to each instrument.
//  q  = Google News search used to find headlines on a past move day
//  re = regex used to match live WIRE stories to the instrument
//  macro = live story desks that also move this instrument (e.g. Fed news moves yields)
const { fetchText } = require("./news/fetcher");
const { parseFeed } = require("./news/parse");
const { rank } = require("./news/rank");

const INSTR = {
  "^GSPC": { q: '"S&P 500" OR "Wall Street" OR "US stocks"', re: /s&p 500|s&p|wall street|u\.?s\.? stocks|stock market|equities|stocks? (fall|rise|rall|slide|drop|gain|sink|jump|tumble|surge)/i, macro: ["US", "FED"] },
  "^IXIC": { q: 'Nasdaq OR "tech stocks" OR "chip stocks"', re: /nasdaq|tech (stocks|shares)|chip|semiconductor|nvidia|ai stocks|megacap|magnificent seven/i, macro: ["US", "FED"] },
  "^DJI": { q: '"Dow Jones" OR "Dow industrials" OR "blue chips"', re: /\bdow\b|blue.chip|industrials/i, macro: ["US", "FED"] },
  "^RUT": { q: '"Russell 2000" OR "small caps" OR "small-cap stocks"', re: /russell|small.cap/i, macro: ["US", "FED"] },
  "^VIX": { q: 'VIX OR "volatility index" OR "stock market selloff"', re: /\bvix\b|volatility|sell-?off|rout|fear gauge|plunge|tumble/i, macro: ["US", "FED", "NRG"] },
  "^TNX": { q: '"Treasury yields" OR "10-year yield" OR "bond market"', re: /treasur|yields?|bonds?|\bfed\b|fomc|inflation|cpi|ppi|payrolls|jobs report/i, macro: ["FED"] },
  "DX-Y.NYB": { q: '"dollar index" OR "U.S. dollar" OR greenback', re: /dollar|greenback|\bdxy\b|currenc/i, macro: ["FED", "GLB"] },
  "EURUSD=X": { q: 'euro dollar OR ECB OR Lagarde', re: /\beuro\b|\becb\b|lagarde|eurozone|euro area/i, macro: ["FED", "GLB"] },
  "JPY=X": { q: 'yen OR "Bank of Japan" OR BOJ', re: /\byen\b|bank of japan|\bboj\b|ueda|japan/i, macro: ["FED", "GLB"] },
  "BZ=F": { q: '"Brent crude" OR "oil prices" OR OPEC', re: /\boil\b|crude|brent|opec|hormuz|refiner|tanker|barrel/i, macro: ["NRG"] },
  "CL=F": { q: '"WTI crude" OR "oil prices" OR OPEC', re: /\boil\b|crude|\bwti\b|opec|hormuz|refiner|tanker|barrel/i, macro: ["NRG"] },
  "GC=F": { q: '"gold prices" OR "gold price" OR bullion', re: /\bgold\b|bullion|precious metals?/i, macro: ["FED"] },
  "BTC-USD": { q: 'bitcoin OR crypto', re: /bitcoin|crypto|\bbtc\b|ether/i, macro: [] },
  "^STOXX50E": { q: '"European stocks" OR "Stoxx 600" OR "Euro Stoxx"', re: /europe(an)? (stocks|shares|markets|bourses)|stoxx|\bdax\b|\bcac\b|ftse|\becb\b/i, macro: ["GLB"] },
  "^N225": { q: 'Nikkei OR "Japanese stocks" OR "Tokyo stocks"', re: /nikkei|japan(ese)? (stocks|shares)|topix|tokyo stocks/i, macro: ["GLB"] },
  "^HSI": { q: '"Hang Seng" OR "Hong Kong stocks" OR "China stocks"', re: /hang seng|hong kong (stocks|shares)|chin(a|ese) (stocks|shares)|beijing stimulus/i, macro: ["GLB"] }
};
const fallback = (label) => ({ q: `"${label}"`, re: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), macro: [] });
const instr = (sym, label = sym) => INSTR[sym] || fallback(label);

const storyText = (s) => `${s.title} ${s.summary} ${s.assets.join(" ")}`;

/** Live WIRE stories relevant to an instrument since a timestamp. Direct topic matches first. */
function relevantLive(stories, sym, since, limit = 8) {
  const I = instr(sym);
  const out = [];
  for (const s of stories) {
    if (s.kind !== "news" || s.updated < since) continue;
    const direct = I.re.test(storyText(s));
    const macro = !direct && s.sev === "h" && s.desks.some((d) => I.macro.includes(d));
    if (direct || macro) out.push({ ...pick(s), match: direct ? "direct" : "macro" });
  }
  return out.sort((a, b) => (a.match === b.match ? b.score - a.score : a.match === "direct" ? -1 : 1)).slice(0, limit);
}
function pick(s) {
  return { id: s.id, code: s.code, title: s.title, link: s.link, score: s.score, sev: s.sev, ts: s.ts, signal: s.signal };
}

/** Intraday: headlines published from 60 min before to 20 min after each move window started. */
function attributeIntraday(stories, sym, moves) {
  const I = instr(sym);
  return moves.map((m) => {
    const lo = m.t - 60 * 60e3, hi = m.end + 20 * 60e3;
    const near = stories.filter((s) => s.kind === "news" && s.ts >= lo && s.ts <= hi);
    const scored = near
      .map((s) => ({ s, direct: I.re.test(storyText(s)), macro: s.desks.some((d) => I.macro.includes(d)) }))
      .filter((x) => x.direct || (x.macro && x.s.sev !== "l"))
      .sort((a, b) => (b.direct - a.direct) || (b.s.score - a.s.score));
    return { n: m.n, headlines: scored.slice(0, 3).map((x) => pick(x.s)) };
  });
}

// ---- past days: dated Google News search, cached (history doesn't change) ----
const dayCache = new Map();
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function headlinesForWindow(sym, label, from, to) {
  const key = `${sym}|${from}|${to}`;
  if (dayCache.has(key)) return dayCache.get(key);
  const I = instr(sym, label);
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`(${I.q}) after:${from} before:${to}`)}&hl=en-US&gl=US&ceid=US:en`;
  const job = (async () => {
    try {
      const items = parseFeed(await fetchText(url, 10000), { id: "gn-hist", name: "Google News", weight: 0, kind: "news" });
      const end = Date.parse(to + "T23:59:59Z");
      const stories = rank(items, { now: end, maxAgeHours: 24 * 12 });
      const scored = stories
        .map((s) => ({ s, direct: I.re.test(storyText(s)) }))
        .sort((a, b) => (b.direct - a.direct) || (b.s.score - a.s.score));
      return scored.slice(0, 3).map((x) => pick(x.s));
    } catch (e) {
      dayCache.delete(key); // retry next time
      return { error: String(e.message || e) };
    }
  })();
  dayCache.set(key, job);
  return job;
}

async function attributeHistory(sym, label, moves, kind) {
  return Promise.all(moves.map(async (m) => {
    // same day (and the next morning, when the move was reported) for daily; the whole week for weekly
    const from = kind === "weekly" && m.start ? m.start : m.day;
    const to = addDays(m.day, kind === "weekly" ? 1 : 2);
    const r = await headlinesForWindow(sym, label, from, to);
    return Array.isArray(r) ? { n: m.n, headlines: r } : { n: m.n, headlines: [], error: r.error };
  }));
}

module.exports = { INSTR, instr, relevantLive, attributeIntraday, attributeHistory };
