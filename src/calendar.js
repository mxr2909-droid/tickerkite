// Economic calendar: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, Notification, showStory, showPage }
//  - IPC channels must start with "calendar:" (the preload only forwards those for this page)
//  - bus emits "news" (stories), "quotes" (quotes), "scores" (scorecard result) after each refresh
//  - get() returns { stories, quotes, watch, scores } right now
//
// Sources (all free, no keys), cached in userData/calendar-cache.json and refreshed daily:
//  - Fed:    federalreserve.gov FOMC calendar page (parsed)
//  - BEA:    bea.gov/news/schedule (GDP, personal income & outlays = PCE), parsed
//  - Census: census.gov retail release schedule (advance retail sales), parsed
//  - BLS:    bls.gov per-release schedule pages (CPI, PPI, jobs, JOLTS). BLS blocks most scripts,
//            so a failed fetch falls back to the list below, which is marked "fallback" in the UI.
//  - DOL:    initial jobless claims, every Thursday 8:30 ET (Wednesday in a Thanksgiving/Christmas week)
//  - Earnings: the company panel's date for each watchlist stock (Nasdaq, else "estimated")

const company = require("./company");
const SC = require("./macro/score");
const { INDICATORS } = require("./macro/indicators");

const DAY = 864e5;
const TTL = 20 * 3600e3;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// What each release is, which scorecard indicators it moves, and words for the headline match.
const RELEASES = {
  cpi: { name: "CPI", long: "Consumer prices", agency: "BLS", ind: ["cpi", "corecpi"], words: ["cpi", "consumer price", "inflation"] },
  ppi: { name: "PPI", long: "Producer prices", agency: "BLS", ind: ["ppi"], words: ["ppi", "producer price", "wholesale price"] },
  jobs: { name: "Jobs report", long: "Employment situation (payrolls, unemployment)", agency: "BLS", ind: ["payrolls", "unrate"], words: ["payroll", "jobs report", "nonfarm", "unemployment rate", "hiring"] },
  jolts: { name: "JOLTS", long: "Job openings and labor turnover", agency: "BLS", ind: ["jolts"], words: ["jolts", "job openings"] },
  claims: { name: "Jobless claims", long: "Initial unemployment claims (weekly)", agency: "DOL", ind: ["claims"], words: ["jobless claims", "unemployment claims", "initial claims"] },
  gdp: { name: "GDP", long: "Gross domestic product", agency: "BEA", ind: ["gdp"], words: ["gdp", "gross domestic", "economy grew", "economy shrank", "economic growth"] },
  pce: { name: "PCE", long: "Personal income & outlays (PCE inflation)", agency: "BEA", ind: ["corepce"], words: ["pce", "personal consumption", "personal income", "consumer spending"] },
  retail: { name: "Retail sales", long: "Advance monthly retail sales", agency: "Census", ind: ["retail"], words: ["retail sales", "retail spending"] },
  fomc: { name: "FOMC decision", long: "Federal Reserve rate decision", agency: "Fed", ind: [], words: ["fed", "fomc", "powell", "rate cut", "rate hike", "federal reserve", "interest rate"] }
};
const BLS_PAGES = { cpi: "cpi", ppi: "ppi", jobs: "empsit", jolts: "jolts" };

// Checked fallbacks, used when a source can't be reached. Times are ET.
const FALLBACK_CHECKED = "2026-10-15";
const FALLBACK = {
  // bls.gov/schedule/news_release/{cpi,ppi,empsit,jolts}.htm, read in a browser on FALLBACK_CHECKED
  bls: {
    cpi: ["2026-11-10", "2026-12-10", "2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13", "2027-05-12", "2027-06-10", "2027-07-14", "2027-08-11", "2027-09-14", "2027-10-14", "2027-11-10", "2027-12-10"],
    ppi: ["2026-11-13", "2026-12-15", "2027-01-14", "2027-02-12", "2027-03-12", "2027-04-14", "2027-05-13", "2027-06-11", "2027-07-15", "2027-08-10", "2027-09-10", "2027-10-15", "2027-11-12", "2027-12-15"],
    jobs: ["2026-11-06", "2026-12-04", "2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07", "2027-06-04", "2027-07-02", "2027-08-06", "2027-09-03", "2027-10-08", "2027-11-05", "2027-12-03"],
    jolts: ["2026-12-01"]
  },
  // census.gov/retail/release_schedule.html
  retail: ["2026-10-15", "2026-11-17", "2026-12-16"],
  // federalreserve.gov/monetarypolicy/fomccalendars.htm: [first day, decision day, projections?]
  fomc: [["2026-10-27", "2026-10-28", false], ["2026-12-08", "2026-12-09", true], ["2027-01-26", "2027-01-27", false], ["2027-03-16", "2027-03-17", true], ["2027-04-27", "2027-04-28", false], ["2027-06-08", "2027-06-09", true], ["2027-07-27", "2027-07-28", false], ["2027-09-14", "2027-09-15", true], ["2027-10-26", "2027-10-27", false], ["2027-12-07", "2027-12-08", true]],
  // bea.gov/news/schedule
  bea: [["2026-10-29", "08:30", "gdp", "3rd Quarter 2026 (advance)"], ["2026-10-29", "08:30", "pce", "September 2026"],
    ["2026-11-25", "08:30", "gdp", "3rd Quarter 2026 (second)"], ["2026-11-25", "08:30", "pce", "October 2026"],
    ["2026-12-23", "08:30", "gdp", "3rd Quarter 2026 (third)"], ["2026-12-23", "08:30", "pce", "November 2026"]]
};
const BLS_TIME = { cpi: "08:30", ppi: "08:30", jobs: "08:30", jolts: "10:00" };
const BLS_REF_LAG = { cpi: 1, ppi: 1, jobs: 1, jolts: 2 }; // months between reference month and release

