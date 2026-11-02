const test = require("node:test");
const assert = require("node:assert");
const C = require("../src/calendar");

const FOMC_HTML = `
<h4><a id="1">2026 FOMC Meetings</a></h4>
<div class="fomc-meeting__month col-xs-5"><strong>Oct/Nov</strong></div><div class="fomc-meeting__date col-xs-4">31-1</div>
<div class="fomc-meeting__month col-xs-5"><strong>December</strong></div><div class="fomc-meeting__date col-xs-4">8-9*</div>
<div class="fomc-meeting__month col-xs-5"><strong>August</strong></div><div class="fomc-meeting__date col-xs-4">22 (notation vote)</div>
<h4><a id="2">2027 FOMC Meetings</a></h4>
<div class="fomc-meeting__month col-xs-5"><strong>January</strong></div><div class="fomc-meeting__date col-xs-4">26-27</div>`;

const BEA_HTML = `
<tr><td class="scheduled-date"><div class="release-date">October 29</div>
<small class="text-muted">8:30 AM</small></td><td></td>
<td class="release-title views-field">GDP (Advance Estimate), 3rd Quarter 2026 </td></tr>
<tr><td class="scheduled-date"><div class="release-date">October 30</div>
<small class="text-muted">10:00 AM</small></td><td></td>
<td class="release-title views-field">Trade in Goods and Services, September 2026</td></tr>
<tr><td class="scheduled-date"><div class="release-date">January 7</div>
<small class="text-muted">8:30 AM</small></td><td></td>
<td class="release-title views-field">Personal Income and Outlays, November 2026</td></tr>`;

const BLS_HTML = `<table><tr><th>Reference Month</th><th>Release Date</th><th>Release Time</th></tr>
<tr><td>October 2026</td><td>Nov. 10, 2026</td><td>08:30 AM</td></tr>
<tr><td>May 2027</td><td>Jun. 10, 2027</td><td>08:30 AM</td></tr>
<tr><td>June 2027</td><td>July 14, 2027</td><td>10:00 AM</td></tr></table>`;

const CENSUS_HTML = `<h3>Advance Monthly Retail Trade Report</h3><table>
<tr><td>September 2026</td><td>October 15, 2026</td></tr><tr><td>October 2026</td><td>November 17, 2026</td></tr>
<tr><td>December 2026</td><td>To be announced</td></tr></table><p>Historical Release Dates</p>
<h3>Monthly Retail Trade Report</h3><tr><td>August 2026</td><td>October 15, 2026</td></tr>`;

const NOW = Date.parse("2026-10-15T16:00:00Z"); // 12:00 ET, Thursday

test("FOMC page: decision day, cross-month meetings, projections, skips notation votes", () => {
  assert.deepStrictEqual(C.parseFomc(FOMC_HTML), [
    { start: "2026-10-31", date: "2026-11-01", sep: false },
    { start: "2026-12-08", date: "2026-12-09", sep: true },
    { start: "2027-01-26", date: "2027-01-27", sep: false }
  ]);
});

test("BEA schedule: only GDP and PCE, year inferred from today", () => {
  assert.deepStrictEqual(C.parseBea(BEA_HTML, NOW), [
    { key: "gdp", ref: "3rd Quarter 2026 (advance)", date: "2026-10-29", time: "08:30" },
    { key: "pce", ref: "November 2026", date: "2027-01-07", time: "08:30" }
  ]);
});

test("BLS schedule page rows", () => {
  assert.deepStrictEqual(C.parseBls(BLS_HTML), [
    { ref: "October 2026", date: "2026-11-10", time: "08:30" },
    { ref: "May 2027", date: "2027-06-10", time: "08:30" },
    { ref: "June 2027", date: "2027-07-14", time: "10:00" }
  ]);
});

test("Census: advance report only, TBA rows skipped", () => {
  assert.deepStrictEqual(C.parseCensus(CENSUS_HTML), [
    { ref: "September 2026", date: "2026-10-15" },
    { ref: "October 2026", date: "2026-11-17" }
  ]);
});

