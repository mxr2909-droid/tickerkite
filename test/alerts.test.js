const test = require("node:test");
const assert = require("node:assert");
const { evaluate, check, matches, normalize, describe } = require("../src/alerts");

const NOW = Date.UTC(2026, 9, 15, 14);
const rule = (r) => normalize({ id: "r1", cooldown: 60, ...r });
const quotes = (last, pct) => [{ sym: "^GSPC", label: "SPX", last, pct }, { sym: "NVDA", label: "NVDA", last: 120, pct: 0.4, watch: true }];
const scores = (stocks, hy) => ({ assets: { stocks: { score: stocks } }, ind: { hy: { v: hy } } });
const story = (id, title, sev = "m", ago = 60e3) => ({ id, title, sev, kind: "news", updated: NOW - ago });

test("normalize validates input", () => {
  assert.throws(() => normalize({ type: "price", op: "move", value: 2 }), /symbol/);
  assert.throws(() => normalize({ type: "score", asset: "stocks", op: "below", value: "x" }), /number/);
  assert.throws(() => normalize({ type: "ind", ind: "nope", op: "above", value: 1 }), /indicator/);
  assert.throws(() => normalize({ type: "news", keyword: "  " }), /keyword/);
  assert.strictEqual(normalize({ type: "price", sym: "SPX", op: "move", value: -2 }).value, 2);
  assert.strictEqual(describe(rule({ type: "score", asset: "stocks", op: "below", value: 30 })), "Stocks score < 30");
});

test("check reads price, score and indicator rules", () => {
  const d = { quotes: quotes(5000, -2.5), scores: scores(28, 4.2) };
  assert.strictEqual(check(rule({ type: "price", sym: "SPX", op: "move", value: 2 }), d).on, true);
  assert.strictEqual(check(rule({ type: "price", sym: "^GSPC", op: "above", value: 5100 }), d).on, false);
  assert.strictEqual(check(rule({ type: "score", asset: "stocks", op: "below", value: 30 }), d).on, true);
  assert.strictEqual(check(rule({ type: "ind", ind: "hy", op: "above", value: 4 }), d).on, true);
  assert.strictEqual(check(rule({ type: "price", sym: "TSLA", op: "above", value: 1 }), d), null);
  assert.strictEqual(check(rule({ type: "score", asset: "stocks", op: "below", value: 30 }), {}), null);
});

test("level rules fire on the crossing only", () => {
  const rs = [rule({ type: "score", asset: "stocks", op: "below", value: 30 })];
  let { state, fired } = evaluate(rs, {}, { scores: scores(40, 3) }, NOW);
  assert.strictEqual(fired.length, 0);
  ({ state, fired } = evaluate(rs, state, { scores: scores(25, 3) }, NOW + 1));
  assert.strictEqual(fired.length, 1);
  assert.match(fired[0].text, /Stocks score 25/);
  // still below: no repeat, including after a "restart" (state round-tripped through JSON)
  ({ state, fired } = evaluate(rs, JSON.parse(JSON.stringify(state)), { scores: scores(22, 3) }, NOW + 2));
  assert.strictEqual(fired.length, 0);
  // back above, then below again inside the cooldown: suppressed
  ({ state } = evaluate(rs, state, { scores: scores(35, 3) }, NOW + 3));
  ({ state, fired } = evaluate(rs, state, { scores: scores(25, 3) }, NOW + 10 * 60e3));
  assert.strictEqual(fired.length, 0);
  // reset and cross again after the cooldown: fires
  ({ state } = evaluate(rs, state, { scores: scores(35, 3) }, NOW + 70 * 60e3));
  ({ state, fired } = evaluate(rs, state, { scores: scores(25, 3) }, NOW + 71 * 60e3));
  assert.strictEqual(fired.length, 1);
});

test("missing data and disabled rules keep state and don't fire", () => {
  const r = rule({ type: "price", sym: "SPX", op: "move", value: 2 });
  let { state, fired } = evaluate([r], {}, { quotes: quotes(5000, 3) }, NOW);
  assert.strictEqual(fired.length, 1);
  ({ state, fired } = evaluate([r], state, { quotes: [] }, NOW + 1));
  assert.strictEqual(state.r1.on, true);
  ({ state, fired } = evaluate([{ ...r, enabled: false }], {}, { quotes: quotes(5000, 3) }, NOW));
  assert.strictEqual(fired.length, 0);
});

test("headline rules: whole-word match, HIGH filter, only new stories", () => {
  const r = rule({ type: "news", keyword: "NVDA", high: true });
  const s1 = story("a", "NVDA surges after earnings", "h");
  assert.deepStrictEqual(matches(r, [s1, story("b", "NVDAX fund launches", "h"), story("c", "NVDA dips", "m")]).map((s) => s.id), ["a"]);
  assert.strictEqual(matches(rule({ type: "news", keyword: "fed" }), [story("d", "Fed holds rates")]).length, 1);
  // first pass only remembers what's already out
  let { state, fired } = evaluate([r], {}, { stories: [s1] }, NOW);
  assert.strictEqual(fired.length, 0);
  const s2 = story("e", "Export curbs hit $NVDA", "h");
  ({ state, fired } = evaluate([r], state, { stories: [s2, s1] }, NOW + 1));
  assert.deepStrictEqual(fired.map((f) => f.story), ["e"]);
  ({ state, fired } = evaluate([r], state, { stories: [s2, s1] }, NOW + 2));
  assert.strictEqual(fired.length, 0);
  // stale stories never fire
  ({ fired } = evaluate([{ ...r, cooldown: 0 }], state, { stories: [story("f", "NVDA old news", "h", 5 * 3600e3)] }, NOW + 3));
  assert.strictEqual(fired.length, 0);
});
