const test = require("node:test");
const assert = require("node:assert");
const { relevantLive, attributeIntraday, instr } = require("../src/instruments");

const now = Date.parse("2026-10-14T20:00:00Z");
const story = (id, title, mins, extra = {}) => ({
  id, title, summary: "", assets: [], kind: "news", sev: "m", score: 60, desks: ["US"], code: "RTRS",
  link: "https://x/" + id, ts: now - mins * 60e3, updated: now - mins * 60e3, signal: "X", ...extra
});

const stories = [
  story("cpi", "US CPI rises 3.7% in September, above forecasts", 400, { sev: "h", score: 85, desks: ["US", "FED"] }),
  story("oil", "Oil prices rise after Houthi attack on Aramco", 300, { desks: ["NRG"] }),
  story("spx", "S&P 500 falls 1.1% in worst day since July", 5),
  story("gold", "Gold steadies near $4,200", 100, { desks: ["GLB"] }),
  story("old", "S&P 500 record high", 60 * 30)
];

test("live relevance: direct topic matches first, macro shocks included", () => {
  const spx = relevantLive(stories, "^GSPC", now - 24 * 3600e3);
  assert.equal(spx[0].id, "spx");
  assert.ok(spx.some((s) => s.id === "cpi" && s.match === "macro"));
  assert.ok(!spx.some((s) => s.id === "old"), "outside the window");
  assert.ok(!spx.some((s) => s.id === "gold"));
  const tny = relevantLive(stories, "^TNX", now - 24 * 3600e3);
  assert.equal(tny[0].id, "cpi", "CPI matches yields directly");
  const brent = relevantLive(stories, "BZ=F", now - 24 * 3600e3);
  assert.deepEqual(brent.map((s) => s.id), ["oil"]);
});

test("intraday attribution uses headlines near each move", () => {
  const moves = [
    { n: 1, t: now - 410 * 60e3, end: now - 380 * 60e3 }, // right after CPI
    { n: 2, t: now - 30 * 60e3, end: now }                 // late selloff
  ];
  const out = attributeIntraday(stories, "^GSPC", moves);
  assert.equal(out[0].headlines[0].id, "cpi");
  assert.equal(out[1].headlines[0].id, "spx");
});

test("unknown symbols fall back to a label search", () => {
  const I = instr("XYZ", "Widget Corp");
  assert.match(I.q, /Widget Corp/);
  assert.ok(I.re.test("Widget Corp shares jump"));
});
