const test = require("node:test");
const assert = require("node:assert");
const { isCommon, baseName, yahooSymbol, buildSectors, periodRefs, liveQuote, firmNow, groupReturn, view, nyYmd } = require("../src/sectormap");
const { squarify, depthOrder } = require("../renderer/treemap");

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const row = (symbol, name, cap, sector, o = {}) => ({ symbol, name, lastsale: "$100.00", pctchange: "1.5%", marketCap: String(cap), volume: "1000", sector, industry: "Things", country: "United States", ...o });

test("keeps ordinary shares and ADRs, drops notes, preferreds, units and odd depositary shares", () => {
  assert.ok(isCommon("AAPL", "Apple Inc. Common Stock"));
  assert.ok(isCommon("UL", "Unilever PLC American Depositary Shares (each representing one share)"));
  assert.ok(!isCommon("TBB", "AT&T Inc. 5.350% Global Notes due 2066"));
  assert.ok(!isCommon("CCZ", "Comcast Holdings ZONES"));
  assert.ok(!isCommon("GOOGN", "Alphabet Inc. Depositary Shares representing a 1/2 interest"));
  assert.ok(!isCommon("NOVTU", "Novanta Inc. Tangible Equity Units"));
  assert.ok(!isCommon("ABR^D", "Arbor Realty Trust Preferred Series D"));
});

test("issuer name and Yahoo symbol", () => {
  assert.equal(baseName("Alphabet Inc. Class A Common Stock"), "Alphabet Inc.");
  assert.equal(baseName("Alphabet Inc. Class C Capital Stock"), "Alphabet Inc.");
  assert.equal(baseName("Home Depot Inc. (The) Common Stock"), "Home Depot Inc.");
  assert.equal(baseName("Visa Inc."), "Visa Inc.");
  assert.equal(yahooSymbol("BRK/B"), "BRK-B");
  assert.equal(yahooSymbol("GEF.B"), "GEF-B");
});

test("builds sectors: share classes count once, the top N stay, largest first", () => {
  const s = buildSectors([
    row("GOOGL", "Alphabet Inc. Class A Common Stock", 300, "Technology", { volume: "900" }),
    row("GOOG", "Alphabet Inc. Class C Capital Stock", 299, "Technology", { volume: "500" }),
    row("AAPL", "Apple Inc. Common Stock", 500, "Technology"),
    row("TINY", "Tiny Corp Common Stock", 1, "Technology"),
    row("JPM", "JP Morgan Chase & Co. Common Stock", 900, "Finance"),
    row("BRK/B", "Berkshire Hathaway Inc.", 1000, ""),          // no sector from Nasdaq: placed by hand
    row("XYZ", "Unsorted Corp Common Stock", 50, ""),            // no sector: left out
    row("TBB", "AT&T Inc. 5.350% Global Notes due 2066", 800, "Technology"),
    row("ZERO", "No Cap Inc. Common Stock", 0, "Technology")
  ], 2);
  assert.deepEqual(s.map((x) => x.name), ["Finance", "Technology"]);
  assert.deepEqual(s[0].firms.map((f) => f.sym), ["BRK-B", "JPM"]);
  assert.deepEqual(s[1].firms.map((f) => f.sym), ["AAPL", "GOOGL"]);
  assert.equal(s[1].firms[1].cap, 300);
  assert.equal(s[1].firms[0].d1, 1.5);
  assert.equal(s[1].firms[0].price, 100);
});

test("reference closes count back from today, on or before each date", () => {
  // one bar per weekday, close = day of the year 2026 (negative for 2025)
  const bars = [];
  for (let t = Date.parse("2025-10-01"); t <= Date.parse("2026-11-06"); t += 86400000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) bars.push({ t, close: (t - Date.parse("2026-01-01")) / 86400000 + 1 });
  }
  const at = (iso) => (Date.parse(iso) - Date.parse("2026-01-01")) / 86400000 + 1;
  const r = periodRefs(bars, 20261109); // a Monday
  near(r["1W"], at("2026-11-02"));
  near(r["1M"], at("2026-10-09"));
  near(r["3M"], at("2026-08-07"));   // Aug 9 is a Sunday
  near(r.YTD, at("2025-12-31"));
  near(r["1Y"], at("2025-11-07"));   // Nov 9 2025 is a Sunday
  near(r.last, at("2026-11-06"));
  assert.equal(periodRefs([], 20261109), null);
  assert.equal(periodRefs([{ t: Date.parse("2026-11-06"), close: 5 }], 20261109)["1Y"], null);
});

