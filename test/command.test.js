const test = require("node:test");
const assert = require("node:assert");
const { parseSearch } = require("../src/command");

test("symbol search keeps listed instruments, US first", () => {
  const r = parseSearch({ quotes: [
    { symbol: "NVD.DE", shortname: "NVIDIA CORP.", quoteType: "EQUITY", exchDisp: "XETRA" },
    { symbol: "NVDA", shortname: "NVIDIA Corporation", quoteType: "EQUITY", exchDisp: "NASDAQ" },
    { symbol: "XNVDA=F", shortname: "Micro NVIDIA", quoteType: "FUTURE" },
    { symbol: "x", quoteType: "OPTION" }
  ] });
  assert.deepStrictEqual(r.map((x) => x.sym), ["NVDA", "XNVDA=F", "NVD.DE"]);
  assert.deepStrictEqual(r[0], { sym: "NVDA", name: "NVIDIA Corporation", kind: "Stock", exch: "NASDAQ" });
});
