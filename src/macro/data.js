// Downloads the raw series behind the scorecard: FRED's public CSV export (no key needed)
// and Yahoo daily closes. Each series is a list of [timestampMs, value], oldest first.
const { fetchText } = require("../news/fetcher");
const { INDICATORS, sourcesFor, RECESSIONS } = require("./indicators");

const YEARS = 11; // 10 years of history for percentiles, plus a year for year-over-year math

function parseFredCsv(csv) {
  const out = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(",");
    const n = Number(v);
    if (!d || v === "." || v === "" || !Number.isFinite(n)) continue;
    out.push([Date.parse(d + "T00:00:00Z"), n]);
  }
  return out;
}

async function fred(id, since) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${since}`;
  const rows = parseFredCsv(await fetchText(url, 25000));
  if (!rows.length) throw new Error("no data");
  return rows;
}

async function yahoo(sym, years = YEARS) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${years}y&interval=1d`;
  const r = JSON.parse(await fetchText(url, 20000)).chart.result[0];
  const close = r.indicators.quote[0].close;
  const out = [];
  r.timestamp.forEach((t, i) => { if (close[i] != null) out.push([t * 1000, close[i]]); });
  if (!out.length) throw new Error("no data");
  return out;
}

/** Run jobs with at most `n` in flight, so we don't hammer FRED with 50 requests at once. */
async function pool(jobs, n) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

/**
 * Fetch every series the indicators need. Keeps the previous copy of any series that fails,
 * so one bad download doesn't blank a row.
 * @returns {{ series: Object<string, Array>, errors: Object<string, string>, fetchedAt: number }}
 */
async function fetchAllSeries(prev = {}, { years = YEARS } = {}) {
  const since = new Date(Date.now() - years * 365.25 * 864e5).toISOString().slice(0, 10);
  const keys = [...new Set([RECESSIONS, ...INDICATORS.flatMap(sourcesFor)])];
  const series = {}, errors = {};
  await pool(keys.map((k) => async () => {
    const [kind, id] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    try {
      series[k] = kind === "fred" ? await fred(id, since) : await yahoo(id, years);
    } catch (e) {
      errors[k] = String(e.message || e);
      if (prev[k]) series[k] = prev[k];
    }
  }), 6);
  return { series, errors, fetchedAt: Date.now() };
}

module.exports = { fetchAllSeries, parseFredCsv, yahoo };