test("live price replaces Nasdaq's, scales the cap and drives every period", () => {
  const firm = { sym: "A", name: "A", cap: 1000, price: 100, d1: -1 };
  const refs = { "1W": 100, "1M": 80, "3M": null, YTD: 55, "1Y": 50, last: 100 };
  const f = firmNow(firm, refs, { price: 110, prev: 100 });
  near(f.ret["1D"], 10); near(f.ret["1W"], 10); near(f.ret["1M"], 37.5); near(f.ret.YTD, 100); near(f.ret["1Y"], 120);
  assert.equal(f.ret["3M"], null);
  near(f.cap, 1100); near(f.price, 110);
  assert.ok(!("d1" in f));
  // no live quote: Nasdaq's day change and price stand
  const g = firmNow(firm, refs, null);
  near(g.ret["1D"], -1); near(g.ret["1M"], 25); near(g.cap, 1000);
  // sources disagree (a split between them): the cap isn't rescaled, and without a live quote no long periods
  near(firmNow(firm, refs, { price: 10, prev: 10 }).cap, 1000);
  assert.equal(firmNow(firm, { ...refs, last: 10 }, null).ret["1M"], null);
  assert.equal(firmNow(firm, null, null).ret["1Y"], null);
  assert.deepEqual(liveQuote([{ close: 5 }, { close: 6 }]), { price: 6, prev: 5 });
  assert.equal(liveQuote([{ close: 5 }]), null);
});

test("group return weights by value at the start of the period", () => {
  // 100 → 110 and 100 → 50: the group went 200 → 160
  near(groupReturn([{ cap: 110, ret: 10 }, { cap: 50, ret: -50 }]), -20);
  near(groupReturn([{ cap: 110, ret: 10 }, { cap: 999, ret: null }]), 10);
  assert.equal(groupReturn([{ cap: 5, ret: null }]), null);
  const v = view([{ id: "S", name: "S", firms: [{ sym: "A", cap: 100, price: 10, d1: 1 }, { sym: "B", cap: 300, price: 10, d1: 0 }] }], {}, { A: { price: 44, prev: 40 } });
  assert.deepEqual(v[0].firms.map((f) => f.sym), ["B", "A"]); // A's cap is not rescaled: 44 vs 10 is not the same share
  near(v[0].cap, 400);
  near(v[0].ret["1D"], (400 / (100 / 1.1 + 300) - 1) * 100);
  assert.equal(v[0].ret["1Y"], null);
});

test("New York date as a number", () => {
  assert.equal(nyYmd(new Date("2026-11-10T03:30:00Z")), 20261109);
  assert.equal(nyYmd(new Date("2026-11-10T06:00:00Z")), 20261110);
});

test("treemap: areas in proportion, inside the rectangle, no overlap, input order kept", () => {
  const vals = [5, 40, 0, 12, 3, 20, 1, 8, 8, 2.5];
  const R = { x: 10, y: 20, w: 640, h: 360 }, out = squarify(vals, R), total = vals.reduce((a, b) => a + b, 0);
  out.forEach((r, i) => {
    near(r.w * r.h, (vals[i] / total) * R.w * R.h, 1e-6);
    if (vals[i] > 0) assert.ok(r.x >= R.x - 1e-9 && r.y >= R.y - 1e-9 && r.x + r.w <= R.x + R.w + 1e-6 && r.y + r.h <= R.y + R.h + 1e-6);
  });
  for (let a = 0; a < out.length; a++) for (let b = a + 1; b < out.length; b++) {
    const ox = Math.min(out[a].x + out[a].w, out[b].x + out[b].w) - Math.max(out[a].x, out[b].x);
    const oy = Math.min(out[a].y + out[a].h, out[b].y + out[b].h) - Math.max(out[a].y, out[b].y);
    assert.ok(ox < 1e-6 || oy < 1e-6, `tiles ${a} and ${b} overlap`);
  }
  // the biggest tiles are reasonably square
  const big = out[1]; assert.ok(Math.max(big.w / big.h, big.h / big.w) < 3);
  assert.deepEqual(squarify([], R), []);
  assert.equal(squarify([1, 2], { x: 0, y: 0, w: 0, h: 10 })[0].w, 0);
});

test("depth order: a block is drawn before the blocks in front of it", () => {
  const rects = squarify([9, 7, 6, 5, 4, 3, 3, 2, 1, 1], { x: 0, y: 0, w: 300, h: 200 });
  for (const deg of [-50, -20, 0, 15, 50]) {
    const sin = Math.sin((deg * Math.PI) / 180), cos = Math.cos((deg * Math.PI) / 180);
    const order = depthOrder(rects, sin, cos), pos = []; order.forEach((i, k) => (pos[i] = k));
    assert.deepEqual([...order].sort((a, b) => a - b), rects.map((_, i) => i));
    for (let a = 0; a < rects.length; a++) for (let b = 0; b < rects.length; b++) {
      if (a === b) continue;
      const A = rects[a], B = rects[b];
      // B directly in front of A (shares its x-range, larger y) must come later; likewise along x on the side the camera sees
      const xo = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) > 1e-6, yo = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) > 1e-6;
      if (xo && B.y >= A.y + A.h - 1e-6) assert.ok(pos[a] < pos[b], `deg ${deg}: ${a} before ${b}`);
      if (yo && sin > 0 && B.x >= A.x + A.w - 1e-6) assert.ok(pos[a] < pos[b]);
      if (yo && sin < 0 && B.x + B.w <= A.x + 1e-6) assert.ok(pos[a] < pos[b]);
    }
  }
});
