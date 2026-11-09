// Auto-updates, two ways:
//  1. Packaged, signed .app: electron-updater checks the "publish" target in package.json (GitHub Releases) at launch and
//     every 6 hours, downloads in the background, and asks once to restart.
//  2. Everyone else (a copy run from the source folder, e.g. a downloaded ZIP or a git clone): we read `version` from
//     package.json on the repo's main branch. When it is newer than this copy, an UPDATE button appears in the top bar.
//     Clicking it pulls the new code (git pull for a clone, the repo ZIP laid over the folder otherwise), reinstalls
//     dependencies only if package-lock.json changed, and relaunches. A packaged build can't rewrite itself, so its
//     button opens the repo page with rebuild instructions.
// So: to ship an update to everyone, bump "version" in package.json and push to main.
// IPC (the preload forwards "update:"): update:get → state, update:apply, and update:state pushed on change.
const { dialog } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const run = promisify(execFile);
const { getText } = require("./data/http");

const REPO = "mxr2909-droid/tickerkite";
const REPO_URL = `https://github.com/${REPO}`;
const RAW_PKG = `https://raw.githubusercontent.com/${REPO}/main/package.json`;
const ZIP_URL = `https://codeload.github.com/${REPO}/zip/refs/heads/main`;
const ROOT = path.resolve(__dirname, "..");