// ---------- time helpers (everything shown in US Eastern time) ----------
const ETF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function etParts(t) {
  const p = Object.fromEntries(ETF.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
/** "YYYY-MM-DD" + "HH:MM" Eastern → epoch ms (handles daylight saving). */
function etToMs(date, time = "00:00") {
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let t = want + 5 * 3600e3;
  for (let i = 0; i < 2; i++) { const p = etParts(t); t += want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); }
  return t;
}
const etDay = (t) => { const p = etParts(t); return Date.UTC(p.y, p.mo - 1, p.d) / DAY; };
const isoDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
function etClock(t) { const p = etParts(t); return `${p.h}:${String(p.mi).padStart(2, "0")} ET`; }

/** Countdown label: "in 42 min", "today 8:30 ET", "tomorrow 14:00 ET", "in 3 days", "yesterday", "5 days ago". */
function countdown(t, timed = true, now = Date.now()) {
  const dd = etDay(t) - etDay(now);
  const at = timed ? " " + etClock(t) : "";
  if (dd === 0) {
    if (!timed) return "today";
    if (t <= now) return "out " + etClock(t);
    const m = Math.round((t - now) / 60e3);
    return m <= 90 ? `in ${m} min` : "today" + at;
  }
  if (dd === 1) return "tomorrow" + at;
  if (dd > 1) return `in ${dd} days`;
  return dd === -1 ? "yesterday" : `${-dd} days ago`;
}

function monthIdx(s) { return MONTHS.indexOf(String(s).slice(0, 3).toLowerCase()); }
function ymd(y, m, d) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function to24(s) { // "8:30 AM" → "08:30"
  const m = /(\d{1,2}):(\d{2})\s*([AP])\.?M/i.exec(s || "");
  if (!m) return null;
  let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}
const text = (html) => String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

/** Start of a reference period ("September 2026", "3rd Quarter 2026") as epoch ms, or null. */
function refStart(ref) {
  let m = /(\w+)\s+(\d{4})/.exec(ref || "");
  const q = /(\d)(?:st|nd|rd|th)\s+Quarter\s+(\d{4})/i.exec(ref || "");
  if (q) return Date.UTC(+q[2], (+q[1] - 1) * 3, 1);
  if (m && monthIdx(m[1]) >= 0) return Date.UTC(+m[2], monthIdx(m[1]), 1);
  return null;
}

// ---------- parsers ----------
/** FOMC calendar page → [{ start, date, sep }] for scheduled meetings (date = decision day). */
function parseFomc(html) {
  const out = [];
  const parts = String(html).split(/(\d{4}) FOMC Meetings/);
  for (let i = 1; i < parts.length; i += 2) {
    const year = +parts[i], body = parts[i + 1];
    const re = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g;
    let m;
    while ((m = re.exec(body))) {
      const [mon1, mon2 = mon1] = m[1].trim().split("/");
      const dm = /^(\d{1,2})(?:-(\d{1,2}))?(\*)?$/.exec(m[2].trim()); // skips notation votes, unscheduled meetings
      if (!dm || monthIdx(mon1) < 0) continue;
      const d1 = +dm[1], d2 = dm[2] ? +dm[2] : d1;
      const m1 = monthIdx(mon1), m2 = monthIdx(mon2) >= 0 ? monthIdx(mon2) : m1;
      const y2 = m2 < m1 ? year + 1 : year;
      out.push({ start: ymd(year, m1, d1), date: ymd(y2, d2 < d1 && m2 === m1 ? m1 + 1 : m2, d2), sep: !!dm[3] });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** A BLS release schedule page → [{ ref, date, time }]. */
function parseBls(html) {
  const out = [];
  const re = /([A-Z][a-z]+ \d{4})\s+([A-Z][a-z]{2,8})\.? (\d{1,2}), (\d{4})\s+(\d{1,2}:\d{2} [AP]M)/g;
  let m;
  const s = text(html);
  while ((m = re.exec(s))) if (monthIdx(m[2]) >= 0) out.push({ ref: m[1], date: ymd(+m[4], monthIdx(m[2]), +m[3]), time: to24(m[5]) });
  return out;
}

/** BEA's schedule (dates without a year) → [{ key, ref, date, time }] for GDP and PCE. */
function parseBea(html, now = Date.now()) {
  const out = [];
  const re = /release-date">\s*([A-Za-z]+)\s+(\d{1,2})\s*<\/div>\s*(?:<small[^>]*>([^<]*)<\/small>)?[\s\S]*?release-title[^>]*>([^<]+)</g;
  const today = etDay(now);
  let m;
  while ((m = re.exec(String(html)))) {
    const title = m[4].trim(), mi = monthIdx(m[1]);
    const key = /^GDP\b|Gross Domestic Product(?! by)/i.test(title) && !/by (State|County|Industry)/i.test(title) ? "gdp" : /^Personal Income and Outlays/i.test(title) ? "pce" : null;
    if (!key || mi < 0) continue;
    // the page has no year: pick the one that puts the date nearest to today
    const y0 = new Date(now).getUTCFullYear();
    const y = [y0 - 1, y0, y0 + 1].sort((a, b) => Math.abs(Date.UTC(a, mi, +m[2]) / DAY - today) - Math.abs(Date.UTC(b, mi, +m[2]) / DAY - today))[0];
    const ref = (/\d\w+ Quarter \d{4}|[A-Z][a-z]+ \d{4}/.exec(title) || [""])[0];
    const stage = (/\((\w[^)]*?) Estimate\)/i.exec(title) || [])[1];
    out.push({ key, ref: stage ? `${ref} (${stage.toLowerCase()})` : ref, date: ymd(y, mi, +m[2]), time: to24(m[3]) || "08:30" });
  }
  return out;
}

/** Census retail schedule → [{ ref, date }] for the advance monthly report. */
function parseCensus(html) {
  const s = text(html);
  const a = s.search(/Advance Monthly Retail Trade Report/i);
  if (a < 0) return [];
  const body = s.slice(a, s.indexOf("Historical", a) > 0 ? s.indexOf("Historical", a) : undefined);
  const out = [];
  const re = /([A-Z][a-z]+ \d{4})\s+([A-Z][a-z]+) (\d{1,2}), (\d{4})/g;
  let m;
  while ((m = re.exec(body))) if (monthIdx(m[2]) >= 0) out.push({ ref: m[1], date: ymd(+m[4], monthIdx(m[2]), +m[3]) });
  return out;
}

/** Thursdays from `from` for `weeks` weeks; Thanksgiving and Christmas-week releases move to Wednesday. */
function claimsDates(from = Date.now(), weeks = 8) {
  const out = [];
  let d = etDay(from);
  while (new Date(d * DAY).getUTCDay() !== 4) d++;
  for (let i = 0; i < weeks; i++, d += 7) {
    const dt = new Date(d * DAY), mo = dt.getUTCMonth(), day = dt.getUTCDate();
    const thanksgiving = mo === 10 && day >= 22 && day <= 28;
    const xmas = mo === 11 && day >= 25 && day <= 31 || mo === 0 && day === 1;
    out.push(isoDay(thanksgiving || xmas ? d - 1 : d));
  }
  return out;
}

function meetingLabel(a, b) { // "Oct 27–28", "Oct 31–Nov 1"
  const f = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return a === b ? f(a) : a.slice(0, 7) === b.slice(0, 7) ? `${f(a)}–${+b.slice(8)}` : `${f(a)}–${f(b)}`;
}
const refBefore = (date, months) => { const [y, m] = date.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 - months, 1)); return `${t.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${t.getUTCFullYear()}`; };

// ---------- event list ----------
/** Turn cached schedules into a sorted event list. Pure, for tests. */
function buildEvents(sched, earnings = [], now = Date.now()) {
  const ev = [];
  const add = (o) => ev.push({ timed: true, fallback: false, estimated: false, ...o });
  for (const m of sched.fomc?.items || []) {
    add({ id: `fomc:${m.date}`, cat: "fed", key: "fomc", title: m.sep ? "FOMC decision + projections" : "FOMC decision", ref: meetingLabel(m.start, m.date), t: etToMs(m.date, "14:00"), fallback: !sched.fomc.live, src: "Federal Reserve" });
  }
  for (const k of Object.keys(BLS_PAGES)) {
    const s = sched.bls?.[k];
    for (const r of s?.items || []) add({ id: `${k}:${r.date}`, cat: "macro", key: k, title: RELEASES[k].name, ref: r.ref, t: etToMs(r.date, r.time || BLS_TIME[k]), fallback: !s.live, src: "BLS" });
  }
  for (const r of sched.bea?.items || []) add({ id: `${r.key}:${r.date}`, cat: "macro", key: r.key, title: RELEASES[r.key].name, ref: r.ref, t: etToMs(r.date, r.time), fallback: !sched.bea.live, src: "BEA" });
  for (const r of sched.retail?.items || []) add({ id: `retail:${r.date}`, cat: "macro", key: "retail", title: RELEASES.retail.name, ref: r.ref, t: etToMs(r.date, "08:30"), fallback: !sched.retail.live, src: "Census" });
  for (const d of claimsDates(now - 7 * DAY, 9)) add({ id: `claims:${d}`, cat: "macro", key: "claims", title: RELEASES.claims.name, ref: "Week ending " + isoDay(Date.parse(d) / DAY - 5), t: etToMs(d, "08:30"), src: "Labor Dept (weekly rule)" });
  for (const e of earnings) add({ id: `earn:${e.sym}`, cat: "earnings", key: "earn", sym: e.sym, title: `${e.sym} earnings`, ref: e.name || e.sym, t: etToMs(e.date, "00:00"), timed: false, estimated: !!e.estimated, src: e.source || "" });
  const lo = etDay(now) - 7, hi = etDay(now) + 366;
  const seen = new Set();
  return ev.filter((e) => { const d = etDay(e.t); if (d < lo || d > hi || seen.has(e.id)) return false; seen.add(e.id); return true; }).sort((a, b) => a.t - b.t || a.title.localeCompare(b.title));
}

/** Latest and previous readings for the calendar's indicators, from the scorecard's raw series. */
function readings(raw, ind = {}) {
  const out = {};
  for (const k of Object.values(RELEASES)) for (const id of k.ind) {
    const def = INDICATORS.find((d) => d.id === id);
    if (!def) continue;
    let s = null;
    try { s = raw ? SC.transform(def, raw) : null; } catch {}
    const last = s?.[s.length - 1], prev = s?.[s.length - 2];
    if (last) out[id] = { name: def.name, unit: def.unit, dec: def.dec, t: last[0], v: last[1], pt: prev?.[0], pv: prev?.[1] };
    else if (ind[id]) out[id] = { name: def.name, unit: def.unit, dec: def.dec, t: ind[id].t, v: ind[id].v };
  }
  return out;
}

/** Stories whose title matches any of the words (whole-word, case-insensitive), newest first. */
function headlines(stories, words, max = 12) {
  if (!words?.length) return [];
  const re = new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
  return (stories || []).filter((s) => re.test(s.title || "")).slice(0, max);
}

// ---------- fetching ----------
async function getText(url, timeoutMs = 15000) {
  // Electron's own network stack looks like a browser to BLS's bot filter; plain fetch elsewhere
  let f = fetch;
  try { const { net } = require("electron"); if (net?.fetch) f = net.fetch.bind(net); } catch {}
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await f(url, { signal: ac.signal, headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(tm); }
}

function fallbackSched() {
  const bls = {};
  for (const k of Object.keys(BLS_PAGES)) bls[k] = { live: false, items: FALLBACK.bls[k].map((d) => ({ date: d, time: BLS_TIME[k], ref: refBefore(d, BLS_REF_LAG[k]) })) };
  return {
    fomc: { live: false, items: FALLBACK.fomc.map(([start, date, sep]) => ({ start, date, sep })) },
    bls,
    bea: { live: false, items: FALLBACK.bea.map(([date, time, key, ref]) => ({ date, time, key, ref })) },
    retail: { live: false, items: FALLBACK.retail.map((d) => ({ date: d, ref: refBefore(d, 1) })) }
  };
}

/** Refresh every schedule; a source that fails keeps its cached copy, else the fallback list. */
async function fetchSchedules(prev) {
  const fb = fallbackSched();
  const base = prev?.sched || fb;
  const sched = { bls: { ...base.bls } }, errors = {};
  const tryOne = async (name, fn, keep) => {
    try { const items = await fn(); if (!items.length) throw new Error("nothing parsed"); return { live: true, items, at: Date.now() }; }
    catch (e) { errors[name] = String(e.message || e); return keep?.items?.length ? keep : fb[name] || fb.bls[name]; }
  };
  await Promise.all([
    tryOne("fomc", async () => parseFomc(await getText("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm")), base.fomc).then((r) => { sched.fomc = r; }),
    tryOne("bea", async () => parseBea(await getText("https://www.bea.gov/news/schedule")), base.bea).then((r) => { sched.bea = r; }),
    tryOne("retail", async () => parseCensus(await getText("https://www.census.gov/retail/release_schedule.html")), base.retail).then((r) => { sched.retail = r; }),
    ...Object.entries(BLS_PAGES).map(([k, page]) => tryOne(k, async () => parseBls(await getText(`https://www.bls.gov/schedule/news_release/${page}.htm`)), base.bls?.[k]).then((r) => { sched.bls[k] = r; }))
  ]);
  return { at: Date.now(), sched, errors };
}

// ---------- wiring ----------
function register(ctx) {
  let cache = ctx.readJSON("calendar-cache.json", null);
  let loading = null, vals = null, valsAt = 0;
  const tried = new Set(); // watchlist symbols already sent to the company panel this session
  const store = { read: ctx.readJSON, write: ctx.writeJSON };

  function earnings() {
    const cc = ctx.readJSON("company-cache.json", {});
    const out = [];
    for (const w of ctx.get().watch || []) {
      const d = cc[w.sym]?.data;
      if (!d?.earnings) continue;
      let e = d.earnings;
      if (Date.parse(e.date) < Date.now() - DAY) e = company.estimateNextReport(d.filings || []);
      if (e?.date) out.push({ sym: w.sym, name: d.name || w.name, ...e });
    }
    return out;
  }
  // fill in watchlist stocks the company panel hasn't looked up yet, one at a time
  async function fillEarnings() {
    const cc = ctx.readJSON("company-cache.json", {});
    const contact = ctx.readJSON("prefs.json", {}).secContact;
    let added = false;
    for (const w of ctx.get().watch || []) {
      if (cc[w.sym] || tried.has(w.sym)) continue;
      tried.add(w.sym);
      try { const r = await company.fetchCompany(w.sym, { store, contact }); if (r?.earnings) added = true; } catch {}
    }
    if (added) push();
  }
  function values() {
    if (!vals || Date.now() - valsAt > 10 * 60e3) {
      vals = readings(ctx.readJSON("macro-cache.json", null)?.series, ctx.get().scores?.ind);
      valsAt = Date.now();
    }
    return vals;
  }
  function payload() {
    const sched = cache?.sched || fallbackSched();
    const status = {};
    for (const [k, s] of [["fomc", sched.fomc], ["bea", sched.bea], ["retail", sched.retail], ...Object.entries(sched.bls || {})]) status[k] = { live: !!s?.live, at: s?.at || 0, error: cache?.errors?.[k] || null };
    return { events: buildEvents(sched, earnings()), values: values(), releases: RELEASES, status, fetchedAt: cache?.at || 0, fallbackChecked: FALLBACK_CHECKED, now: Date.now() };
  }
  const push = () => ctx.send("calendar:update", payload());

  async function refresh(force) {
    if (loading) return loading;
    if (!force && cache && Date.now() - cache.at < TTL) return;
    loading = fetchSchedules(cache).then((c) => { cache = c; ctx.writeJSON("calendar-cache.json", c); push(); })
      .catch((e) => console.error("calendar", e)).finally(() => { loading = null; });
    fillEarnings();
    return loading;
  }

  ctx.ipcMain.handle("calendar:get", () => { refresh(false); return payload(); });
  ctx.ipcMain.handle("calendar:refresh", async () => { await refresh(true); return payload(); });
  ctx.ipcMain.handle("calendar:headlines", (_e, words) => headlines(ctx.get().stories, Array.isArray(words) ? words.map(String).slice(0, 20) : [])
    .map((s) => ({ id: s.id, title: s.title, publisher: s.publisher, ts: s.ts, url: s.url })));
  ctx.bus?.on?.("scores", () => { valsAt = 0; push(); });
  setTimeout(() => refresh(false), 8000);
  setInterval(() => refresh(false), 3600e3);
}

module.exports = { register, parseFomc, parseBls, parseBea, parseCensus, claimsDates, countdown, etToMs, etDay, refStart, buildEvents, readings, headlines, fallbackSched, RELEASES, FALLBACK_CHECKED };
