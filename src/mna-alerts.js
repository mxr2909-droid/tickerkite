// M&A deal alerts: a Mac notification (also kept in the alerts inbox) when a new deal matches what the
// user asked to hear about. Pure helpers (sanitizePrefs, matches, pick, text) plus attach(ctx, getDeals).
const FRESH_DAYS = 10;
const SIZES = [0, 1e8, 1e9, 1e10];
const TYPES = ["Merger", "Tender offer", "Going private"];
const DEFAULTS = { on: false, sectors: [], watch: true, minSize: 0, types: [] };
const MAX_SENT = 5;

const strs = (a, max = 40) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === "string" && x && x.length <= 60))].slice(0, max) : []);

function sanitizePrefs(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const min = Number(r.minSize);
  return {
    on: r.on === true,
    sectors: strs(r.sectors),
    watch: r.watch === undefined ? DEFAULTS.watch : r.watch !== false,
    minSize: SIZES.includes(min) ? min : 0,
    types: strs(r.types).filter((t) => TYPES.includes(t))
  };
}

function money(v) {
  if (!(v > 0)) return "";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

const isSpac = (d) => d.type === "SPAC merger" || d.sector === "SPACs & shells";
const syms = (d) => [...(d.target?.tickers || []), ...(d.acquirers || []).flatMap((a) => a.tickers || [])].map((s) => String(s).toUpperCase());

/** Why this deal is worth an alert, or null. */
function matches(deal, prefs, watchSyms) {
  const p = sanitizePrefs(prefs);
  if (!deal || isSpac(deal)) return null;
  if (p.watch) {
    const w = watchSyms instanceof Set ? watchSyms : new Set((watchSyms || []).map((s) => String(s).toUpperCase()));
    if (syms(deal).some((s) => w.has(s))) return "on your watchlist";
  }
  if (p.sectors.length && !p.sectors.includes(deal.sector)) return null;
  if (p.types.length && !p.types.includes(deal.type)) return null;
  if (p.minSize > 0 && !(deal.value >= p.minSize)) return null;
  if (p.sectors.length) return deal.sector;
  if (p.minSize > 0) return `${money(p.minSize)}+ deal`;
  if (p.types.length) return deal.type;
  return "new deal";
}

/** The deals to alert about now. `seen` null means first run: seed it, alert nothing. */
function pick(deals, prefs, watchSyms, seen, now = Date.now()) {
  const list = Array.isArray(deals) ? deals : [];
  if (!seen || typeof seen !== "object") return { alerts: [], seen: Object.fromEntries(list.map((d) => [d.id, true])) };
  const out = { ...seen }, alerts = [];
  const p = sanitizePrefs(prefs);
  for (const d of list) {
    if (out[d.id]) continue;
    const t = Date.parse(d.date);
    if (!isFinite(t) || now - t > FRESH_DAYS * 864e5) continue;
    const reason = matches(d, p, watchSyms);
    if (!reason) continue; // an unknown size also lands here, and stays unseen so it can alert once sized
    out[d.id] = true;
    alerts.push({ deal: d, reason });
  }
  return { alerts, seen: out };
}

function text(deal, reason) {
  const buyer = deal.acquirers?.[0]?.name;
  const parts = [
    deal.type,
    buyer ? `Bought by ${buyer}` : "",
    deal.sector && deal.sector !== "Other" ? deal.sector : "",
    money(deal.value),
    deal.price > 0 ? `$${Number(deal.price).toFixed(2)} a share` : "",
    reason === "on your watchlist" ? "on your watchlist" : ""
  ].filter(Boolean);
  return { title: `New deal: ${deal.target?.name || "unknown"}`, body: parts.join(" · ") };
}

function attach(ctx, getDeals) {
  const { ipcMain, readJSON, writeJSON } = ctx;
  const file = "mna-alerts.json";
  const saved = readJSON(file, null) || {};
  let prefs = sanitizePrefs(saved.prefs);
  let seen = saved.seen && typeof saved.seen === "object" ? saved.seen : null;
  const save = () => { try { writeJSON(file, { prefs, seen }); } catch {} };

  const watchSyms = () => new Set((ctx.get?.().watch || []).map((e) => String(e.sym || "").toUpperCase()).filter(Boolean));

  function notify(title, body) {
    if (!ctx.Notification?.isSupported?.()) return;
    const n = new ctx.Notification({ title, body, silent: false, tk: { kind: "deal", page: "mna" } });
    n.on("click", () => ctx.showPage?.("mna"));
    n.show();
  }

  function check() {
    const deals = getDeals() || [];
    if (!deals.length && !seen) return; // nothing loaded yet: stay unseeded
    if (!prefs.on) { // keep seen seeded so turning alerts on later does not flood
      seen = { ...(seen || {}), ...pick(deals, prefs, new Set(), null).seen };
      save();
      return;
    }
    const r = pick(deals, prefs, watchSyms(), seen);
    const ids = new Set(deals.map((d) => d.id));
    seen = Object.fromEntries(Object.keys(r.seen).filter((k) => ids.has(k)).map((k) => [k, true]));
    save();
    const a = r.alerts;
    const shown = a.length > MAX_SENT ? a.slice(0, MAX_SENT - 1) : a;
    for (const x of shown) { const t = text(x.deal, x.reason); notify(t.title, t.body); }
    if (a.length > shown.length) {
      const n = a.length - shown.length;
      notify(`and ${n} more new deals`, a.slice(shown.length, shown.length + 4).map((x) => x.deal.target?.name).filter(Boolean).join(", "));
    }
  }

  ipcMain.handle("mna:alerts:get", () => prefs);
  ipcMain.handle("mna:alerts:set", (_e, p) => {
    prefs = sanitizePrefs(p);
    save();
    try { check(); } catch {}
    return prefs;
  });

  return { check, prefs: () => prefs, setPrefs(p) { prefs = sanitizePrefs(p); save(); return prefs; } };
}

module.exports = { sanitizePrefs, matches, pick, text, attach, money, TYPES, SIZES, DEFAULTS };
