/* Tickerkite theme: "terminal" (default: black, cyan, monospace, function-code tabs) or "classic" (slate/indigo).
   Loaded in <head> so the right look paints first. Switch with View › Switch Theme (⌘⌥T) or Settings › Appearance;
   the choice is remembered per Mac in localStorage. terminal.css holds every [data-theme="terminal"] rule. */
(() => {
  const KEY = "tk.theme", THEMES = ["terminal", "classic"];
  const read = () => { try { const t = localStorage.getItem(KEY); return THEMES.includes(t) ? t : "terminal"; } catch { return "terminal"; } };
  const root = document.documentElement;
  root.dataset.theme = read();
  const subs = [];
  function set(t) {
    if (!THEMES.includes(t) || t === root.dataset.theme) return;
    root.dataset.theme = t;
    try { localStorage.setItem(KEY, t); } catch {}
    subs.forEach((f) => { try { f(t); } catch {} });
    window.dispatchEvent(new Event("resize")); // charts sized from layout redraw for the new chrome
  }
  window.TkTheme = {
    get: () => root.dataset.theme,
    isTerminal: () => root.dataset.theme === "terminal",
    set,
    toggle: () => set(root.dataset.theme === "terminal" ? "classic" : "terminal"),
    onChange: (f) => subs.push(f)
  };
  // another window (or a menu toggle there) changed it
  window.addEventListener("storage", (e) => { if (e.key === KEY && THEMES.includes(e.newValue)) { root.dataset.theme = e.newValue; subs.forEach((f) => f(e.newValue)); } });
})();
