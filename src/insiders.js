// Insider buying and selling for every SEC filer, from the SEC's quarterly "Insider Transactions
// Data Sets" (Forms 3, 4 and 5 as tab-separated tables in one zip per quarter, ~14 MB). Used by the
// screener. Only open-market trades count: code P (purchase) and S (sale); grants, option exercises
// and gifts are left out. The SEC publishes each quarter a few weeks to months after it ends.
const zlib = require("zlib");
const { request } = require("./data/http");

const URL = (q) => `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${q}_form345.zip`;

/** Read named files out of a zip held in memory (stored or deflated entries only). */
function unzip(buf, names) {
  const want = new Set(names), out = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    if (want.has(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
    }
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** Tab-separated text → array of objects keyed by the header row. */
function tsv(text) {
  const lines = text.split(/\r?\n/), head = lines[0].split("\t"), out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split("\t"), o = {};
    for (let j = 0; j < head.length; j++) o[head[j]] = c[j];
    out.push(o);
  }
  return out;
}

/**
 * Per issuer (CIK number): distinct insiders who bought, number of purchases and sales, dollars bought and sold.
 * @returns {Map<number, { buyers, buys, sells, buyUsd, sellUsd }>}
 */
function summarize({ submissions, trades, owners }) {
  const issuer = new Map(submissions.map((s) => [s.ACCESSION_NUMBER, Number(s.ISSUERCIK)]));
  const ownerOf = new Map();
  for (const o of owners) if (!ownerOf.has(o.ACCESSION_NUMBER)) ownerOf.set(o.ACCESSION_NUMBER, o.RPTOWNERCIK);
  const out = new Map();
  for (const t of trades) {
    const code = t.TRANS_CODE;
    if (code !== "P" && code !== "S") continue;
    const cik = issuer.get(t.ACCESSION_NUMBER);
    if (!cik) continue;
    const usd = (Number(t.TRANS_SHARES) || 0) * (Number(t.TRANS_PRICEPERSHARE) || 0);
    const r = out.get(cik) || { buyerSet: new Set(), buys: 0, sells: 0, buyUsd: 0, sellUsd: 0 };
    if (code === "P") { r.buys++; r.buyUsd += usd; r.buyerSet.add(ownerOf.get(t.ACCESSION_NUMBER) || t.ACCESSION_NUMBER); }
    else { r.sells++; r.sellUsd += usd; }
    out.set(cik, r);
  }
  for (const [k, r] of out) out.set(k, { buyers: r.buyerSet.size, who: [...r.buyerSet], buys: r.buys, sells: r.sells, buyUsd: r.buyUsd, sellUsd: r.sellUsd });
  return out;
}

/** Combine several quarters' summaries; an insider who bought in more than one quarter counts once. */
function merge(maps) {
  const out = new Map();
  for (const m of maps) for (const [k, r] of m) {
    const a = out.get(k) || { who: new Set(), buys: 0, sells: 0, buyUsd: 0, sellUsd: 0 };
    for (const w of r.who || []) a.who.add(w);
    out.set(k, { who: a.who, buys: a.buys + r.buys, sells: a.sells + r.sells, buyUsd: a.buyUsd + r.buyUsd, sellUsd: a.sellUsd + r.sellUsd });
  }
  for (const [k, r] of out) out.set(k, { buyers: r.who.size, buys: r.buys, sells: r.sells, buyUsd: r.buyUsd, sellUsd: r.sellUsd });
  return out;
}

const quarterBefore = (y, q) => (q === 1 ? [y - 1, 4] : [y, q - 1]);
const label = ([y, q]) => `${y}q${q}`;

/**
 * The latest `n` published quarters, summarized. Each quarter's summary is cached forever (it doesn't change).
 * @param cache { get(q) → object | null, set(q, object) }
 */
async function latest({ headers, cache, n = 2, now = new Date() }) {
  let cur = [now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) + 1];
  const found = [];
  for (let tries = 0; tries < 6 && found.length < n; tries++) {
    cur = quarterBefore(...cur);
    const q = label(cur);
    let s = cache.get(q);
    if (!s) {
      let buf;
      try { buf = Buffer.from(await (await request(URL(q), { headers, timeoutMs: 120000 })).arrayBuffer()); }
      catch (e) { if (e.status === 404) continue; throw e; }
      const f = unzip(buf, ["SUBMISSION.tsv", "NONDERIV_TRANS.tsv", "REPORTINGOWNER.tsv"]);
      s = Object.fromEntries(summarize({ submissions: tsv(f["SUBMISSION.tsv"]), trades: tsv(f["NONDERIV_TRANS.tsv"]), owners: tsv(f["REPORTINGOWNER.tsv"]) }));
      cache.set(q, s);
    }
    found.push({ q, map: new Map(Object.entries(s).map(([k, v]) => [Number(k), v])) });
  }
  if (!found.length) return null;
  const qs = found.map((f) => f.q).reverse();
  return { quarters: qs, map: merge(found.map((f) => f.map)) };
}

module.exports = { unzip, tsv, summarize, merge, latest, quarterBefore };
