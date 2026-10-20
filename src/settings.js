// Settings window contents and the first-launch terms screen: main-process side. main.js calls register(ctx) once.
//  - IPC channels start with "settings:" (the preload only forwards those)
//  - the Finnhub key is kept in prefs.json encrypted with Electron's safeStorage (macOS Keychain);
//    if the Keychain isn't available it isn't saved at all
//  - terms acceptance is prefs.terms = { version, at }; raising TERMS_VERSION asks everyone again
const fs = require("fs");
const path = require("path");
const finnhub = require("./data/finnhub");

const TERMS_VERSION = "1.0";
const LEGAL_DIR = path.join(__dirname, "..", "legal");
const LEGAL = { terms: "EULA.md", privacy: "PRIVACY.md", sources: "DATA-SOURCES.md" };

function register(ctx) {
  const { safeStorage } = require("electron");
  const prefs = ctx.prefs;
  const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };

  function finnhubKey() {
    const enc = prefs().finnhubKey;
    if (!enc || !canEncrypt()) return "";
    try { return safeStorage.decryptString(Buffer.from(enc, "base64")); } catch { return ""; }
  }
  const applyKeys = () => ctx.setKeys({ finnhub: finnhubKey() });

  const snapshot = () => {
    const k = finnhubKey();
    return {
      version: ctx.version, terms: { version: TERMS_VERSION, accepted: prefs().terms?.version === TERMS_VERSION, at: prefs().terms?.at || 0 },
      finnhub: { set: !!k, masked: k ? `${k.slice(0, 3)}…${k.slice(-3)}` : "" }, canEncrypt: canEncrypt(), license: ctx.license()
    };
  };

  ctx.ipcMain.handle("settings:get", () => snapshot());
  ctx.ipcMain.handle("settings:legal", (_e, which) => {
    const f = LEGAL[which];
    if (!f) return "";
    try { return fs.readFileSync(path.join(LEGAL_DIR, f), "utf8"); } catch { return ""; }
  });
  ctx.ipcMain.handle("settings:acceptTerms", () => {
    prefs().terms = { version: TERMS_VERSION, at: Date.now() };
    ctx.savePrefs();
    return snapshot();
  });
  ctx.ipcMain.handle("settings:setFinnhub", async (_e, raw) => {
    const key = String(raw || "").trim();
    if (!key) { delete prefs().finnhubKey; ctx.savePrefs(); applyKeys(); ctx.refreshQuotes(); return { ok: true, settings: snapshot() }; }
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(key)) return { ok: false, error: "That doesn't look like a Finnhub key." };
    if (!canEncrypt()) return { ok: false, error: "macOS Keychain isn't available, so WIRE can't store the key safely." };
    const t = await finnhub.testKey(key);
    if (!t.ok) return t;
    prefs().finnhubKey = safeStorage.encryptString(key).toString("base64");
    ctx.savePrefs();
    applyKeys();
    ctx.refreshQuotes();
    return { ok: true, settings: snapshot() };
  });
  ctx.ipcMain.handle("settings:checkUpdates", () => { ctx.checkUpdates(); return true; });

  applyKeys();
  return { termsAccepted: () => prefs().terms?.version === TERMS_VERSION };
}

module.exports = { register, TERMS_VERSION };
