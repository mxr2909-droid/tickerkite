/* Daily-history store shared by the Markets breadth ribbon and the Sector map replay (window.TkMapHistory).
   One copy per window: asked for over map:history when a page needs it, re-asked when the main process says a newer
   download is ready (map:history:update carries only { at, loading, progress, error }, so windows that never asked
   don't receive a year of prices). The per-company series are prepared once per download (TkBreadth.prepare). */
(() => {
  const api = window.wire, BR = window.TkBreadth;
  const H = { data: null, P: null, index: null, status: { loading: false, progress: null, error: null, at: 0 }, asked: false, pending: null, subs: [] };

  function notify() { for (const f of H.subs) { try { f(H); } catch (e) { console.error(e); } } }
  function take(m) {
    if (!m) return;
    const key = m.at + ":" + m.syms.map((s) => s.sym).join(",");
    if (!m.same && m.dates) H.data = m;
    else if (H.data) H.data = { ...H.data, syms: m.syms, sectors: m.sectors }; // same prices, maybe a new list of companies
    if (H.data && (!m.same || key !== H.key)) {
      // rows follow H.data.syms; closes are keyed by symbol, so a company added since the download has none
      H.P = BR.prepare(H.data.syms.map((s) => H.data.closes[s.sym] || null), H.data.dates.length);
      H.index = new Map(H.data.syms.map((s, i) => [s.sym, i]));
      H.key = key;
    }
    H.status = { loading: m.loading, progress: m.progress, error: m.error, at: m.at };
    notify();
  }
  function ask() {
    if (H.pending) { H.again = true; return H.pending; } // news arrived mid-request: ask once more when it returns
    H.pending = api.page.invoke("map:history", H.data?.at || 0).then(take).catch((e) => { H.status = { ...H.status, loading: false, error: String(e?.message || e) }; notify(); })
      .finally(() => { H.pending = null; if (H.again) { H.again = false; ask(); } });
    return H.pending;
  }
  api.page.on("map:history:update", (m) => {
    H.status = { loading: m.loading, progress: m.progress, error: m.error, at: m.at || H.status.at };
    if (H.asked && !m.loading && m.at && m.at !== H.data?.at) ask(); // a newer download is ready
    else notify();
  });

  window.TkMapHistory = {
    /** Ask for the history (starts the download in the main process when it is due). Call when a page is shown. */
    want() { H.asked = true; ask(); return H; },
    /** f(H) after every change: H.data (the map:history payload), H.P (prepared rows, same order as H.data.syms), H.status. */
    on(f) { H.subs.push(f); },
    get: () => H,
    ready: () => !!(H.data && H.P && H.data.dates?.length > 30)
  };
})();
