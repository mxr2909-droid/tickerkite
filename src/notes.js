// Your own notes per ticker, for the Company page. Stored as { SYM: { text, at } } in company-notes.json.
const MAX_LEN = 20000;
const MAX_NOTES = 500;

const keyOf = (sym) => String(sym || "").toUpperCase().trim().slice(0, 15);

/** The note for a symbol, or an empty one. */
function get(store, sym) {
  const n = store[keyOf(sym)];
  return n ? { text: n.text, at: n.at } : { text: "", at: 0 };
}

/** Save (or, when the text is blank, remove) a note. Returns the saved note. */
function set(store, sym, text, now = Date.now()) {
  const k = keyOf(sym);
  if (!/^[A-Z0-9.\-^=]+$/.test(k)) return { text: "", at: 0 };
  const t = String(text ?? "").slice(0, MAX_LEN);
  if (!t.trim()) { delete store[k]; return { text: "", at: 0 }; }
  store[k] = { text: t, at: now };
  const keys = Object.keys(store);
  if (keys.length > MAX_NOTES) for (const old of keys.sort((a, b) => store[a].at - store[b].at).slice(0, keys.length - MAX_NOTES)) delete store[old];
  return store[k];
}

module.exports = { get, set, keyOf, MAX_LEN, MAX_NOTES };
