// Consensus forecasts, actuals and global events for the Calendar page, from Nasdaq's free
// economic calendar (api.nasdaq.com/api/calendar/economicevents?date=YYYY-MM-DD, no key).
// Each row: { gmt: "08:30", country, eventName, actual, consensus, previous, description }.
// Despite its name, "gmt" is US Eastern at a fixed offset: the one in force when it's fetched
// (October CPI shows 08:30, a November 8:30 EST release shows 09:30 while it's still EDT).
// And ?date=D answers with the events of the day before D (Wednesday's MBA and Beige Book come
// back for Thursday's date), so fetchDay asks for the next day.
// No period, importance or revisions come with it, so Tickerkite adds importance from the table below
// and works out revisions from the release history it keeps (calendar-history.json).

const DAY = 864e5;
const nasdaq = require("./data/nasdaq");

// country → [code, flag, region, G10]
const COUNTRIES = {
  "United States": ["US", "🇺🇸", "am", 1], Canada: ["CA", "🇨🇦", "am", 1], Mexico: ["MX", "🇲🇽", "am", 0], Brazil: ["BR", "🇧🇷", "am", 0],
  Argentina: ["AR", "🇦🇷", "am", 0], Chile: ["CL", "🇨🇱", "am", 0], Colombia: ["CO", "🇨🇴", "am", 0], Peru: ["PE", "🇵🇪", "am", 0],
  "Euro Zone": ["EZ", "🇪🇺", "eu", 1], Germany: ["DE", "🇩🇪", "eu", 1], France: ["FR", "🇫🇷", "eu", 1], Italy: ["IT", "🇮🇹", "eu", 1],
  Spain: ["ES", "🇪🇸", "eu", 1], "United Kingdom": ["GB", "🇬🇧", "eu", 1], Switzerland: ["CH", "🇨🇭", "eu", 1], Sweden: ["SE", "🇸🇪", "eu", 1],
  Norway: ["NO", "🇳🇴", "eu", 1], Denmark: ["DK", "🇩🇰", "eu", 0], Netherlands: ["NL", "🇳🇱", "eu", 0], Belgium: ["BE", "🇧🇪", "eu", 0],
  Austria: ["AT", "🇦🇹", "eu", 0], Ireland: ["IE", "🇮🇪", "eu", 0], Portugal: ["PT", "🇵🇹", "eu", 0], Greece: ["GR", "🇬🇷", "eu", 0],
  Finland: ["FI", "🇫🇮", "eu", 0], Poland: ["PL", "🇵🇱", "eu", 0], "Czech Republic": ["CZ", "🇨🇿", "eu", 0], Hungary: ["HU", "🇭🇺", "eu", 0],
  Russia: ["RU", "🇷🇺", "eu", 0], Turkey: ["TR", "🇹🇷", "eu", 0], "South Africa": ["ZA", "🇿🇦", "eu", 0], Israel: ["IL", "🇮🇱", "eu", 0],
  "Saudi Arabia": ["SA", "🇸🇦", "eu", 0], "United Arab Emirates": ["AE", "🇦🇪", "eu", 0], Egypt: ["EG", "🇪🇬", "eu", 0], Nigeria: ["NG", "🇳🇬", "eu", 0],
  Japan: ["JP", "🇯🇵", "as", 1], Australia: ["AU", "🇦🇺", "as", 1], "New Zealand": ["NZ", "🇳🇿", "as", 1], China: ["CN", "🇨🇳", "as", 0],
  "Hong Kong": ["HK", "🇭🇰", "as", 0], India: ["IN", "🇮🇳", "as", 0], "South Korea": ["KR", "🇰🇷", "as", 0], Singapore: ["SG", "🇸🇬", "as", 0],
  Taiwan: ["TW", "🇹🇼", "as", 0], Indonesia: ["ID", "🇮🇩", "as", 0], Thailand: ["TH", "🇹🇭", "as", 0], Malaysia: ["MY", "🇲🇾", "as", 0],
  Philippines: ["PH", "🇵🇭", "as", 0], Vietnam: ["VN", "🇻🇳", "as", 0]
};
function country(name) {
  const c = COUNTRIES[String(name || "").trim()];
  if (c) return { code: c[0], flag: c[1], region: c[2], g10: !!c[3] };
  return { code: String(name || "??").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??", flag: "🌐", region: "world", g10: false };
}

// Importance (3 high, 2 medium, 1 low). Anything with a consensus that isn't listed is medium.
const HIGH = /^(core )?cpi\b|nonfarm payrolls|unemployment rate|^gdp\b|gdp \(|interest rate decision|rate statement|^(core )?pce price|retail sales|^(core )?ppi\b|ism (manufacturing|non-manufacturing|services) pmi|jolts job openings|initial jobless claims|employment change|fomc (statement|minutes|economic projections)|fed chair .* speaks|(ecb president|boe gov|boj gov|boc gov|rba gov|snb chairman) .* speaks|monetary policy statement|hicp|^(german|french|italian|spanish|japanese|chinese|national) (cpi|gdp)|manufacturing pmi|services pmi|composite pmi|average hourly earnings|trade balance|industrial production|michigan consumer sentiment|cb consumer confidence|ifo business climate|zew economic sentiment|tankan|loan prime rate/i;
function importance(name, hasSurvey) {
  return HIGH.test(name) ? 3 : hasSurvey ? 2 : 1;
}

const clean = (s) => String(s ?? "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** "1,080.0B" / "-39.3K" / "7.50%" / "336.94" → { v, unit, dec, s }, or null for blanks. */
function parseNum(s) {
  const str = clean(s);
  const m = /^([+-]?)\s*([\d,]*\.?\d+)\s*(%|[KMBT])?$/i.exec(str);
  if (!m) return null;
  const digits = m[2].replace(/,/g, "");
  return { v: +(m[1] + digits), unit: (m[3] || "").toUpperCase(), dec: (digits.split(".")[1] || "").length, s: str };
}
/** actual − survey, when both are numbers in the same unit. */
function surprise(actual, survey) {
  const a = typeof actual === "object" ? actual : parseNum(actual), b = typeof survey === "object" ? survey : parseNum(survey);
  if (!a || !b || a.unit !== b.unit) return null;
  const dec = Math.max(a.dec, b.dec);
  return { v: +(a.v - b.v).toFixed(dec), unit: a.unit, dec };
}
function fmtNum(x, sign = false) {
  if (!x) return "";
  const s = Math.abs(x.v).toLocaleString("en-US", { minimumFractionDigits: x.dec, maximumFractionDigits: x.dec });
  return (x.v < 0 ? "-" : sign && x.v > 0 ? "+" : "") + s + x.unit;
}

/** ET's current UTC offset in ms (negative), used to read Nasdaq's fixed-offset times. */
function etOffset(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)).map((x) => [x.type, +x.value]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - now) / 900e3) * 900e3; // whole quarter-hours (seconds dropped above)
}

