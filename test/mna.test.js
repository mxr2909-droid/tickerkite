const test = require("node:test");
const assert = require("node:assert");
const M = require("../src/mna");

const hit = (adsh, form, date, names, sics, extra = {}) => ({ _id: `${adsh}:doc.htm`, _source: { adsh, form, root_forms: [form.replace(/\/A$/, "")], file_date: date, display_names: names, sics, biz_states: ["NY"], ...extra } });

test("sector and industry from SIC codes", () => {
  assert.equal(M.sectorOf("2834"), "Health care");
  assert.equal(M.sectorOf("7372"), "Technology");
  assert.equal(M.sectorOf("6770"), "SPACs & shells");
  assert.equal(M.sectorOf("6798"), "Real estate");
  assert.equal(M.sectorOf("6022"), "Financials");
  assert.equal(M.sectorOf("1311"), "Energy");
  assert.equal(M.sectorOf("4911"), "Utilities");
  assert.equal(M.sectorOf("3533"), "Energy");
  assert.equal(M.sectorOf("5812"), "Consumer");
  assert.equal(M.sectorOf(""), "Other");
  assert.equal(M.sectorOf("9995"), "Other");
  for (const s of ["100", "1040", "2834", "3674", "4841", "5990", "6411", "7389", "8742"]) assert.ok(M.SECTORS.includes(M.sectorOf(s)), s);
  assert.equal(M.industryOf(""), "Not classified");
  assert.match(M.industryOf("99999"), /SIC 99999/);
});

test("EDGAR display names: name, tickers, CIK; all-caps names tidied", () => {
  assert.deepEqual(M.parseEntity("Pacira BioSciences, Inc.  (PCRX)  (CIK 0001396814)"), { name: "Pacira BioSciences, Inc.", tickers: ["PCRX"], cik: "1396814" });
  assert.deepEqual(M.parseEntity("ULTRALIFE CORP  (ULBI)  (CIK 0000875657)"), { name: "Ultralife Corp", tickers: ["ULBI"], cik: "875657" });
  assert.deepEqual(M.parseEntity("Priority Technology Holdings, Inc.  (PRTH, PRTHU)  (CIK 0001653558)").tickers, ["PRTH", "PRTHU"]);
  assert.deepEqual(M.parseEntity("EnerSys  (CIK 0001289308)"), { name: "EnerSys", tickers: [], cik: "1289308" });
  assert.equal(M.parseEntity("LIFECORE BIOMEDICAL, INC. \\DE\\  (LFCR)  (CIK 0001005286)").name, "Lifecore Biomedical, Inc.");
  assert.equal(M.tidyName("BANK OF THE OZARKS LLC"), "Bank of the Ozarks LLC");
});

test("filings fold into deals: amendments join, buyers named, types and stages", () => {
  const T = "Target Co  (TGT)  (CIK 0000000111)", B = "Buyer Inc  (BUY)  (CIK 0000000222)", SUB = "Buyer Merger Sub, Inc.  (CIK 0000000333)";
  const fs = [
    hit("a-1", "SC TO-T", "2026-09-01", [T, SUB, B], ["7372", "7372"]),
    hit("a-2", "SC TO-T/A", "2026-09-20", [T, SUB, B], ["7372"]),
    hit("b-1", "PREM14A", "2026-08-01", ["VOTE CORP  (VOT)  (CIK 0000000444)"], ["2834"]),
    hit("b-2", "DEFM14A", "2026-09-05", ["VOTE CORP  (VOT)  (CIK 0000000444)"], ["2834"]),
    hit("b-3", "SC 13E3", "2026-08-02", ["VOTE CORP  (VOT)  (CIK 0000000444)", "Sponsor LP  (CIK 0000000555)"], ["2834"]),
    hit("c-1", "DEFM14A", "2024-12-01", ["Blank Check Corp  (CIK 0000000666)"], ["6770"]),
    hit("d-1", "PREM14A", "2025-01-10", [T], ["7372"]), // same target, 20 months earlier: a separate deal
    hit("x-1", "10-K", "2026-09-01", [T], ["7372"])
  ].map(M.filingFromHit).filter(Boolean);
  assert.equal(fs.length, 7);
  const now = Date.parse("2026-11-13");
  const deals = M.buildDeals(fs, { "a-1": { v: 265356325, px: 16.25 }, "b-1": { v: 6.6e9 } }, now);
  assert.equal(deals.length, 4);
  assert.deepEqual(deals.map((d) => d.date), ["2026-09-01", "2026-08-01", "2025-01-10", "2024-12-01"]);
  const [tender, vote, old, spac] = deals;
  assert.equal(tender.type, "Tender offer"); assert.equal(tender.stage, "Tender offer filed");
  assert.deepEqual(tender.acquirers.map((a) => a.name), ["Buyer Inc", "Buyer Merger Sub, Inc."]); // the parent before its shell
  assert.equal(tender.value, 265356325); assert.equal(tender.price, 16.25);
  assert.equal(tender.filings.length, 2); assert.equal(tender.filings[0].form, "SC TO-T/A");
  assert.equal(tender.lastDate, "2026-09-20"); assert.equal(tender.active, true);
  assert.equal(tender.sector, "Technology");
  assert.match(tender.filings[0].url, /Archives\/edgar\/data\/111\/a2\/doc\.htm$/);
  assert.equal(vote.type, "Going private"); assert.equal(vote.stage, "Vote scheduled");
  assert.equal(vote.value, 6.6e9); assert.equal(vote.target.name, "Vote Corp");
  assert.deepEqual(vote.acquirers.map((a) => a.name), ["Sponsor LP"]);
  assert.deepEqual(vote.sizeFrom, ["b-1", "b-3", "b-2"]);
  assert.equal(old.stage, "Preliminary proxy"); assert.equal(old.active, false); assert.equal(old.value, null);
  assert.equal(spac.type, "SPAC merger"); assert.equal(spac.sector, "SPACs & shells");
});