test("Eastern time conversion across daylight saving", () => {
  assert.strictEqual(new Date(C.etToMs("2026-10-15", "08:30")).toISOString(), "2026-10-15T12:30:00.000Z"); // EDT
  assert.strictEqual(new Date(C.etToMs("2026-12-10", "08:30")).toISOString(), "2026-12-10T13:30:00.000Z"); // EST
});

test("countdowns", () => {
  const at = (d, t) => C.etToMs(d, t);
  assert.strictEqual(C.countdown(at("2026-10-15", "08:30"), true, NOW), "out 8:30 ET");
  assert.strictEqual(C.countdown(at("2026-10-15", "14:00"), true, NOW), "today 14:00 ET");
  assert.strictEqual(C.countdown(at("2026-10-15", "12:40"), true, NOW), "in 40 min");
  assert.strictEqual(C.countdown(at("2026-10-16", "08:30"), true, NOW), "tomorrow 8:30 ET");
  assert.strictEqual(C.countdown(at("2026-10-17", "00:00"), false, NOW), "in 2 days");
  assert.strictEqual(C.countdown(at("2026-10-15", "00:00"), false, NOW), "today");
  assert.strictEqual(C.countdown(at("2026-10-14", "08:30"), true, NOW), "yesterday");
  assert.strictEqual(C.countdown(at("2026-10-10", "08:30"), true, NOW), "5 days ago");
  // 23:30 ET is still "today" even though it's the next day in UTC
  assert.strictEqual(C.countdown(at("2026-10-15", "23:30"), true, NOW), "today 23:30 ET");
});

test("jobless claims: Thursdays, Wednesday in Thanksgiving and Christmas weeks", () => {
  assert.deepStrictEqual(C.claimsDates(Date.parse("2026-11-16T15:00:00Z"), 3), ["2026-11-19", "2026-11-25", "2026-12-03"]);
  assert.deepStrictEqual(C.claimsDates(Date.parse("2026-12-21T15:00:00Z"), 2), ["2026-12-24", "2026-12-30"]);
});

test("reference periods", () => {
  assert.strictEqual(C.refStart("September 2026"), Date.UTC(2026, 8, 1));
  assert.strictEqual(C.refStart("3rd Quarter 2026 (advance)"), Date.UTC(2026, 6, 1));
  assert.strictEqual(C.refStart("Week ending 2026-10-10"), null);
});

test("event list: window, order, fallback and estimated flags", () => {
  const sched = C.fallbackSched();
  const ev = C.buildEvents(sched, [{ id: "earn:AAPL:2026-10-29", cat: "earnings", key: "earn", sym: "AAPL", title: "Apple earnings", t: C.etToMs("2026-10-29", "16:05"), timed: false }], NOW);
  assert.ok(ev.every((e, i) => i === 0 || ev[i - 1].t <= e.t));
  assert.ok(ev.every((e) => e.t >= NOW - 8 * 864e5 && e.t <= NOW + 367 * 864e5));
  const cats = new Set(ev.map((e) => e.cat));
  assert.deepStrictEqual([...cats].sort(), ["earnings", "fed", "macro"]);
  const cpi = ev.find((e) => e.key === "cpi");
  assert.strictEqual(cpi.fallback, true);
  assert.strictEqual(cpi.ref, "October 2026");
  assert.strictEqual(new Date(cpi.t).toISOString(), "2026-11-10T13:30:00.000Z");
  const fed = ev.find((e) => e.cat === "fed");
  assert.strictEqual(new Date(fed.t).toISOString(), "2026-10-28T18:00:00.000Z"); // 2:00 PM ET statement
  assert.strictEqual(fed.ref, "Oct 27–28");
  const earn = ev.find((e) => e.cat === "earnings");
  assert.strictEqual(earn.title, "Apple earnings");
  assert.strictEqual(earn.timed, false);
  assert.ok(ev.some((e) => e.key === "claims" && e.t < NOW)); // last week's claims stay visible
});

test("readings: latest vs previous from raw series, with the scorecard transform", () => {
  const raw = { "fred:UNRATE": [[Date.UTC(2026, 7, 1), 4.3], [Date.UTC(2026, 8, 1), 4.4]] };
  const r = C.readings(raw, { claims: { t: 1, v: 230 } });
  assert.deepStrictEqual([r.unrate.v, r.unrate.pv, r.unrate.unit], [4.4, 4.3, "%"]);
  assert.strictEqual(r.claims.v, 230); // falls back to the scorecard value
  assert.strictEqual(r.claims.pv, undefined);
});

