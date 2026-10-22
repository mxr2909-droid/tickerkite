/* Shared loading, empty and error states, so every page shows the same placeholders instead of a blank area.
   window.WireUI.skeleton(kind, opts) / empty(title, text, action) / error(text, retryAttr) return HTML strings. */
(() => {
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // fixed widths so the placeholder looks like real rows rather than a uniform block
  const W = [78, 62, 86, 54, 70, 66, 82, 58, 74, 48, 80, 64];

  /** kind: "rows" (list rows), "tiles" (heatmap grid), "chart" (one big chart), "detail" (right-hand pane) */
  function skeleton(kind = "rows", { n = 10, label = "" } = {}) {
    const cap = label ? `<div class="sk-cap" role="status">${esc(label)}</div>` : "";
    let body;
    if (kind === "tiles") body = `<div class="sk-tiles">${Array.from({ length: n }, () => `<i class="sk sk-tile"></i>`).join("")}</div>`;
    else if (kind === "chart") body = `<i class="sk sk-line" style="width:40%"></i><i class="sk sk-chart"></i><i class="sk sk-line" style="width:70%"></i><i class="sk sk-line" style="width:55%"></i>`;
    else if (kind === "detail") body = `<i class="sk sk-line" style="width:30%"></i><i class="sk sk-h1"></i><i class="sk sk-h1" style="width:60%"></i>${[90, 84, 70].map((w) => `<i class="sk sk-line" style="width:${w}%"></i>`).join("")}<i class="sk sk-box"></i>`;
    else body = Array.from({ length: n }, (_, i) => `<div class="sk-row"><i class="sk sk-n"></i><i class="sk sk-line" style="width:${W[i % W.length]}%"></i><i class="sk sk-t"></i></div>`).join("");
    return `<div class="skw skw-${kind}" aria-busy="true">${cap}${body}</div>`;
  }

  /** a centered note for "nothing here yet"; action is optional HTML (a button) */
  function empty(title, text = "", action = "") {
    return `<div class="es"><div class="es-t">${esc(title)}</div>${text ? `<div class="es-x">${text}</div>` : ""}${action ? `<div class="es-a">${action}</div>` : ""}</div>`;
  }

  /** a load failure; retryAttr is the data attribute the page already listens for (e.g. "data-ref") */
  function error(text, retryAttr = "") {
    return `<div class="es es-err" role="alert"><div class="es-t">Couldn't load this</div><div class="es-x">${esc(text)}</div>${retryAttr ? `<div class="es-a"><button type="button" class="es-btn" ${retryAttr}>Try again</button></div>` : ""}</div>`;
  }

  window.WireUI = { skeleton, empty, error, esc };
})();
