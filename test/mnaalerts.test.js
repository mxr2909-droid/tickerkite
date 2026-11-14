const test = require("node:test");
const assert = require("node:assert");
const A = require("../src/mna-alerts");

const NOW = Date.parse("2026-11-13T12:00:00Z");
const deal = (id, o = {}) => ({ id, target: { name: "Varonis Systems", tickers: ["VRNS"], cik: "1" }, acquirers: [{ name: "Acme Corp", tickers: ["ACME"] }], sector: "Technology", type: "Merger", date: "2026-11-10", value: 6.6e9, price: 49.75, ...o });

test("sanitizePrefs gives safe defaults and clamps bad input", () => {
  assert.deepEqual(A.sanitizePrefs(null), { on: false, sectors: [], watch: true, minSize: 0, types: [] });
  const p = A.sanitizePrefs({ on: "yes", sectors: ["Energy", 5, "Energy"], watch: false, minSize: 123, types: ["Merger", "Bogus"] });
  assert.deepEqual(p, { on: false, sectors: ["Energy"], watch: false, minSize: 0, types: ["Merger"] });
  assert.equal(A.sanitizePrefs({ on: true, minSize: 1e9 }).minSize, 1e9);
  assert.equal(A.sanitizePrefs({ on: true }).on, true);
});

test("matches: SPACs never, watchlist always, then sector, type and size", () => {
  const on = { on: true };
  assert.equal(A.matches(deal("a", { sector: "SPACs & shells", type: "SPAC merger" }), on, ["VRNS"]), null);
  assert.equal(A.matches(deal("a", { sector: "Energy" }), { on: true, sectors: ["Technology"], minSize: 1e10 }, ["VRNS"]), "on your watchlist");
  assert.equal(A.matches(deal("a"), { on: true, sectors: ["Energy"] }, ["acme"]), "on your watchlist"); // acquirer ticker, case-insensitive
  assert.equal(A.matches(deal("a"), { on: true, sectors: ["Energy"], watch: false }, ["VRNS"]), null);
  assert.equal(A.matches(deal("a"), { on: true, sectors: ["Energy"] }, []), null);
  assert.equal(A.matches(deal("a"), { on: true, sectors: ["Technology"] }, []), "Technology");
  assert.equal(A.matches(deal("a"), { on: true, types: ["Tender offer"] }, []), null);
  assert.ok(A.matches(deal("a"), { on: true, types: ["Merger"] }, []));
  assert.equal(A.matches(deal("a"), { on: true, minSize: 1e9 }, []), "$1B+ deal");
  assert.equal(A.matches(deal("a", { value: 5e8 }), { on: true, minSize: 1e9 }, []), null);
  assert.equal(A.matches(deal("a", { value: null }), { on: true, minSize: 1e8 }, []), null);
  assert.ok(A.matches(deal("a", { value: null }), { on: true, minSize: 0 }, []));
});

test("pick: first run seeds without alerting", () => {
  const r = A.pick([deal("a"), deal("b")], { on: true }, [], null, NOW);
  assert.deepEqual(r.alerts, []);
  assert.deepEqual(r.seen, { a: true, b: true });
});

test("pick: a new deal alerts once", () => {
  const r1 = A.pick([deal("a"), deal("b")], { on: true }, [], { a: true }, NOW);
  assert.deepEqual(r1.alerts.map((x) => x.deal.id), ["b"]);
  const r2 = A.pick([deal("a"), deal("b")], { on: true }, [], r1.seen, NOW);
  assert.equal(r2.alerts.length, 0);
});

test("pick: old deals are back-fill and never alert", () => {
  const r = A.pick([deal("old", { date: "2026-10-20" })], { on: true }, [], {}, NOW);
  assert.equal(r.alerts.length, 0);
  assert.ok(!r.seen.old);
});

test("pick: an unknown-size deal waits, then alerts once sized", () => {
  const prefs = { on: true, minSize: 1e9 };
  const r1 = A.pick([deal("x", { value: null })], prefs, [], {}, NOW);
  assert.equal(r1.alerts.length, 0);
  assert.ok(!r1.seen.x);
  const r2 = A.pick([deal("x", { value: 2e9 })], prefs, [], r1.seen, NOW);
  assert.equal(r2.alerts.length, 1);
  assert.equal(A.pick([deal("x", { value: 2e9 })], prefs, [], r2.seen, NOW).alerts.length, 0);
});

test("pick: SPAC mergers never alert", () => {
  const r = A.pick([deal("s", { type: "SPAC merger", sector: "SPACs & shells" })], { on: true }, ["VRNS"], {}, NOW);
  assert.equal(r.alerts.length, 0);
});

test("text: plain English, unknown parts omitted", () => {
  assert.deepEqual(A.text(deal("a", { acquirers: [] }), "Technology"), { title: "New deal: Varonis Systems", body: "Merger · Technology · $6.6B · $49.75 a share" });
  assert.equal(A.text(deal("a"), "x").body, "Merger · Bought by Acme Corp · Technology · $6.6B · $49.75 a share");
  assert.equal(A.text(deal("a", { value: 265e6, price: null, acquirers: [], sector: "Other" }), "x").body, "Merger · $265M");
  assert.match(A.text(deal("a", { acquirers: [] }), "on your watchlist").body, /on your watchlist$/);
  assert.equal(A.money(1e9), "$1B");
});

test("attach: notifies, caps at five, opens the M&A page, and stays quiet when off", () => {
  const shown = [], pages = [], store = {}, handlers = {};
  class N { constructor(o) { this.o = o; } on(_e, f) { this.f = f; } show() { shown.push(this); } static isSupported() { return true; } }
  const ctx = { ipcMain: { handle: (c, f) => (handlers[c] = f) }, readJSON: (f, d) => store[f] ?? d, writeJSON: (f, v) => (store[f] = JSON.parse(JSON.stringify(v))), Notification: N, showPage: (p) => pages.push(p), get: () => ({ watch: [] }) };
  const today = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  let deals = [deal("a", { date: today })];
  const al = A.attach(ctx, () => deals);
  al.check(); // off: seeds
  assert.equal(shown.length, 0);
  handlers["mna:alerts:set"]({}, { on: true });
  deals = [deal("a", { date: today }), ...[1, 2, 3, 4, 5, 6, 7].map((i) => deal(`n${i}`, { date: today }))];
  al.check();
  assert.equal(shown.length, 5);
  assert.match(shown[4].o.title, /and 3 more new deals/);
  assert.deepEqual(shown[0].o.tk, { kind: "deal", page: "mna" });
  shown[0].f();
  assert.deepEqual(pages, ["mna"]);
  al.check();
  assert.equal(shown.length, 5);
});
