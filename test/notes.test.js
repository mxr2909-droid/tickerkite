const test = require("node:test");
const assert = require("node:assert");
const N = require("../src/notes");

test("notes: save, read back per ticker, blank text removes the note", () => {
  const s = {};
  assert.deepStrictEqual(N.get(s, "nvda"), { text: "", at: 0 });
  assert.deepStrictEqual(N.set(s, " nvda ", "Watch data-center growth", 100), { text: "Watch data-center growth", at: 100 });
  assert.strictEqual(N.get(s, "NVDA").text, "Watch data-center growth");
  assert.strictEqual(N.get(s, "AAPL").text, "");
  N.set(s, "NVDA", "   ");
  assert.deepStrictEqual(s, {});
});

test("notes: rejects odd symbols, clamps length, keeps only the newest 500", () => {
  const s = {};
  assert.deepStrictEqual(N.set(s, "<script>", "x"), { text: "", at: 0 });
  assert.deepStrictEqual(s, {});
  assert.strictEqual(N.set(s, "BRK-B", "y".repeat(N.MAX_LEN + 50)).text.length, N.MAX_LEN);
  for (let i = 0; i < N.MAX_NOTES + 5; i++) N.set(s, "T" + i, "n", 1000 + i);
  assert.strictEqual(Object.keys(s).length, N.MAX_NOTES);
  assert.ok(!s.T0 && s["T" + (N.MAX_NOTES + 4)]);
});
