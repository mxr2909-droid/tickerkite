const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { parseSubmissions, parseForm4, insiderSummary, parseHolders, personName } = require("../src/sec");
const { statements } = require("../src/company");

test("submissions: profile, listed filings and Form 4 XML links", () => {
  const s = parseSubmissions(require("./fixtures/sec-submissions.json"));
  assert.strictEqual(s.profile.name, "Apple Inc.");
  assert.strictEqual(s.profile.sic, "Electronic Computers");
  assert.strictEqual(s.profile.city, "CUPERTINO, CA");
  assert.ok(s.filings.every((f) => /^(10-K|10-Q|8-K)/.test(f.form)));
  assert.match(s.filings[0].url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/\d{18}\//);
  const f4 = s.form4[0];
  assert.ok(f4.url.endsWith("/xslF345X06/form4.xml"));
  assert.ok(f4.xml.endsWith("/form4.xml") && !f4.xml.includes("xsl")); // raw XML, not the styled page
});

test("Form 4: owner, role and each common-stock transaction", () => {
  const f = parseForm4(fs.readFileSync(path.join(__dirname, "fixtures/form4.xml"), "utf8"));
  assert.strictEqual(f.role, "Principal Accounting Officer");
  assert.deepStrictEqual(f.rows.map((r) => r.code), ["M", "F", "S", "S", "S", "S", "S"]);
  const sale = f.rows.find((r) => r.code === "S");
  assert.deepStrictEqual({ shares: sale.shares, price: sale.price, ad: sale.ad, after: sale.after, plan: sale.plan }, { shares: 151, price: 343.08, ad: "D", after: 39417, plan: true });
  assert.strictEqual(f.rows[0].price, null); // option exercise: price in a footnote only
});

test("insider summary counts only open-market buys and sells", () => {
  const now = Date.UTC(2026, 9, 20);
  const fl = [
    { owner: "A", rows: [{ date: "2026-10-01", code: "S", value: 1000, plan: true }, { date: "2026-10-01", code: "F", value: 500 }, { date: "2026-10-01", code: "A", value: 9e6 }] },
    { owner: "B", rows: [{ date: "2026-09-01", code: "P", value: 2000 }, { date: "2025-01-01", code: "P", value: 1e6 }] }
  ];
  const s = insiderSummary(fl, 182, now);
  assert.deepStrictEqual({ buys: s.buys, buyValue: s.buyValue, sells: s.sells, sellValue: s.sellValue, buyers: s.buyers, sellers: s.sellers, planSells: s.planSells },
    { buys: 1, buyValue: 2000, sells: 1, sellValue: 1000, buyers: ["B"], sellers: ["A"], planSells: 1 });
});

test("people read first-name first; firms stay as filed", () => {
  assert.strictEqual(personName("LEVINSON ARTHUR D"), "Arthur D Levinson");
  assert.strictEqual(personName("Borders Ben"), "Ben Borders");
  assert.strictEqual(personName("BERKSHIRE HATHAWAY INC"), "BERKSHIRE HATHAWAY INC");
});

test("holders: totals in dollars, top holders with changes", () => {
  const h = parseHolders({ data: {
    ownershipSummary: { SharesOutstandingPCT: { value: "76.60%" }, ShareoutstandingTotal: { value: "14,594" }, TotalHoldingsValue: { value: "$3,833,603" } },
    activePositions: { rows: [{ positions: "Increased Positions", holders: "2,825", shares: "329,237,783" }, { positions: "Decreased Positions", holders: "3,209", shares: "237,453,757" }] },
    newSoldOutPositions: { rows: [{ positions: "New Positions", holders: "120", shares: "5" }] },
    holdingsTransactions: { totalRecords: "6439", table: { rows: [{ ownerName: "Vanguard Group Inc", date: "6/30/2026", sharesHeld: "1,426,283,914", sharesChange: "-26,856,752", sharesChangePCT: "-1.919%", marketValue: "$489,129,805" }] } }
  } });
  assert.strictEqual(h.pct, 76.6);
  assert.strictEqual(h.sharesOut, 14594e6);
  assert.strictEqual(h.value, 3833603e6);
  assert.deepStrictEqual(h.increased, { holders: 2825, shares: 329237783 });
  assert.strictEqual(h.newPos.holders, 120);
  assert.deepStrictEqual(h.top[0], { name: "Vanguard Group Inc", date: "6/30/2026", shares: 1426283914, change: -26856752, changePct: -1.919, value: 489129805e3 });
  assert.strictEqual(h.count, 6439);
  assert.strictEqual(parseHolders({ data: null }), null);
});

test("statements: fiscal years and quarters with derived lines", () => {
  const s = statements(require("./fixtures/companyfacts.json"));
  assert.ok(s.annual.length >= 1 && s.quarterly.length >= 4);
  const y = s.annual.at(-1);
  assert.strictEqual(y.end, "2024-12-31");
  assert.strictEqual(y.revenue, 620);
  assert.strictEqual(y.netIncome, 50);
  assert.strictEqual(s.quarterly.at(-1).revenue, 170); // Q4 = annual − nine months
  assert.ok(!("ocf" in s.quarterly[0])); // cash flow is annual only
});
