const test = require("node:test");
const assert = require("node:assert");
const { summarize, barsFromChart, usMarketOpen, symbols } = require("../src/markets");

// one weekday bar per day from `from` to `to` (UTC), close = f(date)
function bars(from, to, f) {
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) out.push({ t, close: f(new Date(t)), high: f(new Date(t)) });
  }
  return out;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("computes every period from daily bars", () => {
  // close = 100 + day index since 2025-10-01; easy to recompute by hand
  const base = Date.parse("2025-10-01");
  const b = bars("2025-10-01", "2026-10-15", (d) => 100 + (d - base) / 86400000);
  const s = summarize(b);
  const at = (iso) => 100 + (Date.parse(iso) - base) / 86400000;
  const last = at("2026-10-15"); // a Thursday
  near(s.last, last);
  near(s.ret["1D"], (last / at("2026-10-14") - 1) * 100);
  near(s.ret["1W"], (last / at("2026-10-08") - 1) * 100);
  near(s.ret["1M"], (last / at("2026-09-15") - 1) * 100);
  near(s.ret["3M"], (last / at("2026-07-15") - 1) * 100);
  near(s.ret.YTD, (last / at("2025-12-31") - 1) * 100);
  near(s.fromHigh, 0); // rising series: at its high
});

test("falls back to the prior trading day over weekends and month ends", () => {
  const b = bars("2025-01-01", "2026-05-31", (d) => d.getUTCDate()); // close = day of month
  const s = summarize(b);
  // last bar Fri 2026-05-29 (31st is Sunday); 1W -> Fri 05-22; 1M -> 04-29 (Wed); 3M -> 02-27 (Fri, Feb 29 doesn't exist)
  near(s.last, 29);
  near(s.ret["1W"], (29 / 22 - 1) * 100);
  near(s.ret["1M"], 0);
  near(s.ret["3M"], (29 / 27 - 1) * 100);
  near(s.ret.YTD, (29 / 31 - 1) * 100); // 2025-12-31 was a Wednesday
});

test("52-week high and distance from it", () => {
  const b = bars("2025-10-01", "2026-10-15", (d) => (d.toISOString().startsWith("2026-03-02") ? 200 : 100));
  const s = summarize(b);
  near(s.high52, 200);
  near(s.fromHigh, -50);
});

test("missing history gives null returns, not NaN", () => {
  const s = summarize(bars("2026-10-01", "2026-10-15", () => 50));
  assert.equal(s.ret["3M"], null);
  assert.equal(s.ret.YTD, null);
  near(s.ret["1D"], 0);
  assert.equal(summarize([{ t: 0, close: 1, high: 1 }]), null);
});

test("parses Yahoo chart JSON, drops null bars, uses the live price", () => {
  const json = { chart: { result: [{ meta: { gmtoffset: 3600, regularMarketPrice: 12, currency: "EUR" }, timestamp: [1760000000, 1760086400, 1760172800],
    indicators: { quote: [{ close: [10, null, 11], high: [10.5, null, 11.5] }] } }] } };
  const p = barsFromChart(json);
  assert.equal(p.bars.length, 2);
  assert.equal(p.bars[0].t, 1760000000 * 1000 + 3600000);
  assert.equal(p.bars[1].close, 12);
  assert.equal(p.currency, "EUR");
  assert.equal(barsFromChart({ chart: { result: null } }), null);
});

test("US market hours in New York time", () => {
  assert.equal(usMarketOpen(new Date("2026-10-15T14:00:00Z")), true);   // Thu 10:00 EDT
  assert.equal(usMarketOpen(new Date("2026-10-15T13:00:00Z")), false);  // 09:00 EDT
  assert.equal(usMarketOpen(new Date("2026-10-15T20:30:00Z")), false);  // 16:30 EDT
  assert.equal(usMarketOpen(new Date("2026-10-17T15:00:00Z")), false);  // Saturday
});

test("symbol list covers all three sections without duplicates", () => {
  const s = symbols();
  assert.equal(new Set(s).size, s.length);
  for (const x of ["XLK", "XLRE", "^GSPC", "^BSESN", "EEM", "IWF", "RSP", "SPY"]) assert.ok(s.includes(x), x);
});
