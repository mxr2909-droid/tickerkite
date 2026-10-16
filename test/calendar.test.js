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
  const ev = C.buildEvents(sched, [{ sym: "AAPL", name: "Apple Inc.", date: "2026-10-29", estimated: true, source: "filing cadence" }], NOW);
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
  assert.strictEqual(earn.estimated, true);
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