test("headline match is whole-word and case-insensitive", () => {
  const stories = [{ title: "CPI hotter than expected" }, { title: "Fedex beats" }, { title: "Powell signals patience" }];
  assert.deepStrictEqual(C.headlines(stories, ["cpi"]).map((s) => s.title), ["CPI hotter than expected"]);
  assert.deepStrictEqual(C.headlines(stories, C.RELEASES.fomc.words).map((s) => s.title), ["Powell signals patience"]);
});

// ---------- Nasdaq consensus ----------
const NQ = require("../src/calendar-nasdaq");
const NQ_DAY = require("./fixtures/nasdaq-cal-2026-10-14.json"); // trimmed reply to ?date=2026-10-15, which holds Oct 14's events
const EDT = -4 * 3600e3;

test("Nasdaq numbers and surprises", () => {
  assert.deepStrictEqual(NQ.parseNum("1,080.0B"), { v: 1080, unit: "B", dec: 1, s: "1,080.0B" });
  assert.deepStrictEqual(NQ.parseNum("-39.3K"), { v: -39.3, unit: "K", dec: 1, s: "-39.3K" });
  assert.strictEqual(NQ.parseNum("&nbsp;"), null);
  assert.strictEqual(NQ.parseNum(" "), null);
  assert.deepStrictEqual(NQ.surprise("3.7%", "3.6%"), { v: 0.1, unit: "%", dec: 1 });
  assert.deepStrictEqual(NQ.surprise("-39.3K", "19.6K"), { v: -58.9, unit: "K", dec: 1 });
  assert.strictEqual(NQ.surprise("3.7%", "3.6K"), null); // units differ
  assert.strictEqual(NQ.fmtNum(NQ.surprise("1,080.0B", "1,025.0B"), true), "+55.0B");
  assert.strictEqual(NQ.etOffset(Date.parse("2026-10-15T12:00:00Z")), EDT);
  assert.strictEqual(NQ.etOffset(Date.parse("2026-10-15T12:00:59.9Z")), EDT);
  assert.strictEqual(NQ.etOffset(Date.parse("2026-12-15T12:00:00Z")), -5 * 3600e3);
});

test("Nasdaq day: ET times, countries, regions, repeated names, importance", () => {
  const rows = NQ.parseDay(NQ_DAY, "2026-10-14", EDT);
  assert.strictEqual(rows.length, 14);
  const cpi = rows.filter((r) => r.code === "US" && /^CPI/.test(r.name));
  assert.deepStrictEqual(cpi.map((r) => [r.key, r.name, r.actual, r.survey, r.previous]), [["US:cpi", "CPI", "3.7%", "3.6%", "3.4%"], ["US:cpi#2", "CPI (2)", "0.6%", "0.6%", "0.4%"]]);
  assert.strictEqual(new Date(cpi[0].t).toISOString(), "2026-10-14T12:30:00.000Z"); // 8:30 ET
  assert.strictEqual(cpi[0].rel, 3);
  const de = rows.find((r) => r.code === "DE");
  assert.deepStrictEqual([de.region, de.g10, de.flag], ["eu", true, "🇩🇪"]);
  const cn = rows.find((r) => r.code === "CN");
  assert.deepStrictEqual([cn.region, cn.g10, cn.rel], ["as", false, 2]);
  const bailey = rows.find((r) => r.code === "GB");
  assert.deepStrictEqual([bailey.actual, bailey.survey, bailey.rel], ["", "", 3]);
  assert.strictEqual(rows.find((r) => r.name === "Beige Book").rel, 1);
  assert.strictEqual(NQ.parseDay({ data: null }, "2026-10-15", EDT), null);
  assert.deepStrictEqual(NQ.parseDay({ data: null, status: { rCode: 200, bCodeMessage: [{ code: 1002, errorMessage: "Economic Events Calendar: No record found." }] } }, "2026-10-11", EDT), []);
});

