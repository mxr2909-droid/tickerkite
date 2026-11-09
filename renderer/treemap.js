/* Treemap geometry shared by the Sector map page and its tests (plain functions, no DOM).
   In the app it is window.TkTreemap; under Node it is module.exports. */
(() => {
  /** Squarified treemap (Bruls, Huizing, van Wijk): split rect { x, y, w, h } into one rectangle per value,
   *  area in proportion to the value, as close to square as the order allows. Values are laid out largest
   *  first; the result keeps the input order. Values ≤ 0 get an empty rectangle. */
  function squarify(values, rect) {
    const n = values.length, out = Array.from({ length: n }, () => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
    const order = values.map((v, i) => i).filter((i) => values[i] > 0).sort((a, b) => values[b] - values[a]);
    const total = order.reduce((a, i) => a + values[i], 0);
    let { x, y, w, h } = rect;
    if (!(total > 0) || !(w > 0) || !(h > 0)) return out;
    const scale = (w * h) / total;
    let i = 0;
    while (i < order.length) {
      const side = Math.min(w, h);
      // grow the row while its worst aspect ratio keeps improving
      let k = 0, sum = 0, max = 0, min = Infinity, best = Infinity;
      while (i + k < order.length) {
        const a = values[order[i + k]] * scale, s = sum + a, mx = Math.max(max, a), mn = Math.min(min, a);
        const worst = Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
        if (k && worst > best) break;
        sum = s; max = mx; min = mn; best = worst; k++;
      }
      const thick = sum / side;
      let off = 0;
      for (let j = 0; j < k; j++) {
        const len = (values[order[i + j]] * scale) / thick;
        out[order[i + j]] = w >= h ? { x, y: y + off, w: thick, h: len } : { x: x + off, y, w: len, h: thick };
        off += len;
      }
      if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      i += k;
    }
    return out;
  }

  /** Back-to-front drawing order for boxes standing on rects [{ x, y, w, h }], seen from a camera turned by
   *  the angle whose sine and cosine are given (depth grows with x·sin + y·cos). A box is drawn before every
   *  box it could hide behind. Returns indices; overlapping rects (mid-animation) fall back to center depth. */
  function depthOrder(rects, sin, cos) {
    const n = rects.length, E = 0.01;
    const depth = rects.map((r) => (r.x + r.w / 2) * sin + (r.y + r.h / 2) * cos);
    const behind = (a, b) => // a can never cover b
      (a.x + a.w <= b.x + E && sin > 0) || (b.x + b.w <= a.x + E && sin < 0) || (a.y + a.h <= b.y + E && cos > 0) || (b.y + b.h <= a.y + E && cos < 0);
    const blockers = new Array(n).fill(0), after = Array.from({ length: n }, () => []);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a !== b && behind(rects[a], rects[b]) && !behind(rects[b], rects[a])) { after[a].push(b); blockers[b]++; }
    }
    const out = [], done = new Array(n).fill(false);
    while (out.length < n) {
      let pick = -1;
      for (let i = 0; i < n; i++) if (!done[i] && blockers[i] === 0 && (pick < 0 || depth[i] < depth[pick])) pick = i;
      if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || depth[i] < depth[pick])) pick = i; // a cycle: nearest-first can't be exact
      done[pick] = true; out.push(pick);
      for (const b of after[pick]) blockers[b]--;
    }
    return out;
  }

  const api = { squarify, depthOrder };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.TkTreemap = api;
})();
