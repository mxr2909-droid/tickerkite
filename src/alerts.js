// Alerts: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, Notification, showStory, showPage }
//  - IPC channels must start with "alerts:" (the preload only forwards those for this page)
//  - bus emits "news" (stories), "quotes" (quotes), "scores" (scorecard result) after each refresh
//  - get() returns { stories, quotes, watch, scores } right now
//
// Rules (alerts.json → { rules, state }):
//   price: { sym, op: "move"|"above"|"below", value }   move = |day change %| ≥ value
//   score: { asset, op: "above"|"below", value }         scorecard 0–100
//   ind:   { ind, op: "above"|"below", value }           scorecard indicator reading
//   news:  { keyword, high }                             headline contains keyword (high = HIGH impact only)
// Every rule also has id, enabled, cooldown (minutes) and created.
// Firing is edge-triggered: a rule fires when its condition goes from false to true, and not again
// until it has gone false and true again after the cooldown. Headline rules fire once per new story.
// state is saved with the rules, so a restart doesn't re-fire anything. The log (alerts-log.json) keeps 500.

const { ASSETS } = require("./macro/score");
const { INDICATORS } = require("./macro/indicators");

const LOG_MAX = 500;
const SEEN_MAX = 400;
const NEWS_MAX_AGE = 3 * 3600e3;
const ASSET_NAME = Object.fromEntries(ASSETS);
const IND_NAME = Object.fromEntries(INDICATORS.map((d) => [d.id, d.name]));

const num = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OPS = { above: ">", below: "<" };

/** Human label for a rule, e.g. "SPX move ≥ 2%", "Stocks score < 30", "“NVDA” · HIGH only". */
function describe(r) {
  if (r.type === "price") return r.op === "move" ? `${r.sym} move ≥ ±${r.value}%` : `${r.sym} ${OPS[r.op]} ${r.value}`;
  if (r.type === "score") return `${ASSET_NAME[r.asset] || r.asset} score ${OPS[r.op]} ${r.value}`;
  if (r.type === "ind") return `${IND_NAME[r.ind] || r.ind} ${OPS[r.op]} ${r.value}`;
  if (r.type === "news") return `Headline “${r.keyword}”${r.high ? " · HIGH only" : ""}`;
  return "?";
}

/** Validate and normalize a rule from the form. Throws a readable error. */
function normalize(r) {
  const v = Number(r.value);
  const base = { id: r.id || Math.random().toString(36).slice(2, 10), type: r.type, enabled: r.enabled !== false,
    cooldown: Math.max(0, Number(r.cooldown) || 60), created: r.created || Date.now() };
  const needVal = () => { if (!Number.isFinite(v)) throw new Error("Enter a number"); };
  if (r.type === "price") {
    if (!r.sym) throw new Error("Pick a symbol");
    if (!["move", "above", "below"].includes(r.op)) throw new Error("Bad condition");
    needVal();
    return { ...base, sym: String(r.sym), op: r.op, value: r.op === "move" ? Math.abs(v) : v };
  }
  if (r.type === "score" || r.type === "ind") {
    if (!OPS[r.op]) throw new Error("Bad condition");
    needVal();
    if (r.type === "score") { if (!ASSET_NAME[r.asset]) throw new Error("Pick an asset"); return { ...base, asset: r.asset, op: r.op, value: v }; }
    if (!IND_NAME[r.ind]) throw new Error("Pick an indicator");
    return { ...base, ind: r.ind, op: r.op, value: v };
  }
  if (r.type === "news") {
    const k = String(r.keyword || "").trim();
    if (!k) throw new Error("Enter a keyword or ticker");
    return { ...base, keyword: k, high: !!r.high };
  }
  throw new Error("Unknown rule type");
}

/** Current reading of a level rule: { on, v, text } or null if there's no data for it yet. */
function check(r, data) {
  const cmp = (v) => (r.op === "above" ? v > r.value : v < r.value);
  if (r.type === "price") {
    const q = (data.quotes || []).find((x) => x.sym === r.sym || x.label === r.sym);
    if (!q || !Number.isFinite(q.last)) return null;
    const pct = Number.isFinite(q.pct) ? q.pct : 0;
    const on = r.op === "move" ? Math.abs(pct) >= r.value : cmp(q.last);
    return { on, v: r.op === "move" ? num(pct) : num(q.last), text: `${q.label || q.sym} ${num(q.last)} (${pct >= 0 ? "+" : ""}${num(pct)}%)` };
  }
  if (r.type === "score") {
    const s = data.scores?.assets?.[r.asset]?.score;
    if (!Number.isFinite(s)) return null;
    return { on: cmp(s), v: num(s, 0), text: `${ASSET_NAME[r.asset]} score ${Math.round(s)}` };
  }
  if (r.type === "ind") {
    const v = data.scores?.ind?.[r.ind]?.v;
    if (!Number.isFinite(v)) return null;
    return { on: cmp(v), v: num(v), text: `${IND_NAME[r.ind]} at ${num(v)}` };
  }
  return null;
}

