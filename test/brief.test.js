const test = require("node:test");
const assert = require("node:assert");
const { topStories, outlooks, todayEvents } = require("../src/brief");

test("top stories since you last looked, at least 12 hours' worth, biggest first", () => {
  const now = Date.UTC(2026, 9, 20, 12);
  const s = (id, h, score, kind = "news") => ({ id, title: id, kind, score, updated: now - h * 3600e3, sources: [{}] });
  const list = [s("old", 30, 99), s("a", 1, 50), s("b", 10, 80), s("ctx", 1, 99, "ctx"), s("c", 2, 60)];
  assert.deepStrictEqual(topStories(list, now - 3 * 3600e3, now).map((x) => x.id), ["b", "c", "a"]);
  assert.deepStrictEqual(topStories(list, now - 3 * 3600e3, now, 1).map((x) => x.id), ["b"]);
});

test("outlooks carry the week's change", () => {
  const o = outlooks({ assets: { stocks: { score: 25, label: "Bearish", changes: { w1: { score: -11, rows: [{ id: "vix", pts: -6.7 }] } } } }, regime: { name: "Reflation", text: "…" } });
  assert.deepStrictEqual(o.rows[0], { key: "stocks", name: "Stocks", score: 25, label: "Bearish", w1: -11, why: [{ id: "vix", pts: -6.7 }] });
  assert.strictEqual(o.regime.name, "Reflation");
  assert.strictEqual(outlooks(null), null);
});

test("today's events: big releases, Fed and earnings, with reactions attached", () => {
  const ev = [
    { id: "1", t: 10, cat: "macro", rel: 3, code: "US", title: "CPI", actual: "0.4%" },
    { id: "2", t: 11, cat: "macro", rel: 2, code: "US", title: "Redbook" },
    { id: "3", t: 12, cat: "macro", rel: 3, code: "BR", g10: false, title: "IPCA" },
    { id: "4", t: 13, cat: "earnings", code: "US", title: "NVDA earnings", sym: "NVDA", rank: 1 }
  ];
  const out = todayEvents(ev, [{ code: "US", t: 10, reaction: [{ label: "S&P futures", v: 1, unit: "pct" }] }]);
  assert.deepStrictEqual(out.map((e) => e.id), ["1", "4"]);
  assert.strictEqual(out[0].reaction[0].label, "S&P futures");
});
