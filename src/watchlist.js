// Your own tickers: which headlines mention them.
// Each entry is { sym, name, terms }. `terms` are the words that count as a mention;
// they start as the company's short name and can be edited in watchlist.json.

const SUFFIX_RE = /[,.]?\s+(inc|incorporated|corp|corporation|company|co|ltd|limited|plc|llc|lp|holdings?|group|n\.?v|s\.?a|se|ag|class [a-c]|common stock|ordinary shares|\(the\))\.?$/i;

/** Uppercase and strip anything that can't be in a Yahoo symbol. */
function normalizeSymbol(s) {
  return String(s || "").trim().toUpperCase().replace(/^\$/, "").replace(/[^A-Z0-9.^=\-]/g, "").slice(0, 15);
}

/** "NVIDIA Corporation" -> "NVIDIA", "Apple Inc." -> "Apple", "The Coca-Cola Company" -> "Coca-Cola". */
function shortName(name) {
  let n = String(name || "").trim().replace(/^the\s+/i, "");
  for (let i = 0; i < 4; i++) {
    const next = n.replace(SUFFIX_RE, "").trim();
    if (next === n) break;
    n = next;
  }
  return n.replace(/[,&]+$/, "").trim();
}

/** Default match terms: the short company name, when it's distinctive enough to search for. */
function defaultTerms(sym, name) {
  const short = shortName(name);
  if (!short || short.toUpperCase() === sym || short.length < 3) return [];
  return [short];
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One regex per entry. The ticker itself must be uppercase so "ALL" or "ON" in a sentence don't count;
 * one- and two-letter tickers only count as "$F" or "(F)". Terms are matched case-insensitively.
 */
function matcher(entry) {
  const sym = escRe(entry.sym);
  const symPart = entry.sym.length >= 3 ? `(?<![\\w.])\\$?${sym}(?![\\w])` : `\\$${sym}(?![\\w])|\\(${sym}\\)`;
  const terms = (entry.terms || []).filter((t) => t && t.trim().length >= 2).map((t) => escRe(t.trim()));
  const symRe = new RegExp(symPart);
  const termRe = terms.length ? new RegExp(`\\b(?:${terms.join("|")})\\b`, "i") : null;
  return (text) => symRe.test(text) || (termRe ? termRe.test(text) : false);
}

/** Add `watch: [sym, ...]` to every story that mentions a watchlist ticker. Returns new story objects. */
function tagStories(stories, list) {
  const ms = (list || []).map((e) => [e.sym, matcher(e)]);
  return stories.map((s) => {
    if (!ms.length) return s.watch ? { ...s, watch: [] } : s;
    const text = [s.title, s.summary, ...(s.sources || []).map((x) => x.title)].join(" ");
    const hit = ms.filter(([sym, m]) => (s.assets || []).includes(sym) || m(text)).map(([sym]) => sym);
    return { ...s, watch: hit };
  });
}

/** Clean up a watchlist read from disk; drops junk and duplicates. */
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const sym = normalizeSymbol(e?.sym);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    const name = String(e.name || sym);
    const terms = Array.isArray(e.terms) ? e.terms.map(String).filter(Boolean) : defaultTerms(sym, name);
    out.push({ sym, name, terms });
  }
  return out;
}

module.exports = { normalizeSymbol, shortName, defaultTerms, matcher, tagStories, sanitize };
