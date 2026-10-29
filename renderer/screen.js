/* Tickerkite Stock screener (SCRN): placeholder until the screener lands. */
(() => { (window.WirePages ||= {}).screen = { show() { document.querySelector("#screen").innerHTML = `<p class="dim" style="padding:20px">Loading…</p>`; }, hide() {}, key() {}, restore() {}, detail: () => document.querySelector("#scdetail") }; })();
