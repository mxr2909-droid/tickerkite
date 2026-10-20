const test = require("node:test");
const assert = require("node:assert");
const { status, ours, mask, STORE, TRIAL_DAYS, GRACE_DAYS } = require("../src/license");

const DAY = 864e5, NOW = Date.parse("2026-10-20T12:00:00Z");

test("a new install is on a trial that counts down, then locks", () => {
  assert.deepStrictEqual([status({ firstRun: NOW }, { now: NOW }).mode, status({ firstRun: NOW }, { now: NOW }).trialLeft], ["trial", TRIAL_DAYS]);
  const late = status({ firstRun: NOW - 10.5 * DAY }, { now: NOW });
  assert.strictEqual(late.trialLeft, 4);
  assert.strictEqual(late.locked, false);
  const over = status({ firstRun: NOW - TRIAL_DAYS * DAY - 1 }, { now: NOW });
  assert.deepStrictEqual([over.mode, over.locked], ["expired", true]);
});

test("development runs are never locked", () => {
  const s = status({ firstRun: NOW - 400 * DAY }, { now: NOW, enforce: false });
  assert.deepStrictEqual([s.mode, s.locked], ["dev", false]);
});

test("an active license holds offline for the grace period, then locks", () => {
  const st = { firstRun: NOW - 100 * DAY, key: "ABCD-1234-EFGH-5678", instanceId: "i", status: "active", customer: "Pat" };
  const fresh = status({ ...st, validatedAt: NOW - 2 * DAY }, { now: NOW });
  assert.deepStrictEqual([fresh.mode, fresh.locked, fresh.key, fresh.customer], ["licensed", false, "ABCD…5678", "Pat"]);
  const stale = status({ ...st, validatedAt: NOW - (GRACE_DAYS + 1) * DAY }, { now: NOW });
  assert.deepStrictEqual([stale.mode, stale.locked], ["offline", true]);
});

test("an expired or disabled key locks once the trial is over, with a reason", () => {
  const s = status({ firstRun: NOW - 100 * DAY, key: "ABCD-1234-EFGH-5678", status: "expired" }, { now: NOW });
  assert.deepStrictEqual([s.mode, s.locked], ["invalid", true]);
  assert.match(s.message, /expired/);
  const inTrial = status({ firstRun: NOW, key: "ABCD-1234-EFGH-5678", status: "disabled" }, { now: NOW });
  assert.deepStrictEqual([inTrial.mode, inTrial.locked], ["trial", false]);
});

test("keys from another store or product are refused once the store is set", () => {
  const saved = { ...STORE };
  try {
    STORE.storeId = 1; STORE.productId = 2;
    assert.strictEqual(ours({ store_id: 1, product_id: 2 }), true);
    assert.strictEqual(ours({ store_id: 9, product_id: 2 }), false);
    assert.strictEqual(ours({ store_id: 1, product_id: 9 }), false);
  } finally { Object.assign(STORE, saved); }
  assert.strictEqual(mask(""), "");
});