/** "1.10.2" → [1, 10, 2]; null when it isn't a plain x.y.z version. */
const parseVersion = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim()); return m ? m.slice(1).map(Number) : null; };
/** Is `remote` a higher version than `local`? */
function newer(remote, local) {
  const a = parseVersion(remote), b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

const hashFile = (f) => { try { return crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex"); } catch { return null; } };

/** Lay a repo ZIP (GitHub's "Download ZIP" layout: one top folder) over `root`, leaving node_modules, .git and dist alone. */
async function applyZip(zipPath, root) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tickerkite-update-"));
  try {
    await run("/usr/bin/unzip", ["-q", zipPath, "-d", tmp]);
    const dirs = fs.readdirSync(tmp).filter((d) => fs.statSync(path.join(tmp, d)).isDirectory());
    if (dirs.length !== 1) throw new Error("the downloaded ZIP has an unexpected layout");
    await run("/usr/bin/rsync", ["-a", "--checksum", "--exclude", "node_modules", "--exclude", ".git", "--exclude", "dist", path.join(tmp, dirs[0]) + "/", root + "/"]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function download(url, dest) {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Tickerkite-updater" } });
  if (!r.ok) throw new Error(`download failed (HTTP ${r.status})`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

/** npm through a login shell, so it is found even when the app was started from the Dock. */
const npmInstall = (root) => run(process.env.SHELL || "/bin/zsh", ["-lc", "npm install --no-audit --no-fund"], { cwd: root, timeout: 10 * 60e3 });

/** Update a source copy in place: git pull when it is a clone, the repo ZIP otherwise. Reinstalls packages if the lock file changed. */
async function updateSource(root = ROOT) {
  const before = hashFile(path.join(root, "package-lock.json"));
  if (fs.existsSync(path.join(root, ".git"))) {
    await run("git", ["pull", "--ff-only"], { cwd: root, timeout: 120e3 });
  } else {
    const zip = path.join(os.tmpdir(), `tickerkite-${Date.now()}.zip`);
    try { await download(ZIP_URL, zip); await applyZip(zip, root); } finally { fs.rmSync(zip, { force: true }); }
  }
  if (hashFile(path.join(root, "package-lock.json")) !== before) await npmInstall(root);
}



const EVERY_MS = 6 * 3600e3;

function register(ctx) {
  let updater = null;
  if (ctx.packaged) {
    try { updater = require("electron-updater").autoUpdater; } catch (e) { console.error("electron-updater missing", e); }
  }
  let asked = false, manual = false; // manual stays false: View › Check for Updates… reports through checkRemote

  if (updater) {
    updater.autoDownload = true;
    updater.on("error", (e) => {
      console.error("update check failed", e?.message || e);
      if (manual) { manual = false; dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: String(e?.message || e) }); }
    });
    updater.on("update-not-available", () => {
      if (manual) { manual = false; dialog.showMessageBox({ type: "info", message: "Tickerkite is up to date", detail: `You have version ${ctx.version}.` }); }
    });
    updater.on("update-downloaded", async (info) => {
      manual = false;
      if (asked) return;
      asked = true;
      const { response } = await dialog.showMessageBox({
        type: "info", buttons: ["Restart Now", "Later"], defaultId: 0, cancelId: 1,
        message: `Tickerkite ${info.version} is ready`, detail: "Restart Tickerkite to finish updating. If you choose Later, it updates the next time you quit."
      });
      if (response === 0) updater.quitAndInstall();
    });
    const check = () => updater.checkForUpdates().catch(() => {});
    setTimeout(check, 15000);
    setInterval(check, EVERY_MS);
  }

  // ---------- "a newer version is on GitHub" button ----------
  const { app, shell } = require("electron");
  let avail = null, busy = false; // avail: { version, current }
  const state = () => ({ available: avail, busy, packaged: !!ctx.packaged });
  const push = () => ctx.send("update:state", state());

  /** Look at package.json on main. quiet: no dialogs. Returns true when a newer version exists. */
  async function checkRemote(quiet = true) {
    try {
      const remote = JSON.parse(await getText(RAW_PKG, { timeoutMs: 15000, headers: { Accept: "application/json" } })).version;
      avail = newer(remote, ctx.version) ? { version: remote, current: ctx.version } : null;
      push();
      if (!quiet) {
        if (avail) await offer();
        else dialog.showMessageBox({ type: "info", message: "Tickerkite is up to date", detail: `You have version ${ctx.version}.` });
      }
      return !!avail;
    } catch (e) {
      console.error("update check failed", e?.message || e);
      if (!quiet) dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: String(e?.message || e) });
      return false;
    }
  }

  async function offer() {
    if (!avail || busy) return;
    if (ctx.packaged) {
      const { response } = await dialog.showMessageBox({
        type: "info", buttons: ["Open GitHub", "Later"], defaultId: 0, cancelId: 1,
        message: `Tickerkite ${avail.version} is available (you have ${avail.current})`,
        detail: "This is an installed app, which can't rewrite itself. Download the new version from GitHub and rebuild it (npm run dist, or npm run update to install it), or reinstall from the new release."
      });
      if (response === 0) shell.openExternal(REPO_URL);
      return;
    }
    const { response } = await dialog.showMessageBox({
      type: "question", buttons: ["Update and Restart", "Later"], defaultId: 0, cancelId: 1,
      message: `Update Tickerkite to ${avail.version}? (you have ${avail.current})`,
      detail: "It downloads the new code, replaces the app's files, and restarts. Your watchlist, notes and settings are kept. Packages are reinstalled only if they changed, which can take a minute."
    });
    if (response !== 0) return;
    busy = true; push();
    try {
      await updateSource();
      app.relaunch(); app.exit(0);
    } catch (e) {
      busy = false; push();
      console.error("update failed", e?.message || e);
      const r = await dialog.showMessageBox({
        type: "error", buttons: ["Open GitHub", "OK"], defaultId: 1, cancelId: 1, message: "Couldn't update Tickerkite",
        detail: `${String(e?.message || e).split("\n")[0]}\n\nNothing is lost. You can update by hand: download the ZIP from GitHub, unzip it, and run npm install then npm start there.`
      });
      if (r.response === 0) shell.openExternal(REPO_URL);
    }
  }
  ctx.ipcMain.handle("update:get", () => state());
  ctx.ipcMain.handle("update:apply", () => offer());
  setTimeout(() => checkRemote(true), 20000);
  setInterval(() => checkRemote(true), EVERY_MS);

  /** View › Check for Updates… */
  return {
    checkNow() {
      checkRemote(false);
      if (updater) { updater.checkForUpdates().catch(() => {}); }
    }
  };
}

module.exports = { register, newer, parseVersion, applyZip, updateSource };
