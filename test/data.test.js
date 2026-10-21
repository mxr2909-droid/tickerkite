const test = require("node:test");
const assert = require("node:assert");
const { UA } = require("../src/data/http");
const { parseQuote, finnhubSymbol } = require("../src/data/finnhub");
const { searchUrl } = require("../src/data/googlenews");
const { chartUrl } = require("../src/data/yahoo");
const pkg = require("../package.json");

test("requests say they come from Tickerkite, not a browser", () => {
  assert.match(UA, new RegExp(`^Tickerkite/${pkg.version.replace(/\./g, "\\.")} `));
  assert.doesNotMatch(UA, /Mozilla|Chrome|Safari/);
});

test("only plain US tickers go to Finnhub", () => {
  assert.strictEqual(finnhubSymbol("nvda"), "NVDA");
  assert.strictEqual(finnhubSymbol("BRK-B"), "BRK.B");
  for (const s of ["^GSPC", "CL=F", "EURUSD=X", "BTC-USD", "7203.T", "ASML.AS", ""]) assert.strictEqual(finnhubSymbol(s), null, s);
});

test("Finnhub quotes: zeros mean no price", () => {
  assert.deepStrictEqual(parseQuote({ c: 101.5, pc: 100, t: 1760000000 }), { last: 101.5, prev: 100, time: 1760000000000 });
  assert.strictEqual(parseQuote({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }), null);
  assert.strictEqual(parseQuote(null), null);
});

test("source URLs are built in one place", () => {
  assert.strictEqual(searchUrl("oil when:2d"), "https://news.google.com/rss/search?q=oil%20when%3A2d&hl=en-US&gl=US&ceid=US:en");
  assert.strictEqual(chartUrl("^GSPC", { range: "1d", interval: "15m" }), "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1d&interval=15m");
});