/** Stories a headline rule matches: whole-word match on the title, newest first. */
function matches(r, stories) {
  const re = new RegExp(`(^|[^A-Za-z0-9$])\\$?${esc(r.keyword)}(?![A-Za-z0-9])`, "i");
  return (stories || []).filter((s) => s.kind !== "ctx" && (!r.high || s.sev === "h") && re.test(s.title));
}

/**
 * Evaluate every enabled rule against data { quotes, scores, stories }.
 * state: { [ruleId]: { on, last, seen[] } } from the previous run (not mutated).
 * Returns { state, fired: [{ rule, text, v, story? }] }.
 */
function evaluate(rules, prev, data, now = Date.now()) {
  const state = {};
  const fired = [];
  for (const r of rules) {
    const st = { ...(prev[r.id] || {}) };
    state[r.id] = st;
    if (!r.enabled) continue;
    const cool = now - (st.last || 0) >= r.cooldown * 60e3;
    if (r.type === "news") {
      if (!data.stories) continue;
      const hits = matches(r, data.stories);
      const seen = new Set(st.seen || []);
      // first look at a new rule: remember what's already out there, alert only on what comes next
      const fresh = st.seen ? hits.filter((s) => !seen.has(s.id) && now - (s.updated || s.ts || now) < NEWS_MAX_AGE) : [];
      for (const s of hits) seen.add(s.id);
      st.seen = [...seen].slice(-SEEN_MAX);
      if (fresh.length && cool) {
        st.last = now;
        for (const s of fresh.slice(0, 3)) fired.push({ rule: r, text: s.title, story: s.id });
      }
      continue;
    }
    const c = check(r, data);
    if (!c) continue;
    if (c.on && !st.on && cool) { st.last = now; fired.push({ rule: r, text: c.text, v: c.v }); }
    st.on = c.on;
    st.v = c.v;
  }
  return { state, fired };
}

function register(ctx) {
  const { ipcMain, send, readJSON, writeJSON, bus, get, Notification, showStory, showPage } = ctx;
  const saved = readJSON("alerts.json", {}) || {};
  let rules = Array.isArray(saved.rules) ? saved.rules : [];
  let state = saved.state || {};
  let log = readJSON("alerts-log.json", []) || [];
  if (!Array.isArray(log)) log = [];

  const save = () => writeJSON("alerts.json", { rules, state });
  const snapshot = () => {
    const d = get();
    return {
      rules: rules.map((r) => ({ ...r, label: describe(r), now: state[r.id]?.v ?? null, on: !!state[r.id]?.on })),
      log,
      symbols: (d.quotes || []).filter((q) => q.sym).map((q) => ({ sym: q.sym, label: q.label || q.sym, watch: !!q.watch })),
      assets: ASSETS.map(([k, n]) => ({ k, n })),
      inds: INDICATORS.map((x) => ({ id: x.id, name: x.name, unit: x.unit, v: d.scores?.ind?.[x.id]?.v ?? null }))
    };
  };
  const push = () => send("alerts:update", snapshot());

  function run() {
    const d = get();
    const res = evaluate(rules, state, { quotes: d.quotes, scores: d.scores, stories: d.stories });
    state = res.state;
    for (const f of res.fired) {
      const entry = { id: Math.random().toString(36).slice(2, 10), ts: Date.now(), rule: f.rule.id, type: f.rule.type, label: describe(f.rule), text: f.text, story: f.story || null };
      log.unshift(entry);
      if (Notification?.isSupported?.()) {
        const n = new Notification({ title: `ALERT · ${entry.label}`, body: f.text, silent: false });
        n.on("click", () => (f.story ? showStory(f.story) : showPage("alerts")));
        n.show();
      }
    }
    if (log.length > LOG_MAX) log.length = LOG_MAX;
    save();
    if (res.fired.length) writeJSON("alerts-log.json", log);
    push();
  }
  for (const ev of ["quotes", "news", "scores"]) bus.on(ev, run);

  ipcMain.handle("alerts:get", () => snapshot());
  ipcMain.handle("alerts:add", (_e, r) => {
    try { rules.push(normalize(r || {})); } catch (e) { return { error: e.message }; }
    run();
    return { ok: true };
  });
  ipcMain.handle("alerts:toggle", (_e, id) => {
    const r = rules.find((x) => x.id === id);
    if (r) { r.enabled = !r.enabled; run(); }
    return true;
  });
  ipcMain.handle("alerts:delete", (_e, id) => {
    rules = rules.filter((x) => x.id !== id);
    delete state[id];
    save(); push();
    return true;
  });
  ipcMain.handle("alerts:clear-log", () => { log = []; writeJSON("alerts-log.json", log); push(); return true; });
  ipcMain.handle("alerts:open", (_e, story) => { if (story) showStory(String(story)); return true; });
}

module.exports = { register, evaluate, check, matches, normalize, describe };
