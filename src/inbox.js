// Alerts inbox: every Mac notification Tickerkite shows is also kept here, so nothing is lost when
// a banner disappears. main.js replaces Electron's Notification with wrap(Notification), so every
// module's alerts land in the inbox without changing how they're sent. A notification can say what
// it's about with a `tk` option: { kind, page?, story?, sym? }, used to open it from the inbox.
const MAX = 300;

function create({ readJSON, writeJSON, send }) {
  let items = readJSON("inbox.json", []);
  if (!Array.isArray(items)) items = [];
  let t = null;
  const persist = () => { clearTimeout(t); t = setTimeout(() => writeJSON("inbox.json", items), 500); };
  const snapshot = () => ({ items, unread: items.filter((i) => !i.read).length });
  const push = () => { persist(); send("inbox:update", snapshot()); };

  function add(opts) {
    const tk = opts.tk || {};
    items.unshift({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), read: false,
      title: String(opts.title || ""), subtitle: opts.subtitle ? String(opts.subtitle) : "", body: String(opts.body || ""),
      kind: tk.kind || "other", page: tk.page || null, story: tk.story || null, sym: tk.sym || null
    });
    if (items.length > MAX) items.length = MAX;
    push();
  }

  /** Electron's Notification, but every show() is also recorded in the inbox. */
  function wrap(Native) {
    function TkNotification(opts = {}) {
      const { tk, ...native } = opts;
      const n = new Native(native);
      const show = n.show.bind(n);
      n.show = () => { add(opts); return show(); };
      return n;
    }
    TkNotification.isSupported = () => Native.isSupported();
    return TkNotification;
  }

  return {
    add, wrap, snapshot,
    markRead(ids) { const set = ids ? new Set(ids) : null; for (const i of items) if (!set || set.has(i.id)) i.read = true; push(); },
    clear() { items = []; push(); }
  };
}

module.exports = { create, MAX };
