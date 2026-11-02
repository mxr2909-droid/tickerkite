const { app, BrowserWindow, ipcMain, shell, Menu, Notification: NativeNotification, nativeTheme, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const DEFAULT_FEEDS = require("./news/feeds");
const { fetchAll } = require("./news/fetcher");
const { rank } = require("./news/rank");
const quotes = require("./quotes");
const { fetchQuotes, fetchHistory } = quotes;
const instruments = require("./instruments");
const { relevantLive, attributeIntraday, attributeHistory } = instruments;
const WL = require("./watchlist");
const company = require("./company");
const license = require("./license");
const settings = require("./settings");
const updater = require("./updater");
const EventEmitter = require("events");
const PAGE_MODULES = {
  calendar: require("./calendar"), markets: require("./markets"), 
  fed: require("./fed"), graphs: require("./graphs"), recession: require("./recession"),
  board: require("./board"), releases: require("./releases"), portfolio: require("./portfolio"), brief: require("./brief"),
  companypage: require("./companypage"), curve: require("./curve"), command: require("./command"), factor: require("./factor"), monitors: require("./monitors"), screen: require("./screen")
};
const bus = new EventEmitter(); // "news" | "quotes" | "scores" after each refresh, for page modules
const { INDICATORS, SECTIONS, RECESSIONS } = require("./macro/indicators");
const { fetchAllSeries } = require("./macro/data");
const SC = require("./macro/score");
const DEFAULT_WEIGHTS = require("./macro/weights");

const NEWS_EVERY_MS = 2 * 60 * 1000;
const QUOTES_EVERY_MS = 60 * 1000;
const MACRO_MAX_AGE_MS = 6 * 3600 * 1000; // economic data changes at most daily
const MAX_ITEMS = 4000;

let win = null;
let widget = null;
let quitting = false;
let lic = null; // license.register() result: { status() }
let upd = null; // updater.register() result: { checkNow() }
const locked = () => !!lic?.status().locked;
let prefs = { alerts: true, watchAlerts: true, releaseAlerts: true, widget: { open: false, onTop: false, bounds: null } };
const userDir = () => app.getPath("userData");

// The app was called WIRE before 1.0. On the first Tickerkite launch, copy the old data folder
// (watchlist, portfolio, settings, caches, saved view state) so nothing is lost. The old folder stays.
(function migrateFromWire() {
  try {
    const appData = app.getPath("appData");
    const from = path.join(appData, "WIRE"), to = path.join(appData, "Tickerkite");
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
  } catch (e) { console.error("couldn't copy the WIRE data folder", e); }
})();
const file = (n) => path.join(userDir(), n);

const state = {
  stories: [],
  status: [],
  quotes: [],
  pulledAt: 0,
  refreshing: false,
  alerts: true,
  seen: new Set(),
  watch: [], // your tickers: [{ sym, name, terms }]
  watchAlerts: true,
  items: [] // raw items kept across refreshes so stories survive a feed hiccup
};

// ---------- persistence ----------
function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch { return fallback; }
}
function writeJSON(name, data) {
  try { fs.mkdirSync(userDir(), { recursive: true }); fs.writeFileSync(file(name), JSON.stringify(data)); } catch (e) { console.error(e); }
}
function loadFeeds() {
  const f = file("feeds.json");
  if (!fs.existsSync(f)) {
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(DEFAULT_FEEDS, null, 2));
    return DEFAULT_FEEDS;
  }
  const feeds = readJSON("feeds.json", DEFAULT_FEEDS);
  return Array.isArray(feeds) && feeds.length ? feeds.filter((x) => x && x.url && x.enabled !== false) : DEFAULT_FEEDS;
}

function savePrefs() {
  prefs.alerts = state.alerts;
  prefs.watchAlerts = state.watchAlerts;
  writeJSON("prefs.json", prefs);
}

