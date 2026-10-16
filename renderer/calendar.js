/* WIRE Economic calendar page. Registers with app.js through window.WirePages (see the "pages" section there). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);

  (window.WirePages ||= {}).calendar = {
    show() { $("#calendar").innerHTML = `<div class="empty">Economic calendar: coming soon.</div>`; },
    hide() {},
    key(e) {},
    restore() {},
    detail: () => $("#cdetail")
  };
})();