test("merge: official CPI takes Nasdaq's consensus, the rest become their own rows", () => {
  const rows = NQ.parseDay(NQ_DAY, "2026-10-14", EDT);
  const official = [{ id: "cpi:2026-10-14", cat: "macro", key: "cpi", title: "CPI", ref: "September 2026", t: C.etToMs("2026-10-14", "08:30"), timed: true, src: "BLS" }];
  const ev = C.weekEvents(official, { "2026-10-14": { rows } }, {}, C.weekOf(NOW));
  const cpi = ev.find((e) => e.id === "cpi:2026-10-14");
  assert.deepStrictEqual([cpi.survey, cpi.actual, cpi.prior, cpi.hkey, cpi.code, cpi.rel, cpi.ref], ["3.6%", "3.7%", "3.4%", "US:cpi", "US", 3, "September 2026"]);
  assert.strictEqual(ev.length, 14); // 14 rows, one folded into the official CPI event
  assert.ok(!ev.some((e) => e.id === "nq:US:cpi:2026-10-14"));
  assert.ok(ev.some((e) => e.id === "nq:US:cpi#2:2026-10-14"));
  assert.strictEqual(ev.find((e) => e.title === "Beige Book").cat, "fed");
  assert.strictEqual(ev.find((e) => e.code === "AU" && e.title === "Employment Change").cat, "macro");
  assert.ok(ev.every((e, i) => i === 0 || ev[i - 1].t <= e.t));
  // Nasdaq down: official events still there, just without numbers
  const bare = C.weekEvents(official, {}, {}, C.weekOf(NOW));
  assert.deepStrictEqual([bare.length, bare[0].survey, bare[0].hkey], [1, undefined, "US:cpi"]);
  // other weeks are left out
  assert.strictEqual(C.weekEvents(official, {}, {}, C.weekOf(NOW) + 7).length, 0);
});

test("week starts Monday ET", () => {
  assert.strictEqual(new Date(C.weekOf(NOW) * 864e5).toISOString().slice(0, 10), "2026-10-12");
  assert.strictEqual(new Date(C.weekOf(Date.parse("2026-10-19T03:00:00Z")) * 864e5).toISOString().slice(0, 10), "2026-10-12"); // Sun 11pm ET
});

test("history: builds up, notices revisions, summarises surprises", () => {
  const hist = {};
  const day = (date, actual, survey, previous) => ({ key: "US:cpi", date, t: Date.parse(date), name: "CPI", code: "US", flag: "", actual, survey, previous });
  NQ.record(hist, [day("2026-08-12", "3.2%", "3.3%", "3.0%")]);
  NQ.record(hist, [day("2026-09-11", "3.4%", "3.3%", "3.1%")]); // August printed 3.2, now shown as 3.1
  NQ.record(hist, [day("2026-10-15", "", "3.6%", "3.4%")]);     // before the print: survey only
  NQ.record(hist, [day("2026-10-15", "3.7%", "3.6%", "3.4%")]); // after: same entry updated
  const list = hist["US:cpi"].list;
  assert.deepStrictEqual(list.map((e) => [e.date, e.actual, e.survey]), [["2026-08-12", "3.2%", "3.3%"], ["2026-09-11", "3.4%", "3.3%"], ["2026-10-15", "3.7%", "3.6%"]]);
  assert.strictEqual(list[0].revised, "3.1%");
  assert.strictEqual(list[1].revised, undefined);
  assert.deepStrictEqual(NQ.priorOf(hist, day("2026-09-11", "3.4%", "3.3%", "3.1%")), { prior: "3.2%", revised: "3.1%" });
  assert.deepStrictEqual(NQ.priorOf({}, day("2026-09-11", "3.4%", "3.3%", "3.1%")), { prior: "3.1%", revised: "" });
  assert.deepStrictEqual(NQ.stats(list), { n: 3, above: 2, below: 1, on: 0, miss: { v: 0.1, unit: "%", dec: 1 }, sd: { v: 0.1, unit: "%", dec: 1 } });
  assert.strictEqual(NQ.stats([{ actual: "1%", survey: "" }]), null);
  // capped
  for (let i = 0; i < 50; i++) NQ.record(hist, [day(`2020-01-${String(i % 28 + 1).padStart(2, "0")}`.replace("2020", String(1970 + i)), "1%", "1%", "1%")]);
  assert.strictEqual(hist["US:cpi"].list.length, NQ.MAX_HIST);
});

