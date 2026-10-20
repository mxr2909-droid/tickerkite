/* WIRE Graph workspace page. Registers with app.js through window.WirePages (see the "pages" section there). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);

  (window.WirePages ||= {}).graphs = {
    show() { $("#graphs").innerHTML = `<div class="empty">Graph workspace: coming soon.</div>`; },
    hide() {},
    key(e) {},
    restore() {},
    detail: () => $("#gdetail")
  };
})();