/** Nasdaq's JSON for the events of `date` (an ET day) → rows. `offset` is the ET offset at fetch time. Repeated names in a
 *  day (CPI y/y then m/m) get "#2", "#3" on their key, in Nasdaq's order. */
function parseDay(json, date, offset) {
  if (json?.data === null && json?.status?.rCode === 200) return []; // "No record found" (quiet days)
  const rows = json?.data?.rows;
  if (!Array.isArray(rows)) return null;
  const seen = {}, out = [];
  for (const r of rows) {
    const name = clean(r.eventName);
    if (!name) continue;
    const c = country(r.country);
    const base = `${c.code}:${slug(name)}`;
    seen[base] = (seen[base] || 0) + 1;
    const key = seen[base] > 1 ? `${base}#${seen[base]}` : base;
    const tm = /^(\d{1,2}):(\d{2})$/.exec(clean(r.gmt));
    const [y, mo, d] = date.split("-").map(Number);
    const t = tm ? Date.UTC(y, mo - 1, d, +tm[1], +tm[2]) - offset : Date.UTC(y, mo - 1, d) - offset;
    const survey = clean(r.consensus), actual = clean(r.actual), previous = clean(r.previous);
    out.push({
      key, date, t, timed: !!tm, base: name, name: seen[base] > 1 ? `${name} (${seen[base]})` : name, country: clean(r.country), code: c.code, flag: c.flag, region: c.region, g10: c.g10,
      rel: importance(name, !!survey), survey, actual, previous, desc: clean(r.description).replace(/<br\s*\/?>/gi, "\n").slice(0, 600)
    });
  }
  return out;
}

