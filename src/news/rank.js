// Turns raw feed items into ranked stories:
//  1. cluster the same story reported by different outlets
//  2. tag desk, signal, region and affected assets from keyword rules
//  3. score market impact = topic weight + cross-source confirmation + source authority + recency
//
// All heuristics live in this file so they are easy to tune.

const RULES = [
  { key: "infl", re: /\b(cpi|consumer prices?|inflation|pce|ppi|producer prices?)\b/i, w: 40, desk: ["US", "FED"], sig: "INFLATION DATA",
    why: "Inflation surprises reprice the rate path; front-end yields and the dollar move first.", assets: ["UST 2Y", "USD", "SPX"] },
  { key: "fed", re: /\b(fomc|federal reserve|fed (chair|governor|officials?|minutes|decision|speakers?)|the fed|powell|warsh|rate (hikes?|cuts?|decision)|interest rates?|hawkish|dovish)\b/i, w: 38, desk: ["FED", "US"], sig: "CENTRAL BANK",
    why: "Fed expectations set the discount rate for every asset: yields, the dollar and equity multiples.", assets: ["UST 2Y", "USD", "SPX"] },
  { key: "jobs", re: /\b(payrolls?|jobs report|unemployment|jobless claims|labor market|hiring)\b/i, w: 34, desk: ["US", "FED"], sig: "LABOR DATA",
    why: "Labor data is half of the Fed's mandate and moves rate expectations.", assets: ["UST 2Y", "USD"] },
  { key: "growth", re: /\b(gdp|recession|retail sales|pmi|ism|consumer (confidence|sentiment|spending)|housing starts|home sales)\b/i, w: 28, desk: ["US"], sig: "GROWTH DATA",
    why: "Growth data shifts the soft-landing vs recession debate and cyclical sector positioning.", assets: ["SPX", "UST 10Y"] },
  { key: "cb", re: /\b(ecb|lagarde|bank of england|boe|bank of japan|boj|ueda|pboc|people's bank|snb|rba|central bank)\b/i, w: 32, desk: ["GLB", "FED"], sig: "CENTRAL BANK",
    why: "Foreign policy moves shift rate differentials and FX.", assets: ["EUR", "JPY", "Bunds"] },
  { key: "rates", re: /\b(treasur(y|ies)|yields?|bond market|bonds?|10-year|2-year|30-year|gilts?|jgbs?|bunds?|term premium)\b/i, w: 24, desk: ["FED"], sig: "RATES",
    why: "Long yields set the cost of capital and pressure growth valuations.", assets: ["UST 10Y", "NDX"] },
  { key: "energy", re: /\b(oil|crude|brent|wti|opec\+?|gasoline|diesel|natural gas|lng|refiner(y|ies))\b/i, w: 28, desk: ["NRG"], sig: "ENERGY",
    why: "Energy prices feed headline inflation, airline and transport costs, and producer earnings.", assets: ["Brent", "WTI", "XLE"] },
  { key: "geo", re: /\b(war|missiles?|airstrikes?|strikes? on|attacks?|sanctions?|invasion|ceasefire|hormuz|iran|israel|russia|ukraine|houthis?|military)\b/i, w: 30, desk: ["NRG", "GLB"], sig: "GEOPOLITICAL",
    why: "Conflict risk adds a premium to energy and safe havens and weighs on risk assets.", assets: ["Brent", "Gold", "Defense"] },
  { key: "trade", re: /\b(tariffs?|trade (war|deal|talks|deficit|surplus)|export controls?|duties|overcapacity|protectionis[mt])\b/i, w: 30, desk: ["GLB", "US"], sig: "TRADE POLICY",
    why: "Trade policy hits supply chains, margins and currency moves.", assets: ["CNH", "Industrials", "SOX"] },
  { key: "earn", re: /\b(earnings|quarterly (profit|results|revenue)|q[1-4] (results|profit|revenue|earnings)|eps|guidance|forecasts?|beats? (estimates|expectations)|miss(es)? (estimates|expectations)|outlook|record profit)\b/i, w: 24, desk: ["ERN"], sig: "EARNINGS",
    why: "Results and guidance reset estimates for the company and its peers.", assets: [] },
  { key: "stress", re: /\b(default|bankrupt(cy)?|collapse|bailout|contagion|downgrade[sd]?|circuit breakers?|flash crash|plunges?|plummets?|tumbles?|soars?|surges?|rout|sell-?off|record high|worst (day|week)|best (day|week)|crash)\b/i, w: 22, desk: ["US"], sig: "MARKET MOVE",
    why: "A large price move signals forced repositioning that can spill across assets.", assets: ["VIX", "SPX"] },
  { key: "fiscal", re: /\b(white house|treasury secretary|congress|shutdown|debt ceiling|stimulus|budget|deficit|midterms?|election)\b/i, w: 18, desk: ["US"], sig: "FISCAL / POLICY",
    why: "Fiscal and political risk feeds Treasury supply and the term premium.", assets: ["UST 30Y", "USD"] },
  { key: "fx", re: /\b(dollar|yen|euro|yuan|renminbi|sterling|pound|currency|currencies|forex)\b/i, w: 16, desk: ["GLB"], sig: "FX",
    why: "Currency moves change translated earnings and capital flows.", assets: ["DXY"] },
  { key: "china", re: /\b(china|chinese|beijing|xi jinping)\b/i, w: 16, desk: ["GLB"], sig: "CHINA",
    why: "China drives global demand for commodities and a large share of trade flows.", assets: ["FXI", "Copper", "CNH"] },
  { key: "ai", re: /\b(ai|artificial intelligence|chips?|semiconductors?|data cent(er|re)s?)\b/i, w: 14, desk: ["US"], sig: "TECH / AI",
    why: "AI spending is the main earnings driver for the largest index weights.", assets: ["SOX", "NDX"] },
  { key: "deal", re: /\b(merger|acquisitions?|acquires?|acquired|takeover|buyout|ipo|to buy)\b/i, w: 14, desk: ["ERN"], sig: "M&A",
    why: "Deals re-rate the target and its peers.", assets: [] },
  { key: "crypto", re: /\b(bitcoin|crypto(currency|currencies)?|ether(eum)?|stablecoins?)\b/i, w: 10, desk: ["GLB"], sig: "CRYPTO",
    why: "Crypto is a real-time read on speculative risk appetite.", assets: ["BTC"] }
];

const TICKERS = [
  [/\bapple\b/i, "AAPL"], [/\bmicrosoft\b/i, "MSFT"], [/\bnvidia\b/i, "NVDA"], [/\bamazon\b/i, "AMZN"],
  [/\b(alphabet|google)\b/i, "GOOGL"], [/\bmeta\b/i, "META"], [/\btesla\b/i, "TSLA"], [/\bbroadcom\b/i, "AVGO"],
  [/\b(tsmc|taiwan semiconductor)\b/i, "TSM"], [/\basml\b/i, "ASML"], [/\bjpmorgan\b/i, "JPM"], [/\bgoldman\b/i, "GS"],
  [/\bmorgan stanley\b/i, "MS"], [/\bbank of america\b/i, "BAC"], [/\bwells fargo\b/i, "WFC"], [/\bcitigroup|\bciti\b/i, "C"],
  [/\bberkshire\b/i, "BRK.B"], [/\bexxon\b/i, "XOM"], [/\bchevron\b/i, "CVX"], [/\bnetflix\b/i, "NFLX"],
  [/\bunitedhealth\b/i, "UNH"], [/\bboeing\b/i, "BA"], [/\bintel\b/i, "INTC"], [/\bamd\b/i, "AMD"], [/\boracle\b/i, "ORCL"],
  [/\bsamsung\b/i, "005930.KS"], [/\btoyota\b/i, "TM"], [/\baramco\b/i, "2222.SR"], [/\bwalmart\b/i, "WMT"], [/\bblackrock\b/i, "BLK"]
];
const MEGA = new Set(["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "TSM", "JPM", "BRK.B"]);

const REGIONS = [
  ["MIDDLE EAST", /\b(iran|israel|saudi|gulf|hormuz|houthis?|yemen|qatar|uae|opec)\b/i],
  ["CHINA", /\b(china|chinese|beijing|yuan|renminbi|hong kong|shanghai|hang seng)\b/i],
  ["JAPAN", /\b(japan|japanese|tokyo|yen|boj|bank of japan|nikkei)\b/i],
  ["TAIWAN", /\b(taiwan|tsmc|taiex)\b/i],
  ["KOREA", /\b(korea|korean|kospi|won|samsung)\b/i],
  ["INDIA", /\b(india|indian|rbi|sensex|nifty|rupee)\b/i],
  ["UK", /\b(uk|britain|british|england|boe|ftse|sterling|gilts?|london)\b/i],
  ["EUROPE", /\b(europe|european|eurozone|euro area|ecb|germany|german|france|french|italy|dax|stoxx|cac)\b/i],
  ["RUSSIA / UKR", /\b(russia|russian|ukraine|ukrainian|kremlin)\b/i],
  ["LATAM", /\b(brazil|mexico|argentina|chile|latin america)\b/i],
  ["CANADA", /\b(canada|canadian|tsx|bank of canada)\b/i],
  ["US", /\b(us|u\.s\.|united states|america|american|wall street|fed|federal reserve|treasur(y|ies)|s&p|nasdaq|dow|white house|congress)\b/i]
];

// Publisher authority (0–10) and display codes
const PUBLISHERS = [
  [/reuters/i, "RTRS", 9], [/bloomberg/i, "BBG", 9], [/wall street journal|wsj/i, "WSJ", 9], [/financial times|^ft\b/i, "FT", 9],
  [/associated press|^ap\b|ap news/i, "AP", 8], [/cnbc/i, "CNBC", 7], [/federal reserve/i, "FED", 10], [/\becb\b|european central bank/i, "ECB", 9],
  [/marketwatch/i, "MW", 6], [/barron/i, "BRN", 7], [/nikkei/i, "NKA", 7], [/economist/i, "ECON", 7], [/new york times|nytimes/i, "NYT", 7],
  [/washington post/i, "WP", 6], [/bbc/i, "BBC", 6], [/guardian/i, "GDN", 5], [/axios/i, "AXS", 5], [/politico/i, "POL", 5],
  [/yahoo/i, "YF", 4], [/fox business/i, "FOXB", 4], [/fox news/i, "FOX", 3], [/\bcnn\b/i, "CNN", 5], [/investing\.com/i, "INV", 3],
  [/seeking alpha/i, "SA", 2], [/benzinga/i, "BZ", 2], [/motley fool|fool\.com/i, "MF", 1], [/zacks/i, "ZK", 1], [/kiplinger/i, "KIP", 2],
  [/south china morning post|scmp/i, "SCMP", 6], [/oilprice/i, "OP", 3], [/fxstreet/i, "FXS", 2], [/forbes/i, "FBS", 3],
  [/business insider/i, "BI", 3], [/fortune/i, "FTN", 4], [/the hill/i, "HILL", 3], [/al jazeera/i, "AJ", 5]
];
function publisherInfo(name, feedWeight = 0) {
  for (const [re, code, w] of PUBLISHERS) if (re.test(name)) return { code, weight: Math.max(w, feedWeight) };
  const words = name.replace(/^the\s+/i, "").split(/[\s.\-]+/).filter(Boolean);
  const code = (words.length > 1 ? words.map((p) => p[0]).join("") : (words[0] || "SRC").slice(0, 4)).toUpperCase().slice(0, 4);
  return { code, weight: feedWeight || 3 };
}

// Routine releases that match macro keywords but rarely move markets
const NOISE_RE = /\b(approval of (an )?application|enforcement action|announces (the )?(approval|termination)|request for (public )?comment|board meeting|discount rate meeting|minutes of the board|community (bank|development)|statistical release|job opening|scholarship|webinar|sponsored|deals? of the day|best (credit cards|savings|cd rates)|mortgage rates today)\b/i;

// Forward-looking items: the event hasn't happened yet
const PREVIEW_RE = /\b(due|ahead of|expected to|set to report|to report|on deck|what to expect|preview|looms?)\b/i;

const CTX_RE = /\b(opinion|analysis|explainer|column|commentary|what to watch|week ahead|preview|how to|should you|here's why|here is why|why you|podcast|newsletter|q&a|interview|review:)\b/i;

const STOP = new Set("a an the and or of to in on for at by with from as is are was were be been it its this that these those after before over under amid into out up down new says say said report reports update live latest more than vs via about".split(" "));

// Outlets paraphrase the same event; map common synonyms to one token
const SYN = {
  crude: "oil", brent: "oil", wti: "oil",
  washington: "us", "u.s.": "us", america: "us", american: "us",
  slip: "fall", drop: "fall", decline: "fall", slide: "fall", sink: "fall", tumble: "fall", plunge: "fall", lower: "fall", retreat: "fall", dip: "fall", sag: "fall",
  jump: "rise", surge: "rise", climb: "rise", gain: "rise", rally: "rise", soar: "rise", higher: "rise", spike: "rise", advance: "rise",
  earning: "profit", result: "profit", income: "profit",
  stock: "share", equity: "share", equities: "share",
  hike: "raise", hiking: "raise", top: "beat", exceed: "beat", tops: "beat",
  tsmc: "tsm", "taiwan semiconductor": "tsm", federal: "fed", reserve: "fed"
};
function stem(t) {
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("es") && !t.endsWith("ses")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
}
function tokens(title) {
  const out = new Set();
  for (let t of title.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9%$.\s-]/g, " ").split(/\s+/)) {
    t = t.replace(/^[.-]+|[.-]+$/g, "");
    if (t.length < 2 || STOP.has(t)) continue;
    if (SYN[t]) { out.add(SYN[t]); continue; }
    const s = stem(t);
    if (STOP.has(s)) continue;
    out.add(SYN[s] || s);
  }
  return out;
}
function shared(a, b) {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}
function jaccard(a, b) {
  const inter = shared(a, b);
  const u = a.size + b.size - inter;
  return u ? inter / u : 0;
}
/** Same story if enough distinctive words overlap. */
function similar(a, b) {
  const n = shared(a, b);
  if (n < 3) return 0;
  const overlap = n / Math.min(a.size, b.size);
  return Math.max(jaccard(a, b), overlap * 0.8);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/**
 * @param {Array} items parsed items
 * @param {{now?:number, maxAgeHours?:number}} opts
 * @returns {Array} stories sorted by score desc
 */
function rank(items, opts = {}) {
  const now = opts.now ?? Date.now();
  const maxAge = (opts.maxAgeHours ?? 72) * 3600e3;

  // dedupe exact links, drop stale and future-dated junk
  const seen = new Set();
  const fresh = [];
  for (const it of items) {
    if (now - it.ts > maxAge || it.ts - now > 3600e3) continue;
    const k = it.link.replace(/[?#].*$/, "");
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push({ ...it, tok: tokens(it.title), pub: publisherInfo(it.publisher, it.feedWeight) });
  }

  // cluster near-duplicate headlines (same story, different outlets)
  fresh.sort((a, b) => b.pub.weight - a.pub.weight || a.ts - b.ts);
  const clusters = [];
  for (const it of fresh) {
    let best = null, bestSim = 0;
    for (const c of clusters) {
      if (Math.abs(it.ts - c.ts) > 24 * 3600e3) continue; // same words a day apart are a new development
      const sim = similar(it.tok, c.tok);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    // compare against the lead headline's words only, so clusters don't snowball
    if (best && bestSim >= 0.5) best.items.push(it);
    else clusters.push({ items: [it], tok: it.tok, ts: it.ts });
  }

  const stories = clusters.map((c) => {
    const lead = c.items[0]; // highest authority, earliest
    const text = c.items.map((i) => i.title + " " + i.summary).join(" ");
    const leadText = lead.title + " " + lead.summary;

    const matched = RULES.filter((r) => r.re.test(leadText)).sort((a, b) => b.w - a.w);
    const weights = matched.map((r) => r.w);
    const topic = (weights[0] || 6) + 0.35 * (weights[1] || 0) + 0.15 * (weights[2] || 0);

    const tickers = [...new Set(TICKERS.filter(([re]) => re.test(text)).map(([, t]) => t))];
    const isMega = tickers.some((t) => MEGA.has(t));
    const megaBoost = isMega ? (matched.some((r) => r.key === "earn") ? 14 : 8) : 0;

    const publishers = [...new Map(c.items.map((i) => [i.pub.code, i])).values()];
    const confirm = Math.min(30, (publishers.length - 1) * 10);
    const authority = Math.max(...c.items.map((i) => i.pub.weight));
    const firstTs = Math.min(...c.items.map((i) => i.ts));
    const latestTs = Math.max(...c.items.map((i) => i.ts));
    const hours = (now - latestTs) / 3600e3;
    const recency = 20 * Math.exp(-hours / 6);

    const noise = (NOISE_RE.test(lead.title) ? 30 : 0) + (PREVIEW_RE.test(lead.title) ? 12 : 0);

    const score = Math.max(0, Math.min(100, Math.round(topic + confirm + authority + recency + megaBoost - noise)));
    const sev = score >= 75 ? "h" : score >= 50 ? "m" : "l";

    // desks come from the two strongest topic matches so side mentions don't misfile a story
    const desks = [...new Set(matched.slice(0, 2).flatMap((r) => r.desk))];
    if (tickers.length && !desks.includes("ERN") && matched.some((r) => r.key === "earn" || r.key === "deal")) desks.push("ERN");
    const region = (REGIONS.find(([, re]) => re.test(leadText)) || ["GLOBAL"])[0];
    if (region !== "US" && region !== "GLOBAL" && !desks.includes("GLB")) desks.push("GLB");
    if (!desks.length) desks.push(region === "US" ? "US" : "GLB");

    const assets = [...new Set([...tickers, ...matched.flatMap((r) => r.assets)])].slice(0, 6);
    const kind = c.items.every((i) => i.kind === "ctx") || CTX_RE.test(lead.title) ? "ctx" : "news";
    const conf = Math.min(0.99, 0.25 + Math.min(publishers.length, 5) * 0.1 + authority * 0.03 + (matched.length ? 0.05 : 0));

    return {
      id: hash(lead.link),
      title: lead.title,
      summary: c.items.map((i) => i.summary).find(Boolean) || "",
      link: lead.link,
      publisher: lead.publisher,
      code: lead.pub.code,
      ts: firstTs,
      updated: latestTs,
      score, sev, kind,
      desks,
      region,
      signal: matched[0]?.sig || (tickers.length ? "COMPANY NEWS" : "GENERAL"),
      why: matched[0]?.why || "No macro trigger detected; ranked on source coverage and recency.",
      assets,
      conf: Number(conf.toFixed(2)),
      sources: publishers.map((i) => ({ code: i.pub.code, name: i.publisher, link: i.link, title: i.title }))
    };
  });

  return stories.sort((a, b) => b.score - a.score || b.updated - a.updated);
}

module.exports = { rank, tokens, jaccard, similar, publisherInfo, RULES };