// ---------- watchlist ----------
function loadWatch() {
  setWatch(WL.sanitize(readJSON("watchlist.json", [])), { save: false });
}
/** Replace the watchlist everywhere: quotes, chart matching, story tags. */
function setWatch(list, { save = true } = {}) {
  state.watch = WL.sanitize(list);
  if (save) { writingWatch = Date.now(); writeJSON("watchlist.json", state.watch); }
  quotes.setWatch(state.watch);
  instruments.setWatch(state.watch);
  state.stories = WL.tagStories(state.stories, state.watch);
}
async function addWatch(raw) {
  const sym = WL.normalizeSymbol(raw);
  if (!sym) return { ok: false, error: "Type a ticker, like NVDA or BRK-B." };
  if (state.watch.some((e) => e.sym === sym)) return { ok: false, error: `${sym} is already on your watchlist.` };
  try {
    const info = await quotes.lookupSymbol(sym);
    const entry = { sym: WL.normalizeSymbol(info.sym), name: info.name, terms: WL.defaultTerms(WL.normalizeSymbol(info.sym), info.name) };
    if (state.watch.some((e) => e.sym === entry.sym)) return { ok: false, error: `${entry.sym} is already on your watchlist.` };
    setWatch([...state.watch, entry]);
    send("news:update", snapshot());
    refreshQuotes();
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
function removeWatch(sym) {
  setWatch(state.watch.filter((e) => e.sym !== sym));
  send("news:update", snapshot());
  refreshQuotes();
}
// pick up edits made to watchlist.json by hand (View › Edit Watchlist…)
let writingWatch = 0;
function watchFile() {
  const f = file("watchlist.json");
  if (!fs.existsSync(f)) writeJSON("watchlist.json", state.watch);
  let t = null;
  try {
    fs.watch(f, () => {
      if (Date.now() - writingWatch < 1000) return; // our own save
      clearTimeout(t);
      t = setTimeout(() => { loadWatch(); send("news:update", snapshot()); refreshQuotes(); }, 300);
    });
  } catch (e) { console.error("can't watch watchlist.json", e); }
}
const rankAll = (items) => WL.tagStories(rank(items), state.watch);

// ---------- scorecards ----------
const macro = { series: {}, errors: {}, fetchedAt: 0, refreshing: false, result: null, error: null };

function loadWeights() {
  const f = file("scorecard-weights.json");
  if (!fs.existsSync(f)) {
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(DEFAULT_WEIGHTS, null, 2));
  }
  // a file that doesn't parse falls back to the defaults
  return SC.mergeWeights(DEFAULT_WEIGHTS, readJSON("scorecard-weights.json", {}));
}

function computeScores() {
  if (!Object.keys(macro.series).length) return;
  try {
    macro.result = SC.scorecard(INDICATORS, macro.series, loadWeights());
    bus.emit("scores", macro.result);
    macro.error = null;
  } catch (e) {
    console.error("scorecard failed", e);
    macro.error = String(e.message || e);
  }
}

async function refreshMacro(force = false) {
  if (macro.refreshing) return;
  if (!force && Date.now() - macro.fetchedAt < MACRO_MAX_AGE_MS) return;
  macro.refreshing = true;
  send("score:update", scoreSnapshot());
  try {
    const r = await fetchAllSeries(macro.series);
    macro.series = r.series; macro.errors = r.errors; macro.fetchedAt = r.fetchedAt;
    writeJSON("macro-cache.json", { series: macro.series, errors: macro.errors, fetchedAt: macro.fetchedAt });
    pushHealth();
    computeScores();
  } catch (e) {
    console.error("macro refresh failed", e);
    macro.error = String(e.message || e);
  } finally {
    macro.refreshing = false;
    send("score:update", scoreSnapshot());
  }
}

/** Everything the scorecard view needs, minus the full series (fetched one at a time for charts). */
function scoreSnapshot() {
  const r = macro.result;
  return {
    fetchedAt: macro.fetchedAt, refreshing: macro.refreshing, error: macro.error,
    failed: Object.keys(macro.errors).length,
    sections: SECTIONS, assets: SC.ASSETS,
    defs: INDICATORS.map(({ id, section, name, unit, dec, desc, factor, sign, src, freq, good }) => ({ id, section, name, unit, dec, desc, factor, sign, src, freq, good })),
    ind: r?.ind || {}, scores: r?.assets || {}, regime: r?.regime || null, mode: r?.mode || null, history: r?.history || []
  };
}

/** One indicator's history for its chart: thinned to about 700 points, plus recession periods. */
function scoreSeries(id) {
  const s = macro.result?.prepared?.[id];
  if (!s) return { ok: false, error: "No data for this indicator yet." };
  const step = Math.max(1, Math.ceil(s.length / 700));
  const pts = s.filter((_, i) => i % step === 0 || i === s.length - 1);
  const rec = [];
  let open = null;
  for (const [t, v] of macro.series[RECESSIONS] || []) {
    if (v === 1 && open == null) open = t;
    if (v !== 1 && open != null) { rec.push([open, t]); open = null; }
  }
  if (open != null) rec.push([open, Date.now()]);
  return { ok: true, points: pts, recessions: rec };
}

let writingWeights = 0;
function watchWeights() {
  loadWeights();
  let t = null;
  try {
    fs.watch(file("scorecard-weights.json"), () => {
      if (Date.now() - writingWeights < 1000) return;
      clearTimeout(t);
      t = setTimeout(() => { computeScores(); send("score:update", scoreSnapshot()); }, 300);
    });
  } catch (e) { console.error("can't watch scorecard-weights.json", e); }
}
function resetWeights() {
  writingWeights = Date.now();
  fs.writeFileSync(file("scorecard-weights.json"), JSON.stringify(DEFAULT_WEIGHTS, null, 2));
  computeScores();
  send("score:update", scoreSnapshot());
}

// ---------- alerts inbox: every notification is also kept in a list (src/inbox.js) ----------
const inbox = require("./inbox").create({ readJSON: (...a) => readJSON(...a), writeJSON: (...a) => writeJSON(...a), send: (...a) => send(...a) });
const Notification = inbox.wrap(NativeNotification);
ipcMain.handle("inbox:get", () => inbox.snapshot());
ipcMain.handle("inbox:read", (_e, ids) => { inbox.markRead(Array.isArray(ids) ? ids.map(String) : null); return true; });
ipcMain.handle("inbox:clear", () => { inbox.clear(); return true; });

// ---------- data health: is each source fresh and loading? ----------
// main.js measures news, quotes and the scorecard data itself; page modules report the rest through
// ctx.reportHealth(id, { label, level: "ok"|"warn"|"bad", at, detail }).
const reported = {};
const ago = (t) => { if (!t) return "never"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
function healthSnapshot() {
  const rows = [];
  const feeds = state.status || [], live = feeds.filter((f) => f.ok).length, newsAge = Date.now() - (state.pulledAt || 0);
  rows.push({ id: "news", label: "News feeds", at: state.pulledAt,
    // one dead feed out of many isn't worth an alarm: amber below 80% live (failures are still listed)
    level: !feeds.length || live === 0 || newsAge > 30 * 60e3 ? "bad" : live < 0.8 * feeds.length || newsAge > 10 * 60e3 ? "warn" : "ok",
    detail: feeds.length ? `${live} of ${feeds.length} feeds live${live < feeds.length ? ` · failing: ${feeds.filter((f) => !f.ok).map((f) => f.name).join(", ")}` : ""}` : "not pulled yet" });
  const qs = state.quotes || [], missing = qs.filter((q) => q.last == null).length, qAge = Date.now() - (state.quotesAt || 0);
  rows.push({ id: "quotes", label: "Market quotes (Yahoo)", at: state.quotesAt,
    level: !qs.length || missing === qs.length || qAge > 15 * 60e3 ? "bad" : missing > qs.length / 4 || qAge > 5 * 60e3 ? "warn" : "ok",
    detail: qs.length ? `${qs.length - missing} of ${qs.length} prices${missing ? ` · missing: ${qs.filter((q) => q.last == null).map((q) => q.label).slice(0, 6).join(", ")}` : ""}` : "not loaded yet" });
  const mErr = Object.keys(macro.errors || {}), mAge = Date.now() - (macro.fetchedAt || 0);
  rows.push({ id: "macro", label: "Economic data (FRED + Yahoo)", at: macro.fetchedAt,
    level: !macro.fetchedAt || mAge > 48 * 3600e3 ? "bad" : mErr.length || mAge > 12 * 3600e3 ? "warn" : "ok",
    detail: macro.fetchedAt ? `${mErr.length ? `${mErr.length} series failed, using the last good copy: ${mErr.slice(0, 5).map((k) => k.replace(/^\w+:/, "")).join(", ")}` : "all series loaded"}` : "not downloaded yet" });
  for (const r of Object.values(reported)) rows.push(r);
  const worst = rows.some((r) => r.level === "bad") ? "bad" : rows.some((r) => r.level === "warn") ? "warn" : "ok";
  return { level: worst, rows: rows.map((r) => ({ ...r, ago: ago(r.at) })), at: Date.now() };
}
let healthTimer = null;
function pushHealth() { clearTimeout(healthTimer); healthTimer = setTimeout(() => send("health:update", healthSnapshot()), 250); }
function reportHealth(id, info) { reported[id] = { ...reported[id], ...info, id }; pushHealth(); }

// ---------- data ----------
// every open window (main + widget) gets the same updates
function send(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
function snapshot() {
  return { stories: state.stories, status: state.status, pulledAt: state.pulledAt, refreshing: state.refreshing, alerts: state.alerts, watch: state.watch };
}

async function refreshNews() {
  if (state.refreshing) return;
  state.refreshing = true;
  send("news:update", snapshot());
  try {
    const { items, status } = await fetchAll(loadFeeds());
    const cutoff = Date.now() - 72 * 3600e3;
    const byLink = new Map(state.items.filter((i) => i.ts > cutoff).map((i) => [i.link, i]));
    for (const i of items) byLink.set(i.link, i);
    state.items = [...byLink.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS);
    state.stories = rankAll(state.items);
    state.status = status;
    state.pulledAt = Date.now();
    notifyNew();
    bus.emit("news", state.stories);
    pushHealth();
    writeJSON("cache.json", { items: state.items, status, pulledAt: state.pulledAt, seen: [...state.seen].slice(-3000) });
  } catch (e) {
    console.error("refresh failed", e);
  } finally {
    state.refreshing = false;
    send("news:update", snapshot());
  }
}

function notifyNew() {
  const firstRun = state.seen.size === 0;
  const fresh = state.stories.filter((s) => !state.seen.has(s.id));
  for (const s of state.stories) state.seen.add(s.id);
  if (firstRun || !Notification.isSupported() || locked()) return;
  const recent = fresh.filter((s) => s.kind === "news" && Date.now() - s.updated < 3 * 3600e3);
  // your tickers first: any story that mentions one, whatever its impact score
  const mine = state.watchAlerts ? recent.filter((s) => s.watch?.length).slice(0, 3) : [];
  const hot = state.alerts ? recent.filter((s) => s.sev === "h" && !mine.includes(s)).slice(0, 3) : [];
  for (const s of [...mine, ...hot]) {
    const title = s.watch?.length && mine.includes(s) ? `★ ${s.watch.join(" ")} · ${s.code}` : `${s.code} · ${s.signal}`;
    const n = new Notification({ title, subtitle: s.region, body: s.title, silent: false, tk: { kind: s.watch?.length && mine.includes(s) ? "watchlist" : "news", story: s.id } });
    n.on("click", () => showStory(s.id));
    n.show();
  }
}

async function refreshQuotes() {
  try {
    state.quotes = await fetchQuotes();
    state.quotesAt = Date.now();
    bus.emit("quotes", state.quotes);
    pushHealth();
    send("quotes:update", state.quotes);
  } catch (e) { console.error("quotes failed", e); }
}

// ---------- window ----------
// Fit the main window to the screen it opens on (never taller than the visible area),
// or restore the size and place you last left it.
function mainBounds() {
  const saved = prefs.main;
  if (saved && onScreen(saved)) {
    const wa = screen.getDisplayMatching(saved).workArea;
    return { ...saved, width: Math.min(saved.width, wa.width), height: Math.min(saved.height, wa.height) };
  }
  // first launch: fill the visible screen (menu bar and Dock excluded)
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
}

/** Resize the main window to exactly the visible screen area it is on. */
function fitToScreen() {
  if (!win) return;
  if (win.isFullScreen()) return;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height }, true);
}

/** If the window hangs off the screen (resolution change, external monitor unplugged), pull it back in. */
function keepOnScreen() {
  if (!win || win.isFullScreen()) return;
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const width = Math.min(b.width, wa.width), height = Math.min(b.height, wa.height);
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height);
  if (x !== b.x || y !== b.y || width !== b.width || height !== b.height) win.setBounds({ x, y, width, height });
}

