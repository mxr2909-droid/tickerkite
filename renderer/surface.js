/* A 3D surface on a canvas: a grid of values (columns × rows) drawn as a shaded landscape you can turn.
   Used by the Yield curve page (columns = maturities, rows = dates, height = yield); no library, the same
   overhead-to-tilted orthographic camera as the Sector map.
   TkSurface.mount(canvas, tip, data, cam):
     data { cols: [label], rows: [{ label, z: [number per col], flag: bool }], unit: "%" }
     cam  { yaw, pitch } in degrees, kept by the caller so the view survives a redraw. */
(() => {
  const RAD = Math.PI / 180;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // low → high
  const RAMP = [[26, 44, 112], [28, 108, 168], [36, 164, 150], [214, 190, 84], [228, 124, 62]];
  function ramp(k) {
    const f = clamp(k, 0, 1) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(f)), t = f - i;
    return RAMP[i].map((v, j) => v + (RAMP[i + 1][j] - v) * t);
  }
  const rgb = (c, f = 1) => `rgb(${c.map((v) => Math.round(clamp(v * f, 0, 255))).join(",")})`;

  function mount(cv, tip, D, cam) {
    const c = cv.getContext("2d"), nx = D.cols.length, ny = D.rows.length;
    if (nx < 2 || ny < 2) return;
    const css = getComputedStyle(cv), token = (n, d) => css.getPropertyValue(n).trim() || d;
    const ACCENT = token("--accent", "#36a3e6"), DIM = token("--dim", "#8590a0"), LINE = token("--line-2", "#2a3442"), FG = token("--fg-strong", "#fff");
    const font = css.fontFamily;
    let W = 0, H = 0, dpr = 1, P = null, hov = null;
    const all = D.rows.flatMap((r) => r.z), step = Math.max(...all) - Math.min(...all) > 3 ? 1 : 0.5;
    const lo = Math.floor(Math.min(...all) / step) * step, hi = Math.ceil(Math.max(...all) / step) * step;
    const A = 1, B = 1.3, HZ = 0.8; // half-width (columns), half-depth (rows, newest in front), height
    const X = (i) => -A + (2 * A * i) / (nx - 1), Y = (j) => -B + (2 * B * j) / (ny - 1), Z = (v) => (HZ * (v - lo)) / (hi - lo || 1);

    function draw() {
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      W = r.width; H = r.height; dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
      const th = cam.yaw * RAD, ph = cam.pitch * RAD, sn = Math.sin(th), cs = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
      const extW = 2 * A * cs + 2 * B * Math.abs(sn), extH = (2 * A * Math.abs(sn) + 2 * B * cs) * sp + HZ * cp;
      const S = Math.min((W - 130) / extW, (H - 64) / extH), cx = W / 2, cy = H / 2 + (S * HZ * cp) / 2 - 6;
      const proj = (x, y, z) => [cx + S * (x * cs - y * sn), cy + S * ((x * sn + y * cs) * sp - z * cp)];
      const path = (pts, close) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); if (close) c.closePath(); };
      const text = (s, p, align, base, size = 10.5, color = DIM, weight = 400) => { c.font = `${weight} ${size}px ${font}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = base; c.fillText(s, p[0], p[1]); };
      const near = sn >= 0 ? A : -A, far = -near, out = sn >= 0 ? 1 : -1; // the side edge facing the viewer, and which way is outward from it

      // floor and the two back walls, with a line at each yield step
      path([proj(-A, -B, 0), proj(A, -B, 0), proj(A, B, 0), proj(-A, B, 0)], true); c.fillStyle = "rgba(128,140,160,.06)"; c.fill();
      c.strokeStyle = LINE; c.lineWidth = 1;
      for (let v = lo; v <= hi + 1e-9; v += step) {
        const z = Z(v);
        path([proj(near, -B, z), proj(far, -B, z), proj(far, B, z)]); c.globalAlpha = 0.7; c.stroke(); c.globalAlpha = 1;
        const p = proj(far, B, z); // at the front end of the far wall, clear of the row labels on the near side
        text(v.toFixed(step < 1 ? 1 : 0) + (D.unit || ""), [p[0] - out * 7, p[1]], out > 0 ? "right" : "left", "middle");
      }
      path([proj(far, -B, 0), proj(far, -B, HZ)]); c.stroke(); path([proj(near, -B, 0), proj(near, -B, HZ)]); c.stroke(); path([proj(far, B, 0), proj(far, B, HZ)]); c.stroke();

      // the surface: one shaded patch per grid cell, far ones first
      P = D.rows.map((row, j) => row.z.map((v, i) => proj(X(i), Y(j), Z(v))));
      const cells = [];
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) cells.push({ i, j, d: (X(i) + X(i + 1)) / 2 * sn + (Y(j) + Y(j + 1)) / 2 * cs });
      cells.sort((a, b) => a.d - b.d);
      const dx = X(1) - X(0), dy = Y(1) - Y(0), L = [-0.42, 0.38, 0.82];
      c.lineWidth = 0.5; c.strokeStyle = "rgba(0,0,0,.28)"; c.lineJoin = "round";
      for (const { i, j } of cells) {
        const z00 = D.rows[j].z[i], z10 = D.rows[j].z[i + 1], z01 = D.rows[j + 1].z[i], z11 = D.rows[j + 1].z[i + 1];
        const zx = (Z(z10) + Z(z11) - Z(z00) - Z(z01)) / 2, zy = (Z(z01) + Z(z11) - Z(z00) - Z(z10)) / 2; // rise across the cell
        const n = [-zx * dy, -zy * dx, dx * dy], len = Math.hypot(...n), lit = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / len);
        path([P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]], true);
        c.fillStyle = rgb(ramp(((z00 + z10 + z01 + z11) / 4 - lo) / (hi - lo || 1)), 0.5 + 0.62 * lit);
        c.fill(); c.stroke();
      }

      // skirts down to the floor on the two edges facing the viewer, then the newest row as a bright line
      const ni = near > 0 ? nx - 1 : 0, side = D.rows.map((_, j) => P[j][ni]);
      path([proj(near, -B, 0), ...side, proj(near, B, 0)], true); c.fillStyle = "rgba(8,11,16,.72)"; c.fill();
      const front = P[ny - 1];
      path([proj(-A, B, 0), ...front, proj(A, B, 0)], true); c.fillStyle = "rgba(8,11,16,.82)"; c.fill();
      path(front); c.strokeStyle = ACCENT; c.lineWidth = 2.4; c.stroke();
      c.fillStyle = ACCENT; for (const p of front) { c.beginPath(); c.arc(p[0], p[1], 2.6, 0, 7); c.fill(); }

      // a strip on the floor along the near side: red where the row is flagged (curve inverted)
      for (let j = 0; j < ny - 1; j++) {
        path([proj(near + out * 0.05, Y(j), 0), proj(near + out * 0.12, Y(j), 0), proj(near + out * 0.12, Y(j + 1), 0), proj(near + out * 0.05, Y(j + 1), 0)], true);
        c.fillStyle = D.rows[j].flag || D.rows[j + 1].flag ? "#e5484d" : "rgba(128,140,160,.22)"; c.fill();
      }
      // labels: columns along the front edge, about six row labels along the near side
      D.cols.forEach((s, i) => { const p = proj(X(i), B + 0.09, 0); text(s, p, "center", "top", 10.5, i === hov?.i ? FG : DIM, i === hov?.i ? 700 : 400); });
      const every = Math.max(1, Math.round(ny / 6));
      for (let j = ny - 1; j >= 0; j -= every) { const p = proj(near + out * 0.2, Y(j), 0); text(D.rows[j].short, p, out > 0 ? "left" : "right", "middle"); }

      if (hov) { // the day's curve and the maturity's history through the point under the pointer
        path(P[hov.j]); c.strokeStyle = "#ffffff"; c.lineWidth = 1.6; c.stroke();
        path(P.map((row) => row[hov.i])); c.strokeStyle = ACCENT; c.lineWidth = 1.6; c.stroke();
        const p = P[hov.j][hov.i]; c.beginPath(); c.arc(p[0], p[1], 4.5, 0, 7); c.fillStyle = "#ffffff"; c.fill(); c.strokeStyle = "rgba(0,0,0,.6)"; c.lineWidth = 1; c.stroke();
      }
    }

    function pick(e) {
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 22 * 22;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const d = (P[j][i][0] - mx) ** 2 + (P[j][i][1] - my) ** 2; if (d < bd) { bd = d; best = { i, j }; } }
      if (best?.i !== hov?.i || best?.j !== hov?.j) { hov = best; draw(); }
      if (!tip) return;
      if (!best) { tip.hidden = true; return; }
      const row = D.rows[best.j];
      tip.innerHTML = `<b>${D.cols[best.i]}</b> ${row.z[best.i].toFixed(2)}${D.unit || ""}<br><span class="dim">${row.label}${row.note ? " · " + row.note : ""}</span>`;
      tip.hidden = false;
      tip.style.left = clamp(mx + 14, 4, W - tip.offsetWidth - 4) + "px";
      tip.style.top = (my + 18 + tip.offsetHeight > H ? my - tip.offsetHeight - 10 : my + 18) + "px";
    }

    let drag = null;
    cv.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }; try { cv.setPointerCapture(e.pointerId); } catch {} cv.style.cursor = "grabbing"; });
    cv.addEventListener("pointermove", (e) => {
      if (!drag) { if (P) pick(e); return; }
      cam.yaw = clamp(drag.yaw - (e.clientX - drag.x) * 0.3, -75, 75); cam.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.3, 12, 85);
      if (tip) tip.hidden = true; hov = null; draw();
    });
    const end = () => { drag = null; cv.style.cursor = "grab"; };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { if (drag) return; if (tip) tip.hidden = true; if (hov) { hov = null; draw(); } });
    cv.style.cursor = "grab";
    draw();
  }

  window.TkSurface = { mount };
})();
