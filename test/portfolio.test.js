const test = require("node:test");
const assert = require("node:assert");
const { sanitize, summarize, guessClass, newsFor, unitCurrency } = require("../src/portfolio");

test("holdings are cleaned up: bad shares, duplicates and junk dropped", () => {
  const h = sanitize([
    { sym: " aapl ", name: "Apple Inc.", shares: "10", cost: "150" },
    { sym: "AAPL", shares: 5 },
    { sym: "TLT", shares: 0 },
    { sym: "VOO", shares: 2, cost: "", cls: "nonsense" },
    null, { shares: 3 }
  ]);
  assert.deepStrictEqual(h, [
    { sym: "AAPL", name: "Apple Inc.", shares: 10, cost: 150, cls: "stocks" },
    { sym: "VOO", name: "VOO", shares: 2, cost: null, cls: "stocks" }
  ]);
});

test("asset class guesses from the symbol and Yahoo's type", () => {
  assert.strictEqual(guessClass("TLT"), "bonds");
  assert.strictEqual(guessClass("GLD"), "alts");
  assert.strictEqual(guessClass("SGOV"), "cash");
  assert.strictEqual(guessClass("ETH-USD"), "crypto");
  assert.strictEqual(guessClass("IBIT"), "crypto");
  assert.strictEqual(guessClass("CL=F"), "commodities");
  assert.strictEqual(guessClass("XYZ", "CRYPTOCURRENCY"), "crypto");
  assert.strictEqual(guessClass("NVDA", "EQUITY"), "stocks");
});

test("positions, totals, mix and outlook add up", () => {
  const holdings = [
    { sym: "AAPL", name: "Apple", shares: 10, cost: 100, cls: "stocks" },
    { sym: "TLT", name: "Treasuries", shares: 10, cost: null, cls: "bonds" },
    { sym: "SGOV", name: "T-bills", shares: 10, cost: 100, cls: "cash" }
  ];
  const q = { AAPL: { last: 150, prev: 140, currency: "USD" }, TLT: { last: 90, prev: 91 }, SGOV: { last: 100, prev: 100 } };
  const s = summarize(holdings, q, {}, { stocks: { score: 30 }, bonds: { score: 70 } });
  assert.strictEqual(s.total.value, 1500 + 900 + 1000);
  assert.strictEqual(s.total.dayPnl, 100 - 10);
  assert.strictEqual(s.total.basis, 2000); // TLT has no cost, so it's left out of the gain
  assert.strictEqual(s.total.gain, 500);
  assert.ok(s.total.partialCost);
  const aapl = s.rows.find((r) => r.sym === "AAPL");
  assert.strictEqual(aapl.gain, 500);
  assert.strictEqual(+aapl.gainPct.toFixed(1), 50);
  assert.strictEqual(+aapl.weight.toFixed(2), 44.12);
  // outlook: stocks 1500 at 30, bonds 900 at 70; cash isn't scored
  assert.strictEqual(s.outlook, Math.round((30 * 1500 + 70 * 900) / 2400));
  assert.deepStrictEqual(s.mix.map((m) => m.cls), ["stocks", "bonds", "cash"]);
  assert.strictEqual(+s.cash.toFixed(1), 29.4);
});

test("foreign quotes convert to dollars, pence included", () => {
  assert.deepStrictEqual(unitCurrency("GBp"), ["GBP", 0.01]);
  const s = summarize([{ sym: "VOD.L", name: "Vodafone", shares: 1000, cost: 70, cls: "stocks" }],
    { "VOD.L": { last: 80, prev: 75, currency: "GBp" } }, { GBP: 1.25 });
  assert.strictEqual(s.total.value, 1000 * 80 * 0.01 * 1.25);
  assert.strictEqual(s.rows[0].gain, 1000 * 10 * 0.01 * 1.25);
  const none = summarize([{ sym: "7203.T", name: "Toyota", shares: 1, cost: null, cls: "stocks" }], { "7203.T": { last: 3000, prev: 2900, currency: "JPY" } }, {});
  assert.strictEqual(none.total.value, 0); // no JPY rate yet: not priced rather than priced wrong
  assert.deepStrictEqual(none.missing, ["7203.T"]);
});

test("news for holdings matches tickers and company names", () => {
  const now = Date.now();
  const stories = [
    { id: "a", title: "Apple unveils new chip", updated: now - 3600e3, assets: [], sources: [] },
    { id: "b", title: "Oil climbs", updated: now - 3600e3, assets: [], sources: [] },
    { id: "c", title: "Apple shares slide", updated: now - 100 * 3600e3, assets: [], sources: [] }
  ];
  const n = newsFor(stories, [{ sym: "AAPL", name: "Apple Inc." }]);
  assert.deepStrictEqual(n.map((s) => s.id), ["a"]);
  assert.deepStrictEqual(n[0].syms, ["AAPL"]);
});