function createWindow() {
  win = new BrowserWindow({
    ...mainBounds(),
    minWidth: 900,
    minHeight: 560,
    title: "Tickerkite",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
  // every link opens in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) { e.preventDefault(); openExternal(url); } });
  if (process.argv.includes("--dev")) win.webContents.openDevTools({ mode: "detach" });
  let bt = null;
  const rememberMain = () => { clearTimeout(bt); bt = setTimeout(() => { if (win && !win.isDestroyed() && !win.isFullScreen() && !win.isMinimized()) { prefs.main = win.getBounds(); savePrefs(); } }, 400); };
  win.once("ready-to-show", keepOnScreen);
  win.on("resize", rememberMain);
  win.on("move", rememberMain);
  win.on("closed", () => { win = null; });
}

// ---------- pop-out windows: any page in its own window ----------
const popouts = new Set(); // BrowserWindows showing one page each (index.html?page=<p>&solo=1)
const appWindows = () => [win, ...popouts].filter((w) => w && !w.isDestroyed());

function savePopouts() {
  if (quitting) return;
  prefs.popouts = [...popouts].filter((w) => !w.isDestroyed()).map((w) => ({ page: w.tkPage, bounds: w.getBounds() }));
  savePrefs();
}
function createPopout(page, bounds) {
  page = String(page || "news").replace(/[^a-z]/g, "");
  const wa = screen.getDisplayMatching(win ? win.getBounds() : screen.getPrimaryDisplay().bounds).workArea;
  const b = bounds && onScreen(bounds) ? bounds : { width: Math.min(1100, wa.width), height: Math.min(760, wa.height), x: wa.x + 60 + popouts.size * 30, y: wa.y + 40 + popouts.size * 30 };
  const w = new BrowserWindow({
    ...b, minWidth: MIN_W, minHeight: MIN_H, title: "Tickerkite", titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#0a0c10", show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  w.tkPage = page;
  w.loadFile(path.join(__dirname, "..", "renderer", "index.html"), { query: { page, solo: "1" } });
  w.once("ready-to-show", () => w.show());
  w.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  w.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) { e.preventDefault(); openExternal(url); } });
  let t = null;
  const remember = () => { clearTimeout(t); t = setTimeout(savePopouts, 400); };
  w.on("move", remember); w.on("resize", remember);
  w.on("closed", () => { popouts.delete(w); savePopouts(); });
  popouts.add(w);
  savePopouts();
  return w;
}
/** Menu page shortcuts act on the window you're in (main or a pop-out), never on all of them. */
function setPageInFocused(p) {
  const f = BrowserWindow.getFocusedWindow();
  if (f && popouts.has(f)) { f.tkPage = p; savePopouts(); f.webContents.send("page:set", p); return; }
  showStory(null);
  win?.webContents.send("page:set", p);
}
/**
 * Arrange the main window and every pop-out on the main window's screen: a grid when each window
 * still gets its minimum size (an external monitor), otherwise a neat cascade (a laptop screen).
 */
const MIN_W = 900, MIN_H = 560;
function tileWindows() {
  const ws = appWindows();
  if (!ws.length) return;
  const wa = screen.getDisplayMatching(ws[0].getBounds()).workArea;
  for (const w of ws) { if (w.isFullScreen()) w.setFullScreen(false); if (w.isMinimized()) w.restore(); }
  const cols = Math.max(1, Math.min(ws.length, Math.floor(wa.width / MIN_W)));
  const rows = Math.ceil(ws.length / cols);
  if (wa.height / rows < MIN_H) {
    const step = 34, w0 = Math.max(MIN_W, Math.round(wa.width * 0.72)), h0 = Math.max(MIN_H, Math.round(wa.height * 0.8));
    ws.forEach((w, i) => w.setBounds({ x: wa.x + Math.min(i * step, wa.width - w0), y: wa.y + Math.min(i * step, wa.height - h0), width: w0, height: h0 }));
    ws.forEach((w) => w.moveTop());
    return;
  }
  ws.forEach((w, i) => {
    const r = Math.floor(i / cols), inRow = r === rows - 1 ? ws.length - r * cols : cols;
    const cw = Math.floor(wa.width / inRow), rh = Math.floor(wa.height / rows);
    w.setBounds({ x: wa.x + (i % cols) * cw, y: wa.y + r * rh, width: cw, height: rh });
  });
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

/** Bring up the main window (creating it if it was closed) with a story selected. */
function showStory(id) {
  if (!win) {
    createWindow();
    if (id) win.webContents.once("did-finish-load", () => setTimeout(() => win?.webContents.send("news:select", id), 300));
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (id) win.webContents.send("news:select", id);
}

// ---------- floating widget ----------
function defaultWidgetBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 360, h = 470;
  // top-left of the desktop, clear of the icons macOS lines up on the right
  return { width: w, height: h, x: wa.x + 24, y: wa.y + 24 };
}
function onScreen(b) {
  return b && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40;
  });
}

