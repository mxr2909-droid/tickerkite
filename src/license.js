// Licensing: a free trial, then a Lemon Squeezy license key (lemonsqueezy.com, which also handles payment and sales tax).
// main.js calls register(ctx) once at startup.
//  - IPC channels start with "license:" (the preload only forwards those)
//  - state lives in userData/license.json: { firstRun, key, instanceId, validatedAt, status, customer }
//
// Lemon Squeezy's license API needs no secret: activate once per Mac (one "instance"), validate at launch and
// every 12 hours, deactivate to move the license to another Mac. If the check can't reach Lemon Squeezy, the
// last good answer holds for GRACE_DAYS, so Tickerkite keeps working offline.
//
// Before selling: create the product in Lemon Squeezy, turn on "Generate license keys", and fill in STORE below.
// Development runs (npm start, not a packaged .app) are never locked.
const os = require("os");
const http = require("./data/http");

const STORE = {
  storeId: null,      // your Lemon Squeezy store ID (number), e.g. 12345
  productId: null,    // the Tickerkite product ID (number)
  checkoutUrl: ""     // the product's checkout link, opened by "Buy Tickerkite"
};
const API = "https://api.lemonsqueezy.com/v1/licenses";
const DAY = 864e5;
const TRIAL_DAYS = 14;
const GRACE_DAYS = 14;
const RECHECK_MS = 12 * 3600e3;

/** Where the app stands right now. Pure, for tests. */
function status(st, { now = Date.now(), enforce = true } = {}) {
  const firstRun = st?.firstRun || now;
  const trialLeft = Math.max(0, Math.ceil((firstRun + TRIAL_DAYS * DAY - now) / DAY));
  const base = { trialDays: TRIAL_DAYS, trialLeft, checkoutUrl: STORE.checkoutUrl, configured: STORE.storeId != null };
  if (st?.key && st.status === "active") {
    const stale = now - (st.validatedAt || 0) > GRACE_DAYS * DAY;
    if (!stale) return { ...base, mode: "licensed", locked: false, key: mask(st.key), customer: st.customer || "", validatedAt: st.validatedAt };
    return { ...base, mode: "offline", locked: enforce && trialLeft === 0, key: mask(st.key), customer: st.customer || "",
      message: `Tickerkite hasn't been able to check your license for ${GRACE_DAYS} days. Connect to the internet and press Check again.` };
  }
  if (st?.key && st.status) {
    const message = { expired: "Your Tickerkite license has expired. Renew it to keep using Tickerkite.", disabled: "This license key has been disabled.",
      inactive: "This license isn't active on this Mac. Enter it again to activate it." }[st.status] || `License status: ${st.status}.`;
    if (trialLeft > 0) return { ...base, mode: "trial", locked: false, key: mask(st.key), message };
    return { ...base, mode: "invalid", locked: enforce, key: mask(st.key), message };
  }
  if (!enforce) return { ...base, mode: "dev", locked: false };
  return { ...base, mode: trialLeft > 0 ? "trial" : "expired", locked: trialLeft === 0 };
}

const mask = (k) => (k ? `${String(k).slice(0, 4)}…${String(k).slice(-4)}` : "");

/** Does a Lemon Squeezy reply belong to this store and product? (Any store's key would otherwise activate.) */
function ours(meta) {
  if (STORE.storeId != null && meta?.store_id !== STORE.storeId) return false;
  if (STORE.productId != null && meta?.product_id !== STORE.productId) return false;
  return true;
}

async function call(action, fields) {
  try {
    const res = await http.request(`${API}/${action}`, {
      method: "POST", timeoutMs: 15000, body: new URLSearchParams(fields).toString(),
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }
    });
    return await res.json();
  } catch (e) {
    // Lemon Squeezy answers a bad key with 4xx and a JSON body that says why
    if (e.res && e.status < 500) { try { return await e.res.json(); } catch {} }
    const err = new Error(`Couldn't reach the license server (${e.message}).`); err.offline = true; throw err;
  }
}

function register(ctx) {
  const enforce = false; // licensing is switched off: no trial, no lock. Set back to `!!ctx.packaged && !process.argv.includes("--dev")` to sell it.
  let st = ctx.readJSON("license.json", null) || {};
  if (!st.firstRun) { st.firstRun = Date.now(); ctx.writeJSON("license.json", st); }
  const save = () => ctx.writeJSON("license.json", st);
  const now = () => status(st, { enforce });
  const push = () => { ctx.send("license:update", now()); ctx.onChange?.(now()); };

  async function activate(raw) {
    const key = String(raw || "").trim();
    if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) return { ok: false, error: "That doesn't look like a license key." };
    let j;
    try { j = await call("activate", { license_key: key, instance_name: `${os.hostname()} (Tickerkite)` }); }
    catch (e) { return { ok: false, error: e.message }; }
    if (!j?.activated) return { ok: false, error: j?.error || "That key couldn't be activated." };
    if (!ours(j.meta)) return { ok: false, error: "That key is for a different product." };
    st = { ...st, key, instanceId: j.instance?.id, status: j.license_key?.status || "active", validatedAt: Date.now(), customer: j.meta?.customer_name || "" };
    save(); push();
    return { ok: true, status: now() };
  }

  async function validate() {
    if (!st.key || !st.instanceId) return now();
    try {
      const j = await call("validate", { license_key: st.key, instance_id: st.instanceId });
      if (j?.valid && ours(j.meta)) st = { ...st, status: "active", validatedAt: Date.now(), customer: j.meta?.customer_name || st.customer };
      else st = { ...st, status: j?.license_key?.status && j.license_key.status !== "active" ? j.license_key.status : "inactive" };
      save();
    } catch {} // offline: keep the last good answer until the grace period runs out
    push();
    return now();
  }

  async function deactivate() {
    if (st.key && st.instanceId) { try { await call("deactivate", { license_key: st.key, instance_id: st.instanceId }); } catch {} }
    st = { firstRun: st.firstRun };
    save(); push();
    return now();
  }

  ctx.ipcMain.handle("license:get", () => now());
  ctx.ipcMain.handle("license:activate", (_e, key) => activate(key));
  ctx.ipcMain.handle("license:check", () => validate());
  ctx.ipcMain.handle("license:deactivate", () => deactivate());
  ctx.ipcMain.handle("license:buy", () => { if (STORE.checkoutUrl) ctx.openExternal(STORE.checkoutUrl); return !!STORE.checkoutUrl; });

  validate();
  setInterval(validate, RECHECK_MS);
  return { status: now };
}

module.exports = { register, status, ours, mask, STORE, TRIAL_DAYS, GRACE_DAYS };
