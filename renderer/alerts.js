/* WIRE Alerts page. Registers with app.js through window.WirePages (see the "pages" section there). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);

  (window.WirePages ||= {}).alerts = {
    show() { $("#alerts").innerHTML = `<div class="empty">Alerts: coming soon.</div>`; },
    hide() {},
    key(e) {},
    restore() {},
    detail: () => $("#adetail")
  };
})();