function createWidget() {
  if (widget) { widget.show(); return; }
  if (locked()) { showStory(null); return; } // the main window shows why
  const b = onScreen(prefs.widget.bounds) ? prefs.widget.bounds : defaultWidgetBounds();
  widget = new BrowserWindow({
    ...b,
    minWidth: 280,
    minHeight: 260,
    maxWidth: 640,
    frame: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    vibrancy: "hud",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    show: false,
    title: "Tickerkite Widget",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  applyOnTop();
  widget.loadFile(path.join(__dirname, "..", "renderer", "widget.html"));
  widget.once("ready-to-show", () => widget.showInactive());
  widget.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  widget.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) { e.preventDefault(); openExternal(url); } });

  let t = null;
  const remember = () => { clearTimeout(t); t = setTimeout(() => { if (widget) { prefs.widget.bounds = widget.getBounds(); savePrefs(); } }, 400); };
  widget.on("move", remember);
  widget.on("resize", remember);
  widget.on("closed", () => {
    widget = null;
    if (!quitting) { prefs.widget.open = false; savePrefs(); updateMenu(); }
  });

  prefs.widget.open = true;
  savePrefs();
  updateMenu();
}

function closeWidget() {
  prefs.widget.open = false;
  savePrefs();
  if (widget) widget.close();
}
function toggleWidget() { widget ? closeWidget() : createWidget(); }

