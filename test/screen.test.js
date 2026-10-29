const test = require("node:test");
const assert = require("node:assert");
const S = require("../src/screen");

test("rows: valuation, growth, margins, returns from fundamentals and prices", () => {
  const fund = [{ cik: 1, ticker: "AAA", name: "A Co", rev: 10e9, revPrev: 8e9, ni: 1e9, oi: 1.5e9, gp: 4e9, eq: 5e9, debt: 2.5e9, shares: 1e9 },
    { cik: 2, ticker: "BBB", name: "B Co", rev: 5e9, revPrev: 0, ni: -1e9, oi: null, gp: null, eq: -1e9, debt: 1e9, shares: null }];
  const r = S.rows(fund, { AAA: { price: 20, ret6: 5, ret12: 12, fromHigh: -3 }, BBB: { price: 10 } });
  const a = r.find((x) => x.ticker === "AAA");
  assert.strictEqual(a.mcap, 20); assert.strictEqual(a.pe, 20); assert.strictEqual(a.ps, 2);
  assert.strictEqual(a.growth, 25); assert.strictEqual(a.op, 15); assert.strictEqual(a.net, 10); assert.strictEqual(a.roe, 20); assert.strictEqual(a.de, 0.5);
  const b = r.find((x) => x.ticker === "BBB");
  assert.deepStrictEqual([b.mcap, b.pe, b.growth, b.roe, b.de], [null, null, null, null, null]); // losses, no shares, negative equity
  assert.strictEqual(S.rows(fund, {}).length, 0, "no price, no row");
  const odd = S.rows([{ ...fund[0], ticker: "ODD", ni: 1 }], { ODD: { price: 20 } })[0]; // net income in the wrong unit
  assert.strictEqual(odd.pe, null, "a P/E in the millions isn't meaningful");
});

test("filters: all must pass, missing values fail", () => {
  const row = { pe: 12, roe: 18, de: null };
  assert.ok(S.passes(row, [{ m: "pe", op: "<=", v: 15 }, { m: "roe", op: ">=", v: 15 }]));
  assert.ok(!S.passes(row, [{ m: "pe", op: "<=", v: 10 }]));
  assert.ok(!S.passes(row, [{ m: "de", op: "<=", v: 1 }]));
  assert.ok(S.passes(row, []));
});

test("price stats from a year of closes", () => {
  const c = Array.from({ length: 252 }, (_, i) => (i < 200 ? 100 + 0.5 * i : 200 - 0.5 * (i - 200))); // rises, then falls back
  const s = S.priceStats(c);
  assert.strictEqual(s.price, c[251]);
  assert.ok(Math.abs(s.ret12 - (c[251] / c[0] - 1) * 100) < 1e-9);
  assert.ok(s.fromHigh < 0);
  assert.strictEqual(S.priceStats([1, 2, 3]), null);
});
