// SEC EDGAR pieces for the Company page: the company profile and filing list (data.sec.gov "submissions"),
// and insider trades from Form 4 filings (www.sec.gov Archives XML). All public domain, no key; the SEC asks
// every app to put a contact email in its User-Agent (company.js / the Company page ask you for one).
// Parsing is pure so it can be tested on fixtures; fetching lives in companypage.js.

const DAY = 864e5;

/** submissions JSON → profile + the filings worth listing + Form 4 accessions (newest first). */
function parseSubmissions(j) {
  const r = j?.filings?.recent || {};
  const n = (r.form || []).length;
  const cik = String(j?.cik || "").replace(/^0+/, "");
  const all = [];
  for (let i = 0; i < n; i++) {
    const accn = r.accessionNumber[i];
    all.push({
      form: r.form[i], date: r.filingDate[i], report: r.reportDate?.[i] || "", accn, doc: r.primaryDocument[i] || "",
      desc: r.primaryDocDescription?.[i] || "", items: r.items?.[i] || "",
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${r.primaryDocument[i] || ""}`
    });
  }
  const LIST = /^(10-K|10-Q|8-K|20-F|40-F|6-K|S-1|S-3|S-4|DEF 14A|SC 13D|SC 13G|424B\d?)(\/A)?$/;
  const biz = j?.addresses?.business || {};
  return {
    profile: {
      name: j?.name || "", cik, sic: j?.sicDescription || "", exchanges: j?.exchanges || [], tickers: j?.tickers || [],
      fiscalYearEnd: j?.fiscalYearEnd || "", state: j?.stateOfIncorporation || "", category: j?.category || "",
      website: j?.website || "", city: [biz.city, biz.stateOrCountry].filter(Boolean).join(", "), phone: j?.phone || "", formerNames: (j?.formerNames || []).map((x) => x.name).slice(0, 3)
    },
    filings: all.filter((f) => LIST.test(f.form)).slice(0, 40),
    form4: all.filter((f) => f.form === "4").map((f) => ({ ...f, xml: f.url.replace(/\/xsl[^/]*\/([^/]+\.xml)$/i, "/$1") })).slice(0, 60)
  };
}

// ---------- Form 4 ----------
const tag = (xml, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml); return m ? m[1] : ""; };
const val = (xml, name) => tag(tag(xml, name) || "", "value").trim() || tag(xml, name).replace(/<[^>]+>/g, "").trim();
const all = (xml, name) => { const out = [], re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"); let m; while ((m = re.exec(xml))) out.push(m[1]); return out; };
const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');

// what each transaction code means; only P and S are trades the insider chose to make in the market
const CODES = {
  P: "Bought", S: "Sold", A: "Award", M: "Option exercise", F: "Tax withholding", G: "Gift", D: "Returned to company",
  C: "Conversion", X: "Option exercise", J: "Other", W: "Inheritance", I: "Plan trade", K: "Swap"
};

/** "LEVINSON ARTHUR D" → "Arthur D Levinson"; names already in mixed case stay as they are. */
function personName(s) {
  s = decode(s).trim();
  if (/\b(inc|llc|l\.?p|trust|corp|fund|capital|holdings|partners|management|ltd|co)\b\.?/i.test(s)) return s;
  // the SEC files people as "Last First Middle", in caps or as typed
  const parts = (s === s.toUpperCase() ? s.toLowerCase() : s).split(/\s+/).map((w) => w.replace(/(^|[-'])\w/g, (c) => c.toUpperCase()));
  return parts.length > 1 ? [...parts.slice(1), parts[0]].join(" ") : parts[0];
}

/** One Form 4 XML → { owner, role, date, rows: [{ date, code, what, shares, price, value, ad, after, plan }] } (common stock rows only). */
function parseForm4(xml) {
  const owner = personName(tag(tag(xml, "reportingOwnerId"), "rptOwnerName"));
  const rel = tag(xml, "reportingOwnerRelationship");
  const is = (k) => /^(1|true)$/i.test(tag(rel, k).trim());
  const title = decode(tag(rel, "officerTitle").trim());
  const role = [is("isOfficer") && (title || "Officer"), is("isDirector") && "Director", is("isTenPercentOwner") && "10% owner", is("isOther") && decode(tag(rel, "otherText").trim() || "Other")]
    .filter(Boolean).filter((x, i, xs) => xs.indexOf(x) === i).join(", ");
  const plan = /<aff10b5One>\s*(1|true)\s*<\/aff10b5One>/i.test(xml);
  const rows = all(xml, "nonDerivativeTransaction").map((t) => {
    const code = val(t, "transactionCode") || tag(tag(t, "transactionCoding"), "transactionCode").trim();
    const shares = parseFloat(val(t, "transactionShares")) || 0;
    const price = parseFloat(val(t, "transactionPricePerShare"));
    return {
      date: val(t, "transactionDate").slice(0, 10), code, what: CODES[code] || code, shares,
      price: isFinite(price) && price > 0 ? price : null, value: isFinite(price) && price > 0 ? shares * price : null,
      ad: val(t, "transactionAcquiredDisposedCode"), after: parseFloat(val(t, "sharesOwnedFollowingTransaction")) || null, plan
    };
  }).filter((r) => r.date && r.shares);
  return { owner, role, date: rows[0]?.date || val(xml, "periodOfReport"), rows };
}

/**
 * Open-market buying vs selling over the last `days` (codes P and S only: awards, option exercises and
 * tax withholding are pay, not a view on the stock). Also lists the insiders behind it.
 */
function insiderSummary(filings, days = 182, now = Date.now()) {
  const from = new Date(now - days * DAY).toISOString().slice(0, 10);
  const s = { buys: 0, buyValue: 0, sells: 0, sellValue: 0, buyers: new Set(), sellers: new Set(), planSells: 0 };
  for (const f of filings) for (const r of f.rows) {
    if (r.date < from) continue;
    if (r.code === "P") { s.buys++; s.buyValue += r.value || 0; s.buyers.add(f.owner); }
    if (r.code === "S") { s.sells++; s.sellValue += r.value || 0; s.sellers.add(f.owner); if (r.plan) s.planSells++; }
  }
  return { days, buys: s.buys, buyValue: s.buyValue, sells: s.sells, sellValue: s.sellValue, buyers: [...s.buyers], sellers: [...s.sellers], planSells: s.planSells };
}

// ---------- institutional holders (Nasdaq, built from 13F filings) ----------
const n = (s) => { const v = parseFloat(String(s ?? "").replace(/[$,%]/g, "")); return isFinite(v) ? v : null; };
/** Nasdaq institutional-holdings JSON → summary, increased/decreased counts and the top holders. Values in dollars. */
function parseHolders(j) {
  const d = j?.data;
  if (!d) return null;
  const os = d.ownershipSummary || {};
  const pos = Object.fromEntries((d.activePositions?.rows || []).map((r) => [r.positions, { holders: n(r.holders), shares: n(r.shares) }]));
  const np = Object.fromEntries((d.newSoldOutPositions?.rows || []).map((r) => [r.positions, { holders: n(r.holders), shares: n(r.shares) }]));
  return {
    pct: n(os.SharesOutstandingPCT?.value), sharesOut: n(os.ShareoutstandingTotal?.value) != null ? n(os.ShareoutstandingTotal.value) * 1e6 : null,
    value: n(os.TotalHoldingsValue?.value) != null ? n(os.TotalHoldingsValue.value) * 1e6 : null,
    increased: pos["Increased Positions"] || null, decreased: pos["Decreased Positions"] || null, held: pos["Held Positions"] || null,
    total: pos["Total Institutional Shares"] || null, newPos: np["New Positions"] || null, soldOut: np["Sold Out Positions"] || null,
    top: (d.holdingsTransactions?.table?.rows || []).map((r) => ({
      name: r.ownerName, date: r.date, shares: n(r.sharesHeld), change: n(r.sharesChange), changePct: n(r.sharesChangePCT), value: n(r.marketValue) != null ? n(r.marketValue) * 1e3 : null
    })),
    count: n(d.holdingsTransactions?.totalRecords)
  };
}

module.exports = { parseSubmissions, parseForm4, insiderSummary, parseHolders, personName, CODES };