function applyOnTop() {
  if (!widget) return;
  if (prefs.widget.onTop) {
    widget.setAlwaysOnTop(true, "floating");
    widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    widget.setAlwaysOnTop(false);
    widget.setVisibleOnAllWorkspaces(false);
  }
  widget.webContents.send("widget:ontop", prefs.widget.onTop);
}
function setOnTop(v) {
  prefs.widget.onTop = !!v;
  savePrefs();
  applyOnTop();
  updateMenu();
}

function updateMenu() { buildMenu(); }

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => { showStory(null); send("settings:open", "settings"); } },
        { label: "Check for Updates…", click: () => upd?.checkNow() },
        { type: "separator" },
        { label: "License Agreement", click: () => { showStory(null); send("settings:open", "terms"); } },
        { label: "Privacy Policy", click: () => { showStory(null); send("settings:open", "privacy"); } },
        { label: "Data Sources", click: () => { showStory(null); send("settings:open", "sources"); } },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Brief", accelerator: "CmdOrCtrl+Alt+0", click: () => setPageInFocused("brief") },
        { label: "News", accelerator: "CmdOrCtrl+Alt+1", click: () => setPageInFocused("news") },
        { label: "Scorecards", accelerator: "CmdOrCtrl+Alt+2", click: () => setPageInFocused("score") },
        { label: "Calendar", accelerator: "CmdOrCtrl+Alt+3", click: () => setPageInFocused("calendar") },
        { label: "Markets", accelerator: "CmdOrCtrl+Alt+4", click: () => setPageInFocused("markets") },
        { label: "Fed", accelerator: "CmdOrCtrl+Alt+5", click: () => setPageInFocused("fed") },
        { label: "Graphs", accelerator: "CmdOrCtrl+Alt+6", click: () => setPageInFocused("graphs") },
        { label: "Portfolio", accelerator: "CmdOrCtrl+Alt+7", click: () => setPageInFocused("portfolio") },
        { label: "Yield Curve", accelerator: "CmdOrCtrl+Alt+8", click: () => setPageInFocused("curve") },
        { label: "Factor Probabilities", accelerator: "CmdOrCtrl+Alt+R", click: () => setPageInFocused("factor") },
        { label: "Warning History", accelerator: "CmdOrCtrl+Alt+W", click: () => setPageInFocused("warn") },
        { label: "Stock Screener", accelerator: "CmdOrCtrl+Alt+S", click: () => setPageInFocused("screen") },
        { label: "Company", accelerator: "CmdOrCtrl+Alt+9", click: () => setPageInFocused("company") },
        { label: "Go To…", accelerator: "CmdOrCtrl+K", click: () => { showStory(null); send("cmd:open"); } },
        { type: "separator" },
        { label: "Show Main Window", accelerator: "CmdOrCtrl+1", click: () => showStory(null) },
        { label: "Fit Window to Screen", accelerator: "CmdOrCtrl+Alt+F", click: () => { showStory(null); fitToScreen(); } },
        { label: "Switch Theme (Terminal / Classic)", accelerator: "CmdOrCtrl+Alt+T", click: () => { showStory(null); send("theme:toggle"); } },
        { label: "Floating Widget", type: "checkbox", accelerator: "CmdOrCtrl+Shift+W", checked: !!widget, click: () => toggleWidget() },
        { label: "Pin Widget Above Other Windows", type: "checkbox", checked: prefs.widget.onTop, click: (item) => setOnTop(item.checked) },
        { type: "separator" },
        { label: "Refresh News", accelerator: "CmdOrCtrl+R", click: () => { refreshNews(); refreshQuotes(); } },
        { type: "separator" },
        { label: "Alerts for High-Impact Headlines", type: "checkbox", checked: state.alerts,
          click: (item) => { state.alerts = item.checked; savePrefs(); send("news:update", snapshot()); } },
        { label: "Alerts for Watchlist Headlines", type: "checkbox", checked: state.watchAlerts,
          click: (item) => { state.watchAlerts = item.checked; savePrefs(); } },
        { label: "Alerts for Data Releases", type: "checkbox", checked: prefs.releaseAlerts !== false,
          click: (item) => { prefs.releaseAlerts = item.checked; savePrefs(); } },
        { label: "Edit Watchlist…", click: () => { if (!fs.existsSync(file("watchlist.json"))) writeJSON("watchlist.json", state.watch); shell.openPath(file("watchlist.json")); } },
        { label: "Edit Feeds…", click: () => { loadFeeds(); shell.openPath(file("feeds.json")); } },
        { label: "Refresh Economic Data", click: () => refreshMacro(true) },
        { label: "Edit Scorecard Weights…", click: () => { loadWeights(); shell.openPath(file("scorecard-weights.json")); } },
        { label: "Reset Scorecard Weights to Defaults", click: resetWeights },
        { label: "Reset Feeds to Defaults", click: () => { fs.writeFileSync(file("feeds.json"), JSON.stringify(DEFAULT_FEEDS, null, 2)); refreshNews(); } },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" },
        { type: "separator" },
        { role: "toggleDevTools" }
      ]
    },
    {
      role: "windowMenu",
      submenu: [
        { label: "Pop Out Current Page", accelerator: "CmdOrCtrl+Shift+N", click: () => { const f = BrowserWindow.getFocusedWindow(); (f && appWindows().includes(f) ? f : win)?.webContents.send("popout:current"); } },
        { label: "Tile Windows", accelerator: "CmdOrCtrl+Alt+T", click: tileWindows },
        { type: "separator" },
        { role: "minimize" }, { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
ipcMain.handle("news:get", () => snapshot());
ipcMain.handle("quotes:get", () => state.quotes);
ipcMain.handle("news:refresh", () => { refreshNews(); refreshQuotes(); return true; });
ipcMain.handle("open-external", (_e, url) => { openExternal(String(url)); return true; });
ipcMain.handle("widget:toggle", () => { toggleWidget(); return !!widget; });
ipcMain.handle("widget:close", () => { closeWidget(); return true; });
ipcMain.handle("widget:ontop", (_e, v) => { setOnTop(v); return prefs.widget.onTop; });
ipcMain.handle("widget:state", () => ({ open: !!widget, onTop: prefs.widget.onTop }));
ipcMain.handle("watch:add", (_e, sym) => addWatch(String(sym || "")));
ipcMain.handle("watch:remove", (_e, sym) => { removeWatch(String(sym || "")); return true; });
ipcMain.handle("score:get", () => scoreSnapshot());
ipcMain.handle("health:get", () => healthSnapshot());
ipcMain.handle("score:series", (_e, id) => scoreSeries(String(id)));
ipcMain.handle("score:refresh", () => { refreshMacro(true); return true; });
ipcMain.handle("window:popout", (_e, page) => { createPopout(String(page || "")); return true; });
// a pop-out that switches page remembers the new one for next launch
ipcMain.on("window:page", (e, p) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && popouts.has(w)) { w.tkPage = String(p || "news"); savePopouts(); } });
ipcMain.handle("window:tile", () => { tileWindows(); return true; });
ipcMain.handle("show-story", (_e, id) => { showStory(id ? String(id) : null); return true; });

// ---------- instrument view ----------
ipcMain.handle("instrument:get", async (_e, sym, rangeKey, force) => {
  try {
    const d = await fetchHistory(String(sym), String(rangeKey), { force: !!force });
    // the analytics config carries no functions, so the whole object can cross IPC
    return { ok: true, data: d };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle("instrument:news", async (_e, sym, rangeKey) => {
  try {
    const d = await fetchHistory(String(sym), String(rangeKey));
    const kind = d.cfg.kind;
    const since = d.points.length ? d.points[0].t - 6 * 3600e3 : Date.now() - 24 * 3600e3;
    const live = relevantLive(state.stories, d.sym, since, kind === "intra" ? 8 : 6);
    const moves = kind === "intra"
      ? attributeIntraday(state.stories, d.sym, d.moves)
      : await attributeHistory(d.sym, d.label, d.moves, kind);
    return { ok: true, live, moves, liveWindowHours: Math.round((Date.now() - since) / 3600e3) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// ---------- company panel (watchlist stocks) ----------
const companyStore = { read: readJSON, write: writeJSON };
ipcMain.handle("company:get", async (_e, sym, force) => {
  sym = String(sym || "");
  const watch = state.watch.some((e) => e.sym === sym);
  if (!watch) return { ok: true, watch: false };
  try {
    return { ok: true, watch, data: await company.fetchCompany(sym, { store: companyStore, contact: prefs.secContact, force: !!force }) };
  } catch (e) {
    return { ok: false, watch, error: String(e.message || e) };
  }
});
ipcMain.handle("company:contact", (_e, contact) => {
  const c = String(contact || "").trim().slice(0, 120);
  if (!/\S+@\S+\.\S+/.test(c)) return { ok: false, error: "Enter an email address." };
  prefs.secContact = c;
  savePrefs();
  return { ok: true };
});

ipcMain.handle("show-instrument", (_e, sym) => {
  showStory(null);
  const go = () => win?.webContents.send("inst:open", String(sym));
  if (win?.webContents.isLoading()) win.webContents.once("did-finish-load", () => setTimeout(go, 300)); else go();
  return true;
});

// ---------- lifecycle ----------
app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  const saved = readJSON("prefs.json", {});
  prefs = { ...prefs, ...saved, widget: { ...prefs.widget, ...(saved.widget || {}) } };
  state.alerts = prefs.alerts !== false;
  state.watchAlerts = prefs.watchAlerts !== false;
  loadWatch();
  const cache = readJSON("cache.json", null);
  if (cache?.items?.length) {
    state.items = cache.items;
    state.stories = rankAll(state.items);
    state.status = cache.status || [];
    state.pulledAt = cache.pulledAt || 0;
    state.seen = new Set(cache.seen || []);
  }
  watchFile();
  app.setAboutPanelOptions({ applicationName: "Tickerkite", applicationVersion: require("../package.json").version, copyright: "Market data is delayed and for information only. Not investment advice." });
  const ctx = {
    ipcMain, send, file, readJSON, writeJSON, bus, Notification, showStory, openExternal, savePrefs,
    packaged: app.isPackaged, version: require("../package.json").version,
    setKeys: quotes.setKeys, refreshQuotes,
    license: () => lic?.status() || null,
    checkUpdates: () => upd?.checkNow(),
    onChange: () => { if (locked() && widget) closeWidget(); },
    expose: {}, // getters modules publish for each other (calendarToday, releases, portfolio, …)
    prefs: () => prefs,
    showPage: (p) => { showStory(null); win?.webContents.send("page:set", p); },
    get: () => ({ stories: state.stories, quotes: state.quotes, watch: state.watch, scores: macro.result }),
    reportHealth
  };
  lic = license.register(ctx);
  upd = updater.register(ctx);
  settings.register(ctx);
  for (const m of Object.values(PAGE_MODULES)) m.register(ctx);
  const mc = readJSON("macro-cache.json", null);
  if (mc?.series) { macro.series = mc.series; macro.errors = mc.errors || {}; macro.fetchedAt = mc.fetchedAt || 0; computeScores(); }
  watchWeights();
  buildMenu();
  createWindow();
  if (prefs.widget.open) createWidget();
  for (const p of Array.isArray(prefs.popouts) ? prefs.popouts.slice(0, 8) : []) createPopout(p.page, p.bounds);
  refreshNews();
  refreshQuotes();
  setInterval(refreshNews, NEWS_EVERY_MS);
  setInterval(refreshQuotes, QUOTES_EVERY_MS);
  setInterval(pushHealth, 60e3);
  setTimeout(() => refreshMacro(), 4000); // after the first news pull
  setInterval(() => refreshMacro(), 30 * 60 * 1000);
  app.on("activate", () => { if (!win) createWindow(); });
  screen.on("display-metrics-changed", keepOnScreen);
  screen.on("display-removed", keepOnScreen);
  // remember an open widget across quits: closing it at quit time must not count as "closed by you"
  app.on("before-quit", () => {
    quitting = true;
    if (widget) { prefs.widget.open = true; prefs.widget.bounds = widget.getBounds(); savePrefs(); }
  });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
