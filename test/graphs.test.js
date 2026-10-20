const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const G = require("../renderer/graphs.js");
const { parseFredMeta, sourceKey } = require("../src/graphs.js");
const { parseFredCsv } = require("../src/macro/data");

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const d = (s) => Date.parse(s + "T00:00:00Z");
const cpi = parseFredCsv(fx("graphs-cpi.csv")); // missing "." rows are dropped
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("FRED series page gives title, units and frequency", () => {
  assert.deepEqual(parseFredMeta(fx("graphs-fred-meta.html"), "UNRATE"), { title: "Unemployment Rate", units: "Percent", freq: "Monthly" });
  assert.equal(sourceKey("unrate"), "fred:UNRATE");
  assert.equal(sourceKey("^gspc"), "yahoo:^GSPC");
  assert.equal(sourceKey("CL=F"), "yahoo:CL=F");
  assert.equal(sourceKey("yahoo:nvda"), "yahoo:NVDA");
});

test("transforms: level, change, year-over-year", () => {
  assert.deepEqual(G.transform(cpi, "level"), cpi);
  const chg = G.transform(cpi, "chg");
  assert.equal(chg.length, cpi.length - 1);
  close(chg[0][1], 1.5);
  close(chg[2][1], 7); // Apr 2023 → Jan 2024, across the gap
  const yoy = G.transform(cpi, "yoy");
  assert.deepEqual(yoy.map((p) => new Date(p[0]).toISOString().slice(0, 7)), ["2024-01", "2024-02", "2024-04"]);
  close(yoy[0][1], 3);
  close(yoy[1][1], (310.5 / 301.5 - 1) * 100);
  close(yoy[2][1], (308 / 302 - 1) * 100);
});

test("moving average over n observations", () => {
  const P = [1, 2, 3, 4, 5].map((v, i) => [i, v]);
  assert.deepEqual(G.movingAverage(P, 3), [[2, 2], [3, 3], [4, 4]]);
  assert.deepEqual(G.movingAverage(P, 1), P);
  assert.deepEqual(G.movingAverage(P, 9), []);
});

test("normalize rebases to 100 at the first series' start", () => {
  const a = [[d("2020-01-01"), 50], [d("2020-02-01"), 75]];
  const b = [[d("2019-12-01"), 4], [d("2019-12-31"), 8], [d("2020-02-01"), 10]];
  const [na, nb] = G.normalize([a, b]);
  assert.deepEqual(na.map((p) => p[1]), [100, 150]);
  assert.deepEqual(nb.map((p) => p[1]), [100, 125]); // based on Dec 31 (on or just before Jan 1)
  assert.deepEqual(G.normalize([a, [[d("2020-01-01"), 0]]])[1], []); // can't rebase a zero
});

test("percentile clipping ignores a single spike", () => {
  const vals = Array.from({ length: 200 }, (_, i) => i % 10);
  vals.push(1000);
  assert.equal(G.percentile([1, 2, 3, 4, 5], 50), 3);
  close(G.percentile([0, 10], 25), 2.5);
  const [lo, hi] = G.yRange(vals, true);
  assert.ok(lo >= 0 && hi < 20, `clipped to ${lo}..${hi}`);
  assert.deepEqual(G.yRange(vals, false), [0, 1000]);
});

test("recession spans from USREC", () => {
  const P = ["2007-11-01", "2007-12-01", "2008-01-01", "2009-06-01", "2009-07-01"].map((s, i) => [d(s), [0, 1, 1, 1, 0][i]]);
  assert.deepEqual(G.recessionSpans(P), [[d("2007-12-01"), d("2009-07-01")]]);
});

test("CSV and TSV output align series on dates", () => {
  const a = [[d("2024-01-01"), 1.5], [d("2024-02-01"), 2]];
  const b = [[d("2024-02-01"), 10]];
  const rows = G.toTable([a, b]);
  assert.deepEqual(rows, [["2024-01-01", 1.5, ""], ["2024-02-01", 2, 10]]);
  assert.equal(G.toDelimited(["date", "UNRATE", "S&P, \"500\""], rows, ","),
    'date,UNRATE,"S&P, ""500"""\n2024-01-01,1.5,\n2024-02-01,2,10\n');
  assert.equal(G.toDelimited(["date", "a\tb", "c"], rows, "\t"), "date\ta b\tc\n2024-01-01\t1.5\t\n2024-02-01\t2\t10\n");
});