/** Repeated names in a day (CPI y/y and m/m, Building Permits level and %) don't come in a fixed
 *  order, so give each one the "#n" key of the series it continues: its "previous" should match that
 *  series' last actual (or, going back in time, its actual the next release's prior), in the same unit. */
function assignKeys(rows, hist) {
  const groups = {};
  for (const r of rows) (groups[r.key.replace(/#\d+$/, "")] ||= []).push(r);
  const n = (s) => parseNum(s);
  function cost(r, key) {
    const list = hist?.[key]?.list || [];
    if (!list.length) return 0;
    const before = [...list].reverse().find((x) => x.date < r.date && x.actual), after = list.find((x) => x.date > r.date && x.prior);
    const [a, b] = before ? [n(r.previous), n(before.revised || before.actual)] : after ? [n(r.actual), n(after.prior)] : [null, null];
    const unitOf = n(r.actual || r.previous || r.survey)?.unit, histUnit = n(list[list.length - 1].actual || list[list.length - 1].prior)?.unit;
    if (unitOf != null && histUnit != null && unitOf !== histUnit) return 1e6;
    if (!a || !b) return 1;
    return Math.abs(a.v - b.v) / (Math.abs(b.v) + 1e-9);
  }
  const perms = (xs) => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
  for (const [base, g] of Object.entries(groups)) {
    if (g.length < 2 || g.length > 5) continue;
    const keys = g.map((_, i) => (i ? `${base}#${i + 1}` : base));
    let best = null, bestCost = Infinity;
    for (const p of perms(keys)) { const c = g.reduce((s, r, i) => s + cost(r, p[i]), 0); if (c < bestCost - 1e-12) { bestCost = c; best = p; } }
    g.forEach((r, i) => { const k = best[i], m = /#(\d+)$/.exec(k); r.key = k; r.name = m ? `${r.base} (${m[1]})` : r.base; });
  }
  return rows;
}

// ---------- release history ----------
const MAX_HIST = 36;
/** Add a day's rows to the history: { [key]: { name, code, flag, list: [{ date, t, actual, survey, prior, revised? }] } }.
 *  When a release's "previous" differs from what the last release printed, that's a revision. */
function record(hist, rows) {
  for (const r of rows || []) {
    if (!r.actual && !r.survey) continue;
    const h = hist[r.key] ||= { name: r.name, code: r.code, flag: r.flag, list: [] };
    h.name = r.name;
    let e = h.list.find((x) => x.date === r.date);
    if (!e) { e = { date: r.date }; h.list.push(e); h.list.sort((a, b) => a.date.localeCompare(b.date)); }
    Object.assign(e, { t: r.t, actual: r.actual || e.actual || "", survey: r.survey || e.survey || "", prior: r.previous || e.prior || "" });
    const i = h.list.indexOf(e), prev = h.list[i - 1];
    if (prev && e.prior && prev.actual && parseNum(prev.actual)?.v !== parseNum(e.prior)?.v) prev.revised = e.prior;
    if (h.list.length > MAX_HIST) h.list.splice(0, h.list.length - MAX_HIST);
  }
  return hist;
}

/** Prior as first printed, and the revised value if it changed since. */
function priorOf(hist, r) {
  const list = hist?.[r.key]?.list || [];
  const prev = [...list].reverse().find((x) => x.date < r.date && x.actual);
  if (prev && r.previous && parseNum(prev.actual)?.v !== parseNum(r.previous)?.v) return { prior: prev.actual, revised: r.previous };
  return { prior: r.previous || prev?.actual || "", revised: "" };
}

/** Surprise summary over releases with both an actual and a survey (newest `n`). */
function stats(list, n = 24) {
  const xs = (list || []).filter((e) => parseNum(e.actual) && parseNum(e.survey)).slice(-n).map((e) => surprise(e.actual, e.survey)).filter(Boolean);
  if (!xs.length) return null;
  const dec = Math.max(...xs.map((x) => x.dec)), unit = xs[0].unit;
  const above = xs.filter((x) => x.v > 0).length, below = xs.filter((x) => x.v < 0).length;
  const mean = xs.reduce((a, x) => a + x.v, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x.v - mean) ** 2, 0) / (xs.length - 1)) : 0;
  const miss = xs.reduce((a, x) => a + Math.abs(x.v), 0) / xs.length;
  const d = Math.max(1, dec), r = (v) => ({ v: +v.toFixed(d), unit, dec: d });
  return { n: xs.length, above, below, on: xs.length - above - below, miss: r(miss), sd: r(sd) };
}

// ---------- merging with the official schedule ----------
// Which Nasdaq row carries the consensus for each official release (US, same ET day; first match wins).
const MATCH = {
  cpi: /^cpi$/i, ppi: /^ppi$/i, jobs: /^nonfarm payrolls$/i, jolts: /^jolts job openings$/i, claims: /^initial jobless claims$/i,
  gdp: /^gdp( \(qoq\)| annualized| growth rate)?$/i, pce: /^core pce price index$/i, retail: /^retail sales$/i, fomc: /^fed interest rate decision$/i
};
const DEFAULT_KEY = { cpi: "US:cpi", ppi: "US:ppi", jobs: "US:nonfarm-payrolls", jolts: "US:jolts-job-openings", claims: "US:initial-jobless-claims", gdp: "US:gdp", pce: "US:core-pce-price-index", retail: "US:retail-sales", fomc: "US:fed-interest-rate-decision" };
const US = country("United States");
const FEDLIKE = /\b(fomc|fed|federal reserve|beige book|powell)\b/i;

/** Official events + Nasdaq rows → one list. Official events take a matching row's survey/actual/prior;
 *  remaining rows become their own events. `etDay` maps epoch ms → ET day number. */
function merge(events, rows, hist, etDay) {
  const used = new Set();
  const byDay = {};
  for (const r of rows || []) (byDay[etDay(r.t)] ||= []).push(r);
  const out = events.map((e) => {
    if (e.cat === "earnings") return { code: "US", flag: US.flag, region: "am", g10: true, ...e, rel: 2 };
    const re = MATCH[e.key];
    const row = re && (byDay[etDay(e.t)] || []).find((r) => r.code === "US" && re.test(r.name) && !used.has(r));
    const base = { ...e, code: "US", flag: US.flag, region: "am", g10: true, rel: 3, hkey: row?.key || DEFAULT_KEY[e.key] || null };
    if (!row) return base;
    used.add(row);
    return { ...base, survey: row.survey, actual: row.actual, ...priorOf(hist, row), nq: true, desc: row.desc };
  });
  for (const r of rows || []) {
    if (used.has(r)) continue;
    out.push({
      id: `nq:${r.key}:${r.date}`, cat: r.code === "US" && FEDLIKE.test(r.name) ? "fed" : "macro", key: "nq", hkey: r.key, title: r.name, ref: "",
      t: r.t, timed: r.timed, fallback: false, estimated: false, src: "Nasdaq", code: r.code, flag: r.flag, region: r.region, g10: r.g10, rel: r.rel,
      survey: r.survey, actual: r.actual, ...priorOf(hist, r), nq: true, desc: r.desc
    });
  }
  return out.sort((a, b) => a.t - b.t || b.rel - a.rel || a.title.localeCompare(b.title));
}

// ---------- fetching ----------
async function fetchDay(date, timeoutMs = 15000) {
  const ask = new Date(Date.parse(date) + DAY).toISOString().slice(0, 10);
  const rows = parseDay(await nasdaq.economicEvents(ask, timeoutMs), date, etOffset());
  if (!rows) throw new Error("unexpected reply");
  return rows;
}

/** Is a cached day still good? Past days settle once fetched 2+ days later; today changes as numbers print. */
function fresh(entry, date, today, now = Date.now()) {
  if (!entry?.at) return false;
  if (date < today && entry.at > Date.parse(date) + 2 * DAY) return true;
  return now - entry.at < (date < today ? 3 * 3600e3 : date === today ? 10 * 60e3 : 6 * 3600e3);
}

module.exports = { COUNTRIES, country, importance, parseNum, surprise, fmtNum, etOffset, parseDay, assignKeys, record, priorOf, stats, merge, fetchDay, fresh, MATCH, DEFAULT_KEY, MAX_HIST };