test("fee exhibit: inline XBRL and plain HTML, with the offer price", () => {
  const ix = `<td>Total Transaction Valuation:</td><td>$<ix:nonFraction name="ffd:TtlTxValtn" contextRef="c" unitRef="USD" decimals="2" format="ixt:num-dot-decimal">265,356,325.00</ix:nonFraction></td>
    <p>which may be entitled to receive the offer price of $16.25 per ADS, net to the seller in cash</p>`;
  assert.deepEqual(M.parseFee(ix), { v: 265356325, px: 16.25 });
  const old = `<table><tr><td>Fees to Be Paid</td><td>$3,017,198,225.00</td></tr><tr><td>Total Transaction Valuation</td><td>&nbsp;$3,017,198,225.00</td></tr></table>
    <p>at a purchase price of $25.00 per share, net to the seller in cash</p>`;
  assert.deepEqual(M.parseFee(old), { v: 3017198225, px: 25 });
  const prem = `Table 1: Transaction Valuation Proposed Maximum Aggregate Value of Transaction Fee Rate Amount of Filing Fee Fees to Be Paid $699,385,265.82 (1) 0.0001102 $77,072.26`;
  assert.equal(M.parseFee(prem).v, 699385266);
  assert.deepEqual(M.parseFee("<p>No fee required.</p>"), { v: null, px: null });
  assert.equal(M.parseFee('<ix:nonFraction name="ffd:TtlTxValtn">0.00</ix:nonFraction>').v, null);
});

test("fee exhibit file is found in a filing's listing", () => {
  const idx = (names) => ({ directory: { item: names.map((name) => ({ name })) } });
  assert.equal(M.feeDocFromIndex(idx(["0001-index.html", "d469729dsctot.htm", "d469729dexfilingfees.htm", "d469729dexfilingfees_htm.xml"])), "d469729dexfilingfees.htm");
  assert.equal(M.feeDocFromIndex(idx(["ea0310652-01.htm", "ea031065201ex-fee.htm"])), "ea031065201ex-fee.htm");
  assert.equal(M.feeDocFromIndex(idx(["tm238036-2_prem14a.htm", "tm238036d3_ex-filingfees.htm"])), "tm238036d3_ex-filingfees.htm");
  assert.equal(M.feeDocFromIndex(idx(["proxy.htm", "ex107.htm"])), "ex107.htm");
  assert.equal(M.feeDocFromIndex(idx(["ny20084401x2_defm14a.htm", "pc01.jpg"])), null);
});

test("month keys and the yearly spending summary", () => {
  assert.deepEqual(M.monthKeys(3, Date.parse("2026-01-15")), ["2025-11", "2025-12", "2026-01"]);
  const s = M.spendFromFrame({ data: [{ entityName: "BIG CO", cik: 1, val: 3e9 }, { entityName: "Small Co", cik: 2, val: 5e8 }, { entityName: "Typo", cik: 3, val: 9e12 }, { entityName: "Neg", cik: 4, val: -5 }] }, 2025);
  assert.equal(s.total, 3.5e9); assert.equal(s.n, 2); assert.equal(s.big, 1); assert.equal(s.top[0].name, "Big Co");
});
