const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const C = require("../src/curve");

const csv = fs.readFileSync(path.join(__dirname, "fixtures/fed-treasury.csv"), "utf8");

test("tenor labels from both Treasury files", () => {
  assert.strictEqual(C.tenorKey('"1 Mo"'), "1M");
  assert.strictEqual(C.tenorKey("10 Yr"), "10Y");
  assert.strictEqual(C.tenorKey('"30 YR"'), "30Y");
  assert.strictEqual(C.tenorKey('"1.5 Month"'), null);
});

test("nominal and real curves parse; spreads and breakevens", () => {
  const nom = C.parseCurveCsv(csv);
  assert.strictEqual(nom[0].date, "2026-10-19");
  assert.strictEqual(nom[0].y["10Y"], 5.15);
  assert.ok(!("1.5M" in nom[0].y));
  assert.deepStrictEqual(C.spreads(nom[0]), { "2s10s": 38, "3m10y": 88, "5s30s": 54 });
  const real = C.parseCurveCsv('Date,"5 YR","7 YR","10 YR","20 YR","30 YR"\n10/19/2026,2.56,2.67,2.80,3.06,3.21\n');
  assert.deepStrictEqual(C.breakevens(nom, real), { date: "2026-10-19", be: { "5Y": 2.38, "7Y": 2.37, "10Y": 2.35, "20Y": 2.47, "30Y": 2.27 } });
});

test("comparisons pick the row on or before the date; inversion streaks", () => {
  const rows = [["2026-10-20", 4.0, 4.2], ["2026-10-19", 4.1, 4.0], ["2026-10-13", 4.2, 4.0], ["2026-09-18", 4.3, 4.1]]
    .map(([date, two, ten]) => ({ date, y: { "2Y": two, "10Y": ten, "3M": 4.5 } }));
  assert.strictEqual(C.ago(rows, 7).date, "2026-10-13");
  assert.strictEqual(C.ago(rows, 30).date, "2026-09-18");
  assert.deepStrictEqual(C.inversion(rows, "2s10s"), { inverted: false, since: "2026-10-20", sessions: 1, full: false });
  assert.deepStrictEqual(C.inversion(rows.slice(1), "2s10s"), { inverted: true, since: "2026-09-18", sessions: 3, full: true });
  const p = C.payload({ at: 1, nominal: rows, real: [] });
  assert.strictEqual(p.cmp["1D"].date, "2026-10-19");
  assert.deepStrictEqual(p.history[0], ["2026-09-18", -20, -40, null, 4.1]);
});

test("surface: every nth session back from the newest, oldest first, incomplete days dropped", () => {
  const rows = ["2026-10-20", "2026-10-19", "2026-10-16", "2026-10-15", "2026-10-14"].map((date, i) => ({ date, y: { "2Y": 4 + i / 10, "10Y": 4.5 } }));
  delete rows[2].y["2Y"];
  assert.deepStrictEqual(C.surface(rows, 1, ["2Y", "10Y"]), { tenors: ["2Y", "10Y"], rows: [["2026-10-14", 4.4, 4.5], ["2026-10-15", 4.3, 4.5], ["2026-10-19", 4.1, 4.5], ["2026-10-20", 4, 4.5]] });
  assert.deepStrictEqual(C.surface(rows, 2, ["2Y", "10Y"]).rows.map((r) => r[0]), ["2026-10-14", "2026-10-20"]);
  assert.deepStrictEqual(C.surface([], 3).rows, []);
});
