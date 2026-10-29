// Graph workspace: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, Notification, showStory, showPage }
//  - IPC channels must start with "graphs:" (the preload only forwards those for this module)
//  - bus emits "news" (stories), "quotes" (quotes), "scores" (scorecard result) after each refresh
//  - get() returns { stories, quotes, watch, scores } right now
//
// Downloads full history for any FRED series (public CSV, no key) or Yahoo symbol, caches each in
// userData/graphs-cache/ for a day, keeps saved charts in graphs.json, and writes exports.
// The chart math (transforms, normalize, clipping, CSV/TSV) lives in renderer/graphs.js.
const fs = require("fs");
const path = require("path");
const { fetchText } = require("./news/fetcher");
const yahoo = require("./data/yahoo");
const { parseFredCsv } = require("./macro/data");
const { INDICATORS, RECESSIONS } = require("./macro/indicators");

const DAY = 864e5;
const SAVES = "graphs.json";

const unhtml = (s = "") => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** Title, units and frequency from a fred.stlouisfed.org/series/ID page. */
function parseFredMeta(html, id) {
  const t = /<title>([^<|]*)/.exec(html);
  const title = t ? unhtml(t[1]).replace(new RegExp(`\\s*\\(${id}\\)\\s*$`), "") : id;
  const grab = (cls) => { const m = new RegExp(`class="series-meta-value-${cls}">([\\s\\S]*?)</span>`).exec(html); return m ? unhtml(m[1]) : ""; };
  return { title: title || id, units: grab("units"), freq: grab("frequency") };
}

/** Normalize user input to a source key: "fred:UNRATE" or "yahoo:^GSPC". Bare IDs with ^ = . or - go to Yahoo. */
function sourceKey(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  const m = /^(fred|yahoo):(.+)$/i.exec(s);
  if (m) return `${m[1].toLowerCase()}:${m[2].trim().toUpperCase()}`;
  const u = s.toUpperCase();
  return /[\^=.\-]/.test(u) ? `yahoo:${u}` : `fred:${u}`;
}

async function loadFred(id) {
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, 30000);
  const points = parseFredCsv(csv);
  if (!points.length) throw new Error(`no FRED data for ${id}`);
  let meta = { title: id, units: "", freq: "" };
  try { meta = parseFredMeta(await fetchText(`https://fred.stlouisfed.org/series/${encodeURIComponent(id)}`, 15000), id); } catch {}
  return { ...meta, points };
}

async function loadYahoo(sym) {
  const { meta, points } = await yahoo.dailyCloses(sym, -1500000000, 30000); // range=max returns monthly bars
  return { title: meta.longName || meta.shortName || sym, units: meta.currency || "", freq: "Daily", points };
}

function register(ctx) {
  const { ipcMain, file, readJSON, writeJSON, get } = ctx;
  const cacheDir = file("graphs-cache");
  const cachePath = (key) => path.join(cacheDir, key.replace(/[^A-Za-z0-9_.-]/g, "_") + ".json");
  const inflight = new Map();
  module.exports.loadSeries = (key) => series(key); // shared with the risk monitors (src/monitors.js)

  async function series(input) {
    const key = sourceKey(input);
    if (!key) throw new Error("enter a FRED ID or a symbol");
    // a bare name like "NVDA" or "UNRATE" could be either: try FRED, then fall back to a market ticker
    if (!/^(fred|yahoo):/i.test(String(input).trim()) && key.startsWith("fred:")) {
      try { return await load(key); }
      catch (e) {
        try { return await load("yahoo:" + key.slice(5)); }
        catch { throw new Error(`"${key.slice(5)}" isn't a FRED series or a ticker`); }
      }
    }
    return load(key);
  }

  async function load(key) {
    const p = cachePath(key);
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    if (cached && Date.now() - cached.at < DAY) return cached;
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      try {
        const d = { key, ...(kind === "fred" ? await loadFred(id) : await loadYahoo(id)), at: Date.now() };
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(p, JSON.stringify(d));
        return d;
      } catch (e) {
        if (cached) return { ...cached, stale: true }; // offline: last copy beats nothing
        throw e;
      } finally { inflight.delete(key); }
    })();
    inflight.set(key, job);
    return job;
  }

  const saves = () => readJSON(SAVES, { graphs: [] }).graphs || [];
  const downloads = () => require("electron").app.getPath("downloads");
  function freeName(base, ext) {
    const stem = "Tickerkite " + (String(base || "graph").replace(/[^\w .()-]+/g, "").trim().slice(0, 60) || "graph");
    let f = path.join(downloads(), `${stem}.${ext}`);
    for (let i = 2; fs.existsSync(f); i++) f = path.join(downloads(), `${stem} (${i}).${ext}`);
    return f;
  }

  ipcMain.handle("graphs:series", async (_e, key) => {
    try { return await series(key); } catch (e) { return { error: String(e.message || e) }; }
  });
  ipcMain.handle("graphs:recessions", async () => {
    try { return (await series(RECESSIONS)).points; } catch { return []; }
  });
  ipcMain.handle("graphs:picks", () => ({
    indicators: INDICATORS.map((x) => ({ src: x.src, name: x.name, section: x.section })),
    watch: (get().watch || []).map((w) => ({ src: "yahoo:" + w.sym, name: w.name || w.sym }))
  }));
  ipcMain.handle("graphs:list", () => saves());
  ipcMain.handle("graphs:save", (_e, name, spec) => {
    name = String(name || "").trim().slice(0, 80);
    if (!name) return saves();
    const list = saves().filter((g) => g.name !== name);
    list.unshift({ name, savedAt: Date.now(), spec });
    writeJSON(SAVES, { graphs: list });
    return list;
  });
  ipcMain.handle("graphs:delete", (_e, name) => {
    const list = saves().filter((g) => g.name !== name);
    writeJSON(SAVES, { graphs: list });
    return list;
  });
  ipcMain.handle("graphs:csv", (_e, name, text) => {
    const f = freeName(name, "csv");
    fs.writeFileSync(f, String(text));
    return f;
  });
  ipcMain.handle("graphs:png", async (e, name, r) => {
    const rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    const img = await e.sender.capturePage(rect);
    const f = freeName(name, "png");
    fs.writeFileSync(f, img.toPNG());
    return f;
  });
  ipcMain.handle("graphs:copy", (_e, text) => { require("electron").clipboard.writeText(String(text)); return true; });
  ipcMain.handle("graphs:reveal", (_e, f) => { if (typeof f === "string" && f.startsWith(downloads())) require("electron").shell.showItemInFolder(f); });
}

module.exports = { register, parseFredMeta, sourceKey };