test("repeated names follow their own series whatever order Nasdaq sends them in", () => {
  const hist = {};
  const row = (date, actual, previous) => ({ key: "US:building-permits", base: "Building Permits", name: "Building Permits", date, t: Date.parse(date), code: "US", actual, survey: "", previous });
  const day = (date, rows) => { const out = rows.map((r, i) => ({ ...r, key: i ? `${r.key}#${i + 1}` : r.key })); return NQ.record(hist, NQ.assignKeys(out, hist)) && out; };
  day("2026-08-18", [row("2026-08-18", "1.443M", "1.374M"), row("2026-08-18", "4.3%", "-2.6%")]);
  const sep = day("2026-09-17", [row("2026-09-17", "-2.1%", "4.3%"), row("2026-09-17", "1.394M", "1.443M")]); // swapped order
  assert.deepStrictEqual(sep.map((r) => [r.key, r.name]), [["US:building-permits#2", "Building Permits (2)"], ["US:building-permits", "Building Permits"]]);
  assert.deepStrictEqual(hist["US:building-permits"].list.map((e) => e.actual), ["1.443M", "1.394M"]);
  assert.deepStrictEqual(hist["US:building-permits#2"].list.map((e) => e.actual), ["4.3%", "-2.1%"]);
  // going back in time (the background fill) chains through the next release's prior
  const jul = day("2026-07-17", [row("2026-07-17", "-2.6%", "1.0%"), row("2026-07-17", "1.374M", "1.360M")]);
  assert.deepStrictEqual(jul.map((r) => r.key), ["US:building-permits#2", "US:building-permits"]);
});

test("history lookup: last 24, next release from the schedule", () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ date: `2024-${String(i % 12 + 1).padStart(2, "0")}-01`, actual: "1%", survey: "1%" }));
  const ev = [{ hkey: "US:cpi", t: NOW + 864e5, timed: true }];
  const h = C.historyFor({ "US:cpi": { name: "CPI", list } }, "US:cpi", ev, {}, NOW);
  assert.strictEqual(h.list.length, 24);
  assert.strictEqual(h.next.t, NOW + 864e5);
  const h2 = C.historyFor({}, "AU:employment-change", [], { "2026-10-16": { rows: [{ key: "AU:employment-change", t: NOW + 3600e3, timed: true }] } }, NOW);
  assert.deepStrictEqual([h2.list.length, h2.stats, h2.next.t], [0, null, NOW + 3600e3]);
});

test("cached Nasdaq days: past settles, today refreshes every 10 min", () => {
  const today = "2026-10-15", now = NOW;
  assert.strictEqual(NQ.fresh({ at: Date.parse("2026-10-14T12:00:00Z") }, "2026-10-01", today, now), true);
  assert.strictEqual(NQ.fresh({ at: now - 11 * 60e3 }, today, today, now), false);
  assert.strictEqual(NQ.fresh({ at: now - 5 * 60e3 }, today, today, now), true);
  assert.strictEqual(NQ.fresh({ at: now - 5 * 3600e3 }, "2026-10-20", today, now), true);
  assert.strictEqual(NQ.fresh(null, "2026-10-20", today, now), false);
});

const EQ = require("../src/calendar-earnings");
const NQC = require("../src/calendar-nasdaq");

test("top-100 ranking CSV", () => {
  const csv = `"Rank","Name","Symbol","marketcap","price (USD)","country"
"1","NVIDIA","NVDA","5262596898816","217.94","United States"
"2","Alphabet (Google)","GOOG","3874810232832","316.83","United States"
"3","Toyota","TM","300000000000","200","Japan"
"4","Roche","RO.SW","250000000000","300","Switzerland"`;
  const top = EQ.parseTop(csv, 3);
  assert.deepStrictEqual(top.map((c) => [c.rank, c.sym, c.country]), [[1, "NVDA", "United States"], [2, "GOOG", "United States"], [3, "TM", "Japan"]]);
  assert.strictEqual(top[0].cap, 5262596898816);
  assert.strictEqual(EQ.fallbackTop().length, 100);
});

