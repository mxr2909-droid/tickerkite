const test = require("node:test");
const assert = require("node:assert");
const { reaction, group, itemLine, reactionLine, worthAlert, basketFor, barsFrom } = require("../src/releases");

const T = Date.UTC(2026, 9, 20, 12, 30); // 8:30 ET
const bar = (min, c, late = 0) => ({ t: T + min * 60e3 + late, c });

test("reaction: last close before the release vs last close inside the first 5 minutes", () => {
  const bars = [bar(-3, 100), bar(-1, 100), bar(0, 100.5), bar(2, 100.8), bar(4, 100.6), bar(5, 99)];
  const r = reaction(bars, T, 5, "pct");
  assert.strictEqual(r.from, 100);
  assert.strictEqual(r.to, 100.6);
  assert.strictEqual(r.v, 0.6);
});

test("reaction: yields in basis points, thin markets and late stamps", () => {
  // no trades in some minutes, bars stamped a second late
  const bars = [bar(-1, 5.086, 1000), bar(0, 5.08, 1000), bar(4, 5.094, 1000), bar(5, 5.091, 1000)];
  const r = reaction(bars, T, 5, "bp");
  assert.strictEqual(r.v, 0.8);
});

test("reaction: nothing until the window is covered", () => {
  assert.strictEqual(reaction([bar(-1, 100), bar(1, 101)], T, 5), null);
  assert.strictEqual(reaction([bar(1, 101), bar(5, 101)], T, 5), null); // nothing before the release
});

test("rows printed together become one alert; small ones are skipped", () => {
  const row = (o) => ({ code: "US", flag: "🇺🇸", g10: true, rel: 3, t: T, ...o });
  const g = group([
    row({ key: "US:cpi", name: "CPI", actual: "0.4%", survey: "0.3%", previous: "0.2%" }),
    row({ key: "US:core-cpi", name: "Core CPI", actual: "0.3%", survey: "0.3%" }),
    row({ key: "US:redbook", name: "Redbook", actual: "5%", rel: 1 }),
    row({ key: "JP:cpi", name: "National CPI", code: "JP", actual: "2%", survey: "2.1%", t: T + 1 }),
    row({ key: "BR:cpi", name: "IPCA", code: "BR", g10: false, actual: "4%" })
  ]);
  assert.deepStrictEqual(g.map((a) => a.id), [`US:${T}`, `JP:${T + 1}`]);
  assert.strictEqual(g[0].items.length, 2);
  assert.strictEqual(itemLine(g[0].items[0]), "CPI 0.4% vs 0.3% expected (above)");
  assert.strictEqual(itemLine(g[0].items[1]), "Core CPI 0.3%, in line with 0.3% expected");
  assert.strictEqual(itemLine(g[1].items[0]), "National CPI 2% vs 2.1% expected (below)");
  assert.ok(!worthAlert({ code: "DE", g10: true, rel: 3, name: "Ifo Business Climate", actual: "88" }));
});

test("reaction text and baskets", () => {
  assert.strictEqual(reactionLine([{ label: "S&P futures", v: -0.6, unit: "pct" }, { label: "10Y yield", v: 9.2, unit: "bp" }]), "S&P futures −0.60% · 10Y yield +9bp");
  assert.deepStrictEqual(basketFor("DE").map((b) => b[0]), ["EURUSD=X", "^STOXX50E", "ES=F"]);
  assert.deepStrictEqual(basketFor("XX").map((b) => b[0]), ["ES=F", "DX-Y.NYB"]);
  assert.deepStrictEqual(barsFrom({ chart: { result: [{ timestamp: [1, 2], indicators: { quote: [{ close: [5, null] }] } }] } }), [{ t: 1000, c: 5 }]);
});
