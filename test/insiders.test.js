const test = require("node:test");
const assert = require("node:assert");
const zlib = require("zlib");
const I = require("../src/insiders");

// build a tiny zip in memory (one deflated entry) to test the reader
function zip(name, text) {
  const data = zlib.deflateRawSync(Buffer.from(text)), nm = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(nm.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(data.length, 20); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, nm, data]), dir = Buffer.concat([cen, nm]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, dir, end]);
}

test("zip reader and tab-separated tables", () => {
  const f = I.unzip(zip("A.tsv", "X\tY\n1\t2\n3\t4\n"), ["A.tsv"]);
  assert.deepStrictEqual(I.tsv(f["A.tsv"]), [{ X: "1", Y: "2" }, { X: "3", Y: "4" }]);
});

test("only open-market purchases and sales count; buyers are distinct insiders", () => {
  const submissions = [{ ACCESSION_NUMBER: "a", ISSUERCIK: "0000000100" }, { ACCESSION_NUMBER: "b", ISSUERCIK: "100" }, { ACCESSION_NUMBER: "c", ISSUERCIK: "100" }];
  const owners = [{ ACCESSION_NUMBER: "a", RPTOWNERCIK: "1" }, { ACCESSION_NUMBER: "b", RPTOWNERCIK: "1" }, { ACCESSION_NUMBER: "c", RPTOWNERCIK: "2" }];
  const trades = [
    { ACCESSION_NUMBER: "a", TRANS_CODE: "P", TRANS_SHARES: "100", TRANS_PRICEPERSHARE: "10" },
    { ACCESSION_NUMBER: "b", TRANS_CODE: "P", TRANS_SHARES: "50", TRANS_PRICEPERSHARE: "10" },  // same insider again
    { ACCESSION_NUMBER: "c", TRANS_CODE: "S", TRANS_SHARES: "20", TRANS_PRICEPERSHARE: "10" },
    { ACCESSION_NUMBER: "c", TRANS_CODE: "A", TRANS_SHARES: "999", TRANS_PRICEPERSHARE: "0" }  // a grant: ignored
  ];
  const m = I.summarize({ submissions, trades, owners });
  assert.deepStrictEqual(m.get(100), { buyers: 1, who: ["1"], buys: 2, sells: 1, buyUsd: 1500, sellUsd: 200 });
  const both = I.merge([m, m]).get(100);
  assert.strictEqual(both.buyUsd, 3000);
  assert.strictEqual(both.buyers, 1, "the same insider in two quarters counts once");
  assert.deepStrictEqual(I.quarterBefore(2026, 1), [2025, 4]);
});
