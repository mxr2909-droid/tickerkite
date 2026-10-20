// Auto-updates through electron-updater: checks the "publish" target in package.json (GitHub Releases)
// at launch and every 6 hours, downloads in the background, and asks once to restart.
// Only a signed, packaged .app can update itself, so development runs skip it.
// Publishing a release: bump "version", then `npm run release` with GH_TOKEN set (see README).
const { dialog } = require("electron");

const EVERY_MS = 6 * 3600e3;

function register(ctx) {
  let updater = null;
  if (ctx.packaged) {
    try { updater = require("electron-updater").autoUpdater; } catch (e) { console.error("electron-updater missing", e); }
  }
  let asked = false, manual = false;

  if (updater) {
    updater.autoDownload = true;
    updater.on("error", (e) => {
      console.error("update check failed", e?.message || e);
      if (manual) { manual = false; dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: String(e?.message || e) }); }
    });
    updater.on("update-not-available", () => {
      if (manual) { manual = false; dialog.showMessageBox({ type: "info", message: "WIRE is up to date", detail: `You have version ${ctx.version}.` }); }
    });
    updater.on("update-downloaded", async (info) => {
      manual = false;
      if (asked) return;
      asked = true;
      const { response } = await dialog.showMessageBox({
        type: "info", buttons: ["Restart Now", "Later"], defaultId: 0, cancelId: 1,
        message: `WIRE ${info.version} is ready`, detail: "Restart WIRE to finish updating. If you choose Later, it updates the next time you quit."
      });
      if (response === 0) updater.quitAndInstall();
    });
    const check = () => updater.checkForUpdates().catch(() => {});
    setTimeout(check, 15000);
    setInterval(check, EVERY_MS);
  }

  /** View › Check for Updates… */
  return {
    checkNow() {
      if (!updater) {
        dialog.showMessageBox({ type: "info", message: "Updates are off in development", detail: "Only the packaged, signed WIRE.app updates itself." });
        return;
      }
      manual = true;
      updater.checkForUpdates().catch(() => {});
    }
  };
}

module.exports = { register };
