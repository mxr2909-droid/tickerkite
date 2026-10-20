/* WIRE Fed path page. Registers with app.js through window.WirePages (see the "pages" section there). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);

  (window.WirePages ||= {}).fed = {
    show() { $("#fed").innerHTML = `<div class="empty">Fed path: coming soon.</div>`; },
    hide() {},
    key(e) {},
    restore() {},
    detail: () => $("#fdetail")
  };
})();
