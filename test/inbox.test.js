const test = require("node:test");
const assert = require("node:assert");
const { create } = require("../src/inbox");

test("every shown notification lands in the inbox, with its target", () => {
  const store = {}, sent = [];
  const box = create({ readJSON: (n, d) => store[n] ?? d, writeJSON: (n, d) => (store[n] = d), send: (c, d) => sent.push([c, d]) });
  let shown = 0;
  class Native { constructor(o) { this.o = o; } show() { shown++; } on() {} static isSupported() { return true; } }
  const N = box.wrap(Native);
  const n = new N({ title: "Bear market: 31%", body: "Usually 9%", tk: { kind: "monitor", page: "warn" } });
  assert.strictEqual(n.o.tk, undefined, "tk isn't passed to Electron");
  n.show();
  assert.strictEqual(shown, 1);
  const s = box.snapshot();
  assert.strictEqual(s.unread, 1);
  assert.deepStrictEqual([s.items[0].title, s.items[0].kind, s.items[0].page], ["Bear market: 31%", "monitor", "warn"]);
  assert.ok(N.isSupported());
  box.markRead([s.items[0].id]); assert.strictEqual(box.snapshot().unread, 0);
  new N({ title: "x" }).show(); box.markRead(); assert.strictEqual(box.snapshot().unread, 0);
  box.clear(); assert.strictEqual(box.snapshot().items.length, 0);
  assert.ok(sent.every(([c]) => c === "inbox:update"));
});
