/* WIRE Market heatmap page. Registers with app.js through window.WirePages (see the "pages" section there). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);

  (window.WirePages ||= {}).markets = {
    show() { $("#markets").innerHTML = `<div class="empty">Market heatmap: coming soon.</div>`; },
    hide() {},
    key(e) {},
    restore() {},
    detail: () => $("#mdetail")
  };
})();