test("earnings day: top companies only, one per company, timing and EPS", () => {
  const json = { data: { rows: [
    { time: "time-after-hours", symbol: "GOOG", name: "Alphabet Inc.", marketCap: "$3,874,463,940,000", fiscalQuarterEnding: "Sep/2026", epsForecast: "$2.94", noOfEsts: "14", lastYearEPS: "$2.87" },
    { time: "time-after-hours", symbol: "GOOGL", name: "Alphabet Inc.", marketCap: "$3,874,463,940,000", fiscalQuarterEnding: "Sep/2026", epsForecast: "$2.94", noOfEsts: "14" },
    { time: "time-pre-market", symbol: "TM", name: "Toyota Motor Corp", marketCap: "$300,000,000,000", fiscalQuarterEnding: "Sep/2026", epsForecast: "$4.10", eps: "$4.30", surprise: "4.9" },
    { time: "time-pre-market", symbol: "RHHBY", name: "Roche Holding", marketCap: "$250,000,000,000", fiscalQuarterEnding: "Sep/2026", epsForecast: "" },
    { time: "time-not-supplied", symbol: "KLAC", name: "KLA Corporation", marketCap: "$194,720,023,000", epsForecast: "$1.18" },
    { time: "time-pre-market", symbol: "TINY", name: "Tiny Co", marketCap: "$1,000,000", epsForecast: "$0.01" }
  ] } };
  const rows = EQ.parseDay(json);
  assert.ok(!rows.some((r) => r.sym === "TINY")); // under $20B isn't cached
  const top = [{ rank: 2, name: "Alphabet (Google)", sym: "GOOG", cap: 3.8e12, country: "United States" }, { rank: 40, name: "Toyota", sym: "TM", cap: 3e11, country: "Japan" }, { rank: 50, name: "Roche", sym: "RO.SW", cap: 2.5e11, country: "Switzerland" }];
  const ev = EQ.events("2026-10-28", rows, top, C.etToMs, NQC.country);
  assert.deepStrictEqual(ev.map((e) => e.title), ["Alphabet (Google) earnings", "Toyota earnings", "Roche earnings"]);
  const [goog, tm, ro] = ev;
  assert.strictEqual(goog.when, "after close");
  assert.strictEqual(goog.prior, "$2.87");
  assert.strictEqual(tm.actual, "$4.30");
  assert.deepStrictEqual([tm.code, tm.region, tm.g10], ["JP", "as", true]);
  assert.ok(tm.t < goog.t); // before the open sorts ahead of after the close
  assert.strictEqual(ro.sym, "RHHBY"); // ADR alias
  assert.strictEqual(ro.code, "CH");
});

test("earnings lists: Fortune-style and own companies join the global 100, one event each", () => {
  const json = { data: { rows: [
    { time: "time-pre-market", symbol: "WMT", name: "Walmart Inc.", marketCap: "$800,000,000,000", epsForecast: "$0.60" },
    { time: "time-after-hours", symbol: "CVS", name: "CVS Health Corporation", marketCap: "$90,000,000,000", epsForecast: "$1.50" },
    { time: "time-after-hours", symbol: "CELH", name: "Celsius Holdings, Inc.", marketCap: "$900,000,000", epsForecast: "$0.20" },
    { time: "time-after-hours", symbol: "SMOL", name: "Small Co", marketCap: "$500,000,000", epsForecast: "$0.01" }
  ] } };
  const lists = { top: [{ rank: 16, name: "Walmart", sym: "WMT", cap: 8e11, country: "United States" }], fortune: [{ ticker: "WMT", rank: 1 }, { ticker: "CVS", rank: 5 }], mine: [{ sym: "CELH", name: "Celsius" }] };
  const rows = EQ.parseDay(json, EQ.keepSet(lists));
  assert.deepStrictEqual(rows.map((r) => r.sym), ["WMT", "CVS", "CELH"]); // CELH kept though under $1B, SMOL not
  const ev = EQ.events("2026-11-04", rows, lists, C.etToMs, NQC.country);
  assert.deepStrictEqual(ev.map((e) => [e.title, e.rank, e.frank, e.mine]), [
    ["Walmart earnings", 16, 1, false], ["CVS Health earnings", null, 5, false], ["Celsius Holdings earnings", null, null, true]]);
});
