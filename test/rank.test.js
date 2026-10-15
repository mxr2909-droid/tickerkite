const test = require("node:test");
const assert = require("node:assert");
const { parseFeed, clean } = require("../src/news/parse");
const { rank, publisherInfo } = require("../src/news/rank");
const S = require("./fixtures/samples");

const gnFeed = { id: "gn", name: "Google News", weight: 0, kind: "news" };
const cnbcFeed = { id: "cnbc", name: "CNBC Top News", weight: 7, kind: "news" };
const fedFeed = { id: "fed", name: "Federal Reserve", weight: 10, kind: "news" };

const all = () => [
  ...parseFeed(S.googleNews, gnFeed),
  ...parseFeed(S.cnbc, cnbcFeed),
  ...parseFeed(S.atom, fedFeed)
];

test("parses RSS, CDATA, entities and Google News publishers", () => {
  const gn = parseFeed(S.googleNews, gnFeed);
  assert.equal(gn.length, 6);
  assert.equal(gn[0].publisher, "Reuters");
  assert.equal(gn[0].title, "Inflation heats up in September as gasoline jumps, CPI rises 3.7%");
  assert.equal(gn[0].summary, "", "Google News echo descriptions are dropped");
  const c = parseFeed(S.cnbc, cnbcFeed);
  assert.equal(c[0].title, "Inflation heats up: September CPI rises 3.7% as gasoline jumps");
  assert.match(c[0].summary, /0\.6% in September & gasoline/);
  assert.equal(c[0].publisher, "CNBC Top News");
});

test("parses Atom entries with link href", () => {
  const a = parseFeed(S.atom, fedFeed);
  assert.equal(a.length, 1);
  assert.equal(a[0].link, "https://www.federalreserve.gov/newsevents/pressreleases/a.htm");
});

test("clean strips tags and decodes entities", () => {
  assert.equal(clean("<p>S&amp;P 500 &#8212; up</p>"), "S&P 500 — up");
});

test("clusters the same story across outlets", () => {
  const stories = rank(all(), { now: S.now });
  const cpi = stories.filter((s) => /cpi/i.test(s.title));
  assert.equal(cpi.length, 1, "three CPI headlines become one story");
  assert.equal(cpi[0].sources.length, 3);
  assert.ok(["RTRS", "BBG"].includes(cpi[0].code), "lead comes from the most authoritative outlet");
});

test("ranks macro shocks above trivia and drops stale items", () => {
  const stories = rank(all(), { now: S.now });
  const top = stories[0];
  assert.match(top.title, /CPI/);
  assert.equal(top.sev, "h");
  assert.ok(top.desks.includes("US") && top.desks.includes("FED"));
  assert.equal(top.signal, "INFLATION DATA");
  const bakery = stories.find((s) => /bakery/i.test(s.title));
  assert.equal(bakery.sev, "l");
  assert.ok(bakery.score < 40, `bakery scored ${bakery.score}`);
  assert.ok(!stories.some((s) => /last week/i.test(s.title)), "stale story removed");
});

test("tags energy/geopolitics, earnings tickers, regions and context", () => {
  const stories = rank(all(), { now: S.now });
  const oil = stories.find((s) => /aramco/i.test(s.title));
  assert.ok(oil.desks.includes("NRG"));
  assert.equal(oil.region, "MIDDLE EAST");
  assert.notEqual(oil.sev, "l");
  const tsmc = stories.find((s) => /tsmc/i.test(s.title));
  assert.ok(tsmc.assets.includes("TSM"));
  assert.ok(tsmc.desks.includes("ERN"));
  assert.equal(tsmc.region, "TAIWAN");
  const op = stories.find((s) => /opinion/i.test(s.title));
  assert.equal(op.kind, "ctx");
});

test("merges paraphrased headlines but keeps distinct stories apart", () => {
  const { similar, tokens } = require("../src/news/rank");
  const t = (s) => tokens(s);
  assert.ok(similar(t("Brent crude slips toward $104 as US weighs easing tanker sanctions"), t("Oil prices fall as Washington weighs easing tanker sanctions")) >= 0.5);
  assert.ok(similar(t("TSMC posts record profit, beats estimates on AI chip demand"), t("TSMC record profit beats estimates as AI chip demand holds")) >= 0.5);
  assert.ok(similar(t("Stocks fall as chip rout deepens"), t("Oil prices fall as Washington weighs sanctions")) < 0.5);
  assert.ok(similar(t("Goldman Sachs earnings crush estimates on record equities trading"), t("JPMorgan misses as bond trading slows, cuts buybacks")) < 0.5);
});

test("publisher codes", () => {
  assert.equal(publisherInfo("Reuters").code, "RTRS");
  assert.equal(publisherInfo("The Springfield Gazette").code, "SG");
});

for (const s of rank(all(), { now: S.now })) console.log(String(s.score).padStart(3), s.sev, s.code.padEnd(5), s.desks.join("/").padEnd(10), s.title);
