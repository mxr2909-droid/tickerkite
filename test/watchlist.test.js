const test = require("node:test");
const assert = require("node:assert");
const { normalizeSymbol, shortName, defaultTerms, matcher, tagStories, sanitize } = require("../src/watchlist");

test("symbols are cleaned up the way Yahoo spells them", () => {
  assert.strictEqual(normalizeSymbol(" nvda "), "NVDA");
  assert.strictEqual(normalizeSymbol("$aapl"), "AAPL");
  assert.strictEqual(normalizeSymbol("brk-b"), "BRK-B");
  assert.strictEqual(normalizeSymbol("7203.t"), "7203.T");
  assert.strictEqual(normalizeSymbol("<script>"), "SCRIPT");
  assert.strictEqual(normalizeSymbol(""), "");
});

test("company names lose their legal suffixes", () => {
  assert.strictEqual(shortName("NVIDIA Corporation"), "NVIDIA");
  assert.strictEqual(shortName("Apple Inc."), "Apple");
  assert.strictEqual(shortName("The Coca-Cola Company"), "Coca-Cola");
  assert.strictEqual(shortName("Alphabet Inc. Class A"), "Alphabet");
  assert.strictEqual(shortName("Taiwan Semiconductor Manufacturing Company Limited"), "Taiwan Semiconductor Manufacturing");
  assert.deepStrictEqual(defaultTerms("NVDA", "NVIDIA Corporation"), ["NVIDIA"]);
  assert.deepStrictEqual(defaultTerms("SPY", "SPY"), []); // no name worth searching for
});

test("tickers match in caps only; names match in any case", () => {
  const m = matcher({ sym: "NVDA", terms: ["NVIDIA"] });
  assert.ok(m("Nvidia shares jump after earnings"));
  assert.ok(m("Chip stocks rally; NVDA up 4%"));
  assert.ok(m("$NVDA calls surge"));
  assert.ok(!m("nvda lowercase is not a ticker mention"));
  assert.ok(!m("Invidious comparisons")); // whole words only

  const all = matcher({ sym: "ALL", terms: ["Allstate"] });
  assert.ok(all("Allstate raises catastrophe reserves"));
  assert.ok(all("ALL shares slip"));
  assert.ok(!all("Stocks fall across all sectors"));
});

test("one- and two-letter tickers need a $ or parentheses", () => {
  const f = matcher({ sym: "F", terms: ["Ford"] });
  assert.ok(f("Ford recalls 100,000 trucks"));
  assert.ok(f("$F jumps premarket"));
  assert.ok(f("Ford Motor (F) beats estimates"));
  assert.ok(!f("F-35 program delayed"));
  assert.ok(!f("Fed holds rates"));
});

test("tickers with dots and dashes match literally", () => {
  const b = matcher({ sym: "BRK.B", terms: ["Berkshire"] });
  assert.ok(b("BRK.B hits record"));
  assert.ok(!b("BRKXB is not it"));
});

test("stories are tagged with every watchlist ticker they mention", () => {
  const list = [{ sym: "NVDA", terms: ["NVIDIA"] }, { sym: "AAPL", terms: ["Apple"] }, { sym: "XOM", terms: ["Exxon"] }];
  const stories = [
    { id: "a", title: "Apple and Nvidia lead tech rebound", summary: "", assets: [], sources: [] },
    { id: "b", title: "Oil majors slide", summary: "", assets: ["XOM"], sources: [] }, // tagged by the ranker
    { id: "c", title: "Fed minutes due", summary: "", assets: [], sources: [{ title: "Exxon warns on margins" }] }, // another outlet's headline
    { id: "d", title: "Gold steadies", summary: "", assets: [], sources: [] }
  ];
  const out = tagStories(stories, list);
  assert.deepStrictEqual(out.map((s) => s.watch), [["NVDA", "AAPL"], ["XOM"], ["XOM"], []]);
  assert.strictEqual(stories[0].watch, undefined, "input is not mutated");
  assert.deepStrictEqual(tagStories(stories, []).map((s) => s.watch), [undefined, undefined, undefined, undefined]);
});

test("a hand-edited watchlist file is cleaned up", () => {
  const out = sanitize([{ sym: "nvda", name: "NVIDIA Corporation" }, { sym: "NVDA" }, null, { sym: "" }, { sym: "aapl", name: "Apple Inc.", terms: ["Apple", "iPhone"] }]);
  assert.deepStrictEqual(out, [
    { sym: "NVDA", name: "NVIDIA Corporation", terms: ["NVIDIA"] },
    { sym: "AAPL", name: "Apple Inc.", terms: ["Apple", "iPhone"] }
  ]);
  assert.deepStrictEqual(sanitize("junk"), []);
});
