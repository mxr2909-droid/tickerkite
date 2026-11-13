/* Tickerkite Market heatmap page. Registers with app.js through window.WirePages (see the "pages" section there). */
(() => {
  const api = window.wire;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // full-color return per period (a ±SCALE move is fully saturated)
  const SCALE = { "1D": 2, "1W": 4, "1M": 8, "3M": 15, YTD: 25, "1Y": 35, "3Y": 70, "5Y": 110, "10Y": 200 };
  const ANNUAL = { "3Y": 3, "5Y": 5, "10Y": 10 };
  const RANGES = ["1Y", "3Y", "5Y", "10Y", "MAX"];
  const M = { snap: null, period: "1D", sel: null, visible: false, range: "1Y", hist: null, tail: 8, cset: "assets", cwin: "3M", pair: null, pairData: null, cmDrawn: "" };
  try { M.cset = localStorage.getItem("wire.markets.cset") || "assets"; M.cwin = localStorage.getItem("wire.markets.cwin") || "3M"; } catch {}
  try { M.period = localStorage.getItem("wire.markets.period") || "1D"; M.tail = +localStorage.getItem("wire.markets.tail") || 8; } catch {}
  // sector rotation chart: the four quarters, clockwise from top right
  const QUAD = { leading: ["#3ecf8e", "Leading", "beating the S&P 500 and still gaining on it"], weakening: ["#f2b34a", "Weakening", "still ahead, but losing ground"],
    lagging: ["#f2706b", "Lagging", "behind and falling further back"], improving: ["#5ec2f2", "Improving", "still behind, but catching up"] };
  const quad = (x, y) => (x >= 100 ? (y >= 100 ? "leading" : "weakening") : y >= 100 ? "improving" : "lagging");

  const pct = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
  // terminal theme: pale for a small move, deep for a big one, dark text on the pale end (returns [background, ink])
  function termColor(v) {
    if (v == null) return ["#0d1117", ""];
    const k = Math.min(1, Math.abs(v) / SCALE[M.period]) ** 0.7;
    const [a, b] = v >= 0 ? [[214, 238, 208], [27, 110, 43]] : [[247, 205, 200], [168, 26, 30]];
    return [`rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * k)).join(",")})`, k < 0.5 ? "#0b0f14" : "#fff"];
  }
  function color(v) {
    if (window.TkTheme?.isTerminal()) return termColor(v)[0];
    if (v == null) return "#191c22";
    const k = Math.min(1, Math.abs(v) / SCALE[M.period]) ** 0.8;
    const [r, g, b] = v >= 0 ? [38, 166, 110] : [214, 74, 80];
    const mix = (c, base) => Math.round(base + (c - base) * k);
    return `rgb(${mix(r, 27)},${mix(g, 30)},${mix(b, 37)})`;
  }
  const ret = (sym) => M.snap?.data?.[sym]?.ret?.[M.period] ?? null;

  function tile(sym, name, sub) {
    const v = ret(sym), last = M.snap?.data?.[sym]?.last;
    const ink = window.TkTheme?.isTerminal() ? termColor(v)[1] : "";
    return `<button type="button" class="mtile${M.sel === sym ? " sel" : ""}" data-sym="${esc(sym)}" style="background:${color(v)}${ink ? ";color:" + ink : ""}" title="${esc(sym)}">
      <span class="mn">${esc(name)}</span><span class="mp">${pct(v)}</span><span class="ms"><span>${esc(sub || sym)}</span>${last != null ? `<span>${num(last)}</span>` : ""}</span></button>`;
  }

  /** Sector rotation: each sector's strength against the S&P 500 (across) and whether that strength is rising (up), with a tail of past weeks. */
  function rotationSection(rot) {
    const secs = (rot?.sectors || []).map((s) => ({ ...s, pts: s.pts.slice(-M.tail) })).filter((s) => s.pts.length > 1);
    if (!secs.length) return "";
    const W = 660, H = 430, pl = 40, pr = 14, pt = 12, pb = 34, pw = W - pl - pr, ph = H - pt - pb;
    const dev = Math.max(1.5, ...secs.flatMap((s) => s.pts.flatMap((p) => [Math.abs(p[1] - 100), Math.abs(p[2] - 100)]))) * 1.12;
    const X = (v) => pl + ((v - (100 - dev)) / (2 * dev)) * pw, Y = (v) => pt + (1 - (v - (100 - dev)) / (2 * dev)) * ph;
    const tint = (k, x, y) => `<rect x="${x}" y="${y}" width="${pw / 2}" height="${ph / 2}" fill="${QUAD[k][0]}" opacity=".07"/>`;
    const corner = (k, x, y, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="rot-q" fill="${QUAD[k][0]}">${QUAD[k][1].toUpperCase()}</text>`;
    let g = `<svg viewBox="0 0 ${W} ${H}" class="rot-svg" role="img" aria-label="Sector rotation against the S&amp;P 500">
      ${tint("improving", pl, pt)}${tint("leading", pl + pw / 2, pt)}${tint("lagging", pl, pt + ph / 2)}${tint("weakening", pl + pw / 2, pt + ph / 2)}
      <rect x="${pl}" y="${pt}" width="${pw}" height="${ph}" fill="none" class="rot-box"/>
      <line x1="${X(100)}" x2="${X(100)}" y1="${pt}" y2="${pt + ph}" class="rot-axis"/><line x1="${pl}" x2="${pl + pw}" y1="${Y(100)}" y2="${Y(100)}" class="rot-axis"/>
      ${corner("improving", pl + 8, pt + 16, "start")}${corner("leading", pl + pw - 8, pt + 16, "end")}${corner("lagging", pl + 8, pt + ph - 8, "start")}${corner("weakening", pl + pw - 8, pt + ph - 8, "end")}`;
    const tick = dev > 12 ? 5 : dev > 5 ? 2 : 1;
    for (let v = Math.ceil((100 - dev) / tick) * tick; v <= 100 + dev; v += tick) {
      g += `<text x="${X(v)}" y="${pt + ph + 13}" text-anchor="middle" class="rot-ax">${v}</text><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end" class="rot-ax">${v}</text>`;
    }
    g += `<text x="${pl + pw / 2}" y="${H - 4}" text-anchor="middle" class="rot-ax">STRENGTH VS S&amp;P 500 (100 = IN LINE) →</text>
      <text transform="translate(10 ${pt + ph / 2}) rotate(-90)" text-anchor="middle" class="rot-ax">MOMENTUM (ABOVE 100 = GAINING) →</text>`;
    // selected sector last, so it sits on top
    for (const s of [...secs].sort((a, b) => (a.sym === M.sel) - (b.sym === M.sel))) {
      const n = s.pts.length, head = s.pts[n - 1], k = quad(head[1], head[2]), col = QUAD[k][0], on = s.sym === M.sel;
      for (let i = 1; i < n; i++) g += `<line x1="${X(s.pts[i - 1][1]).toFixed(1)}" y1="${Y(s.pts[i - 1][2]).toFixed(1)}" x2="${X(s.pts[i][1]).toFixed(1)}" y2="${Y(s.pts[i][2]).toFixed(1)}" stroke="${col}" stroke-width="${on ? 2.6 : 1.5}" stroke-linecap="round" opacity="${(0.18 + 0.82 * (i / (n - 1))).toFixed(2)}"/>`;
      for (let i = 0; i < n - 1; i++) g += `<circle cx="${X(s.pts[i][1]).toFixed(1)}" cy="${Y(s.pts[i][2]).toFixed(1)}" r="1.7" fill="${col}" opacity="${(0.25 + 0.6 * (i / (n - 1))).toFixed(2)}"/>`;
      const hx = X(head[1]), hy = Y(head[2]), left = hx > pl + pw - 44;
      g += `<g class="rot-dot${on ? " sel" : ""}" data-rot="${esc(s.sym)}"><circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${on ? 7 : 5.5}" fill="${col}"/>
        <text x="${(hx + (left ? -9 : 9)).toFixed(1)}" y="${(hy + 3.5).toFixed(1)}" text-anchor="${left ? "end" : "start"}" class="rot-lb">${esc(s.sym)}</text>
        <title>${esc(s.name)}: ${QUAD[k][1].toLowerCase()}, ${QUAD[k][2]} (strength ${head[1].toFixed(1)}, momentum ${head[2].toFixed(1)})</title></g>`;
    }
    g += "</svg>";
    const lists = Object.keys(QUAD).map((k) => {
      const names = secs.filter((s) => quad(s.pts[s.pts.length - 1][1], s.pts[s.pts.length - 1][2]) === k);
      return `<div class="rot-l"><b style="color:${QUAD[k][0]}">${QUAD[k][1]}</b><span class="dim">${QUAD[k][2]}</span><div>${names.length ? names.map((s) => `<button type="button" data-rot="${esc(s.sym)}"${s.sym === M.sel ? ' class="sel"' : ""}>${esc(s.name)}</button>`).join("") : `<span class="dim">none</span>`}</div></div>`;
    }).join("");
    return `<section class="msec"><h3>Sector rotation · against the S&amp;P 500, weekly
        <span class="mrange rot-tail" title="How many past weeks each tail shows">${[4, 8, 12].map((t) => `<button type="button" data-tail="${t}" aria-pressed="${t === M.tail}">${t}W</button>`).join("")}</span></h3>
      <div class="rot"><div class="rot-chart">${g}</div><div class="rot-side">${lists}
        <p class="dim">Each dot is a sector today and its tail is where it was in past weeks. Sectors usually travel clockwise: improving, leading, weakening, lagging.</p></div></div></section>`;
  }

  // ---------- correlation matrix ----------
  const WIN_WORDS = { "1M": "the last month", "3M": "the last 3 months", "1Y": "the last year" };
  const cfmt = (v) => (v == null ? "—" : (v < 0 ? "−" : "+") + Math.abs(v).toFixed(2));
  const cshort = (v) => (v == null ? "" : (v < 0 ? "−" : "") + Math.abs(v).toFixed(2).replace(/^0/, ""));
  const CORR_POS = [240, 138, 60], CORR_NEG = [43, 179, 192];
  /** Cell color: warm when two things move together, cool when they move opposite, dark near zero (returns [fill, ink]). */
  function corrColor(v) {
    if (v == null) return ["#0d1117", "var(--dimmer)"];
    const k = Math.min(1, Math.abs(v)) ** 0.85, t = v >= 0 ? CORR_POS : CORR_NEG, base = [20, 25, 33];
    return [`rgb(${base.map((c, i) => Math.round(c + (t[i] - c) * k)).join(",")})`, k > 0.55 ? "#0b0f14" : "var(--fg)"];
  }
  const corrWord = (v) => {
    const a = Math.abs(v);
    return a < 0.2 ? "moved almost independently" : v > 0 ? (a < 0.5 ? "loosely moved together" : a < 0.8 ? "usually moved together" : "moved almost in lockstep")
      : a < 0.5 ? "leaned in opposite directions" : "usually moved in opposite directions";
  };
  const corrSet = () => M.snap?.corr?.sets?.[M.cset] || M.snap?.corr?.sets?.assets || null;

  function corrSection(corr) {
    const set = corrSet(), cur = set?.by?.[M.cwin];
    if (!corr || !cur) return "";
    const L = set.labels, n = L.length, m = cur.m;
    const C = 44, lw = 104, th = 26, W = lw + n * C + 2, H = th + n * C + 2;
    const key = `${M.cset}.${M.cwin}`, anim = M.cmDrawn !== key; M.cmDrawn = key;
    let g = `<svg viewBox="0 0 ${W} ${H}" class="cm-svg${anim ? " cm-anim" : ""}" role="img" aria-label="Correlation matrix of daily moves">`;
    L.forEach(([sym, name], i) => {
      g += `<text x="${lw - 8}" y="${th + i * C + C / 2 + 4}" text-anchor="end" class="cm-lb" data-cl="r${i}">${esc(name)}</text>
        <text x="${lw + i * C + C / 2}" y="${th - 9}" text-anchor="middle" class="cm-lb cm-top" data-cl="c${i}">${esc(sym.replace("-USD", ""))}</text>`;
    });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = m[i][j], [fill, ink] = corrColor(i === j ? null : v), on = M.pair && ((M.pair[0] === L[i][0] && M.pair[1] === L[j][0]) || (M.pair[1] === L[i][0] && M.pair[0] === L[j][0]));
      const x = lw + j * C, y = th + i * C;
      g += i === j
        ? `<g class="cm-cell cm-diag" style="--d:${i + j}"><rect x="${x + 1}" y="${y + 1}" width="${C - 2}" height="${C - 2}" fill="${fill}"/><text x="${x + C / 2}" y="${y + C / 2 + 3.5}" text-anchor="middle" class="cm-dg">${esc(L[i][0].replace("-USD", ""))}</text></g>`
        : `<g class="cm-cell${on ? " sel" : ""}" style="--d:${i + j}" data-ci="${i}" data-cj="${j}"><rect x="${x + 1}" y="${y + 1}" width="${C - 2}" height="${C - 2}" fill="${fill}"/><text x="${x + C / 2}" y="${y + C / 2 + 3.5}" text-anchor="middle" class="cm-v" fill="${ink}">${cshort(v)}</text></g>`;
    }
    g += `<rect class="cm-band" data-band="r" x="${lw}" y="0" width="${n * C}" height="${C}" visibility="hidden"/><rect class="cm-band" data-band="c" x="0" y="${th}" width="${C}" height="${n * C}" visibility="hidden"/></svg>`;

    // the reading beside the matrix: one anchor (the selected pair's first leg, else the first row) against the rest, and what has changed lately
    const ai = Math.max(0, L.findIndex((x) => x[0] === M.pair?.[0])), others = L.map((x, j) => ({ sym: x[0], name: x[1], v: m[ai][j] })).filter((x, j) => j !== ai && x.v != null);
    const chip = (x, extra = "") => `<button type="button" data-pair="${esc(L[ai][0])},${esc(x.sym)}"><i style="background:${corrColor(x.v)[0]}"></i>${esc(x.name)} <b>${cfmt(x.v)}</b>${extra}</button>`;
    const withIt = [...others].sort((a, b) => b.v - a.v).slice(0, 3), against = [...others].sort((a, b) => a.v - b.v).slice(0, 3);
    const m1 = set.by["1M"]?.m, y1 = set.by["1Y"]?.m, shifts = [];
    if (m1 && y1) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (m1[i][j] != null && y1[i][j] != null) shifts.push({ i, j, d: m1[i][j] - y1[i][j], now: m1[i][j], was: y1[i][j] });
    shifts.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const shiftRows = shifts.slice(0, 4).map((x) => `<button type="button" data-pair="${esc(L[x.i][0])},${esc(L[x.j][0])}"><i style="background:${corrColor(x.now)[0]}"></i>${esc(L[x.i][1])} × ${esc(L[x.j][1])} <b>${cfmt(x.was)} → ${cfmt(x.now)}</b></button>`).join("");
    const scale = `<div class="cm-scale"><span>−1 opposite</span><i></i><span>+1 together</span></div>`;
    return `<section class="msec"><h3>How they move together · daily moves over ${WIN_WORDS[M.cwin]}
        <span class="mrange rot-tail">${[["assets", "Assets"], ["sectors", "Sectors"]].map(([k, l]) => `<button type="button" data-cset="${k}" aria-pressed="${k === M.cset}">${l}</button>`).join("")}
          <i class="cm-gap"></i>${corr.windows.map((w) => `<button type="button" data-cwin="${w}" aria-pressed="${w === M.cwin}">${w}</button>`).join("")}</span></h3>
      <div class="rot"><div class="rot-chart cm-chart">${g}<div class="cm-read dim" id="cmread">Hover a square for a reading · click it for the pair's history.</div></div>
        <div class="rot-side cm-side">${scale}
          <div class="rot-l"><b>Moves most with ${esc(L[ai][1])}</b><div>${withIt.map((x) => chip(x)).join("")}</div></div>
          <div class="rot-l"><b>Best offsets to ${esc(L[ai][1])}</b><div>${against.map((x) => chip(x)).join("")}</div></div>
          ${shiftRows ? `<div class="rot-l"><b>Biggest shifts</b><span class="dim">last year → last month</span><div class="cm-shifts">${shiftRows}</div></div>` : ""}
          <p class="dim">+1 means two things rose and fell on the same days; −1 means one rose when the other fell; near 0 they ignored each other. Holdings that all sit near +1 give little protection when one falls.</p></div></div></section>`;
  }

  /** Hovering a square: light its row and column and say what the number means. */
  function corrHover(cell) {
    const svg = $("#markets .cm-svg"), read = $("#cmread"), set = corrSet();
    if (!svg || !read || !set) return;
    const bands = svg.querySelectorAll(".cm-band");
    svg.querySelectorAll(".cm-lb.on").forEach((t) => t.classList.remove("on"));
    if (!cell) { bands.forEach((b) => b.setAttribute("visibility", "hidden")); read.textContent = "Hover a square for a reading · click it for the pair's history."; read.classList.add("dim"); return; }
    const i = +cell.dataset.ci, j = +cell.dataset.cj, C = 44, lw = 104, th = 26, L = set.labels, v = set.by[M.cwin].m[i][j];
    bands[0].setAttribute("y", th + i * C); bands[1].setAttribute("x", lw + j * C);
    bands.forEach((b) => b.setAttribute("visibility", "visible"));
    svg.querySelector(`[data-cl="r${i}"]`)?.classList.add("on"); svg.querySelector(`[data-cl="c${j}"]`)?.classList.add("on");
    read.classList.remove("dim");
    read.innerHTML = v == null ? `${esc(L[i][1])} × ${esc(L[j][1])}: not enough history yet.`
      : `<b>${esc(L[i][1])} × ${esc(L[j][1])}</b> <span style="color:${v >= 0 ? "#f08a3c" : "#2bb3c0"}">${cfmt(v)}</span> · ${corrWord(v)} over ${WIN_WORDS[M.cwin]}`;
  }

  function loadPair() {
    const [a, b] = M.pair || [];
    if (!a) return;
    api.page.invoke("markets:pair", a, b).then((p) => { if (M.pair && M.pair[0] === a && M.pair[1] === b) { M.pairData = p; renderDetail(); } });
  }
  function setPair(a, b) {
    M.pair = [a, b]; M.pairData = null; M.sel = null;
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    render(); renderDetail(); loadPair();
  }

  /** Rolling correlation through the year: warm above zero, cool below. */
  function rollSvg(pts) {
    const W = 400, H = 150, n = pts.length, X = (i) => (i / (n - 1 || 1)) * W, Y = (v) => H / 2 - v * (H / 2 - 6);
    const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
    const area = `0,${Y(0)} ${line} ${W},${Y(0)}`;
    return `<div class="mch cp-roll"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Rolling correlation">
      <defs><clipPath id="cpUp"><rect x="0" y="0" width="${W}" height="${Y(0)}"/></clipPath><clipPath id="cpDn"><rect x="0" y="${Y(0)}" width="${W}" height="${H - Y(0)}"/></clipPath></defs>
      ${[0.5, -0.5].map((v) => `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" vector-effect="non-scaling-stroke"/>`).join("")}
      <polygon points="${area}" fill="#f08a3c" opacity=".28" clip-path="url(#cpUp)"/><polygon points="${area}" fill="#2bb3c0" opacity=".28" clip-path="url(#cpDn)"/>
      <line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--dim)" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
      <polyline points="${line}" fill="none" stroke="var(--fg-strong)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>
      <span class="mchy t">+1</span><span class="mchy b">−1</span></div>
      <div class="mchx"><span>${day(pts[0][0])}</span><span>${day(pts[n - 1][0])}</span></div>`;
  }
  /** Each day's pair of moves as a dot, with the line of best fit. */
  function scatterSvg(dots, na, nb) {
    const W = 400, H = 250, lim = Math.max(0.5, ...dots.flatMap((d) => [Math.abs(d[0]), Math.abs(d[1])])) * 1.12;
    const X = (v) => W / 2 + (v / lim) * (W / 2), Y = (v) => H / 2 - (v / lim) * (H / 2);
    const k = dots.length, ma = dots.reduce((s, d) => s + d[0], 0) / k, mb = dots.reduce((s, d) => s + d[1], 0) / k;
    const va = dots.reduce((s, d) => s + (d[0] - ma) ** 2, 0), slope = va ? dots.reduce((s, d) => s + (d[0] - ma) * (d[1] - mb), 0) / va : 0;
    const fit = (x) => mb + slope * (x - ma), col = slope >= 0 ? "#f08a3c" : "#2bb3c0";
    return `<div class="mch cp-sc"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily moves of the two, one dot per day">
      <clipPath id="cpBox"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>
      <line x1="${W / 2}" x2="${W / 2}" y1="0" y2="${H}" stroke="var(--line-2)"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line-2)"/>
      <line x1="${X(-lim)}" y1="${Y(fit(-lim))}" x2="${X(lim)}" y2="${Y(fit(lim))}" stroke="${col}" stroke-width="1.6" stroke-dasharray="5 4" clip-path="url(#cpBox)"/>
      ${dots.map((d, i) => `<circle class="cp-dot" style="--d:${i}" cx="${X(d[0]).toFixed(1)}" cy="${Y(d[1]).toFixed(1)}" r="${i === k - 1 ? 4.5 : 2.8}" fill="${i === k - 1 ? "var(--fg-strong)" : col}" opacity="${(0.3 + 0.6 * (i / k)).toFixed(2)}"><title>${esc(na)} ${pct(d[0])}, ${esc(nb)} ${pct(d[1])}</title></circle>`).join("")}
      <text x="${W - 4}" y="${H / 2 - 5}" text-anchor="end" class="rot-ax">${esc(na.toUpperCase())} UP →</text><text x="${W / 2 + 5}" y="11" class="rot-ax">↑ ${esc(nb.toUpperCase())} UP</text>
      <text x="4" y="${H - 5}" class="rot-ax">±${lim.toFixed(1)}% A DAY</text></svg></div>`;
  }
  function pairDetailHtml() {
    const [a, b] = M.pair, corr = M.snap?.corr;
    const set = Object.values(corr?.sets || {}).find((s) => s.labels.some((x) => x[0] === a) && s.labels.some((x) => x[0] === b));
    if (!set) return `<div class="empty">No data for this pair yet.</div>`;
    const i = set.labels.findIndex((x) => x[0] === a), j = set.labels.findIndex((x) => x[0] === b), na = set.labels[i][1], nb = set.labels[j][1];
    const v = set.by[M.cwin]?.m[i][j], p = M.pairData;
    const rows = corr.windows.map((w) => { const x = set.by[w].m[i][j]; return `<tr${w === M.cwin ? ' class="cur"' : ""}><td>${w}</td><td style="color:${x == null ? "" : x >= 0 ? "#f08a3c" : "#2bb3c0"}">${cfmt(x)}</td><td class="dim cp-w">${x == null ? "" : corrWord(x)}</td></tr>`; }).join("");
    const slope = p?.dots?.length ? (() => { const k = p.dots.length, ma = p.dots.reduce((s, d) => s + d[0], 0) / k, mb = p.dots.reduce((s, d) => s + d[1], 0) / k, va = p.dots.reduce((s, d) => s + (d[0] - ma) ** 2, 0); return va ? p.dots.reduce((s, d) => s + (d[0] - ma) * (d[1] - mb), 0) / va : null; })() : null;
    return `<div class="msum"><h2>${esc(na)} × ${esc(nb)}</h2><div class="dim">${esc(a)} and ${esc(b)} · correlation of daily moves</div>
      <div class="cp-big" style="color:${v == null ? "var(--dim)" : v >= 0 ? "#f08a3c" : "#2bb3c0"}">${cfmt(v)}<small>${M.cwin}</small></div>
      <p>${v == null ? "Not enough history yet." : `Over ${WIN_WORDS[M.cwin]}, ${esc(na)} and ${esc(nb)} ${corrWord(v)}.`}${slope != null ? ` On a day ${esc(na)} moved 1%, ${esc(nb)} moved about ${pct(slope)} on average.` : ""}</p>
      <table class="mret"><tr class="hd"><th></th><th>Corr.</th><th></th></tr>${rows}</table>
      <h4>Rolling 3-month correlation</h4>${p?.rolling?.length > 1 ? rollSvg(p.rolling) : `<div class="dim mchl">${p ? "Not enough history yet." : "Loading…"}</div>`}
      <h4>Each day's moves · last 3 months</h4>${p?.dots?.length > 5 ? scatterSvg(p.dots, na, nb) : `<div class="dim mchl">${p ? "Not enough history yet." : "Loading…"}</div>`}
      <p class="dim">One dot per trading day (the white dot is the latest); the dashed line is the best fit. Correlation changes with the market's mood, and tends to jump toward +1 in a sell-off. Bitcoin's day ends at midnight UTC, so its readings are approximate.</p>
      <div class="cp-open"><button type="button" class="mopen" data-open="${esc(a)}">${esc(a)} chart ↗</button><button type="button" class="mopen" data-open="${esc(b)}">${esc(b)} chart ↗</button></div></div>`;
  }

  function render() {
    if (!M.visible) return;
    const s = M.snap;
    const bar = `<div class="mbar"><span class="mperiods">${(s?.periods || Object.keys(SCALE)).map((p, i) =>
      `<button type="button" data-per="${p}" data-k="${i + 1}" aria-pressed="${p === M.period}" title="Key ${i + 1}">${p}</button>`).join("")}</span>
      <span class="dim">${s?.fetchedAt ? "Updated " + new Date(s.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + (s.open ? " · market open" : " · market closed") : "Loading…"}</span>
      <button type="button" class="mref" data-ref title="Refresh now">↻</button></div>`;
    if (!s) { $("#markets").innerHTML = bar + window.WireUI.skeleton("tiles", { n: 30 }); return; }
    chrome();
    const sections = s.groups.map((g) => {
      let body;
      if (g.pairs) {
        body = `<div class="mgrid mpairs">${g.pairs.map((p) => {
          const a = ret(p.a[0]), b = ret(p.b[0]);
          const sp = a != null && b != null ? a - b : null;
          return `<div class="mpair"><div class="mpn">${esc(p.name)} <span class="${sp > 0 ? "up" : sp < 0 ? "dn" : "dim"}">${sp == null ? "" : (sp > 0 ? "+" : "") + sp.toFixed(2) + " pts"}</span></div>
            <div class="mpt">${tile(p.a[0], p.a[1])}${tile(p.b[0], p.b[1])}</div></div>`;
        }).join("")}</div>`;
      } else {
        const items = [...g.items].sort((x, y) => (ret(y[0]) ?? -1e9) - (ret(x[0]) ?? -1e9));
        body = `<div class="mgrid">${items.map((it) => tile(it[0], it[1], it[2])).join("")}</div>`;
      }
      return `<section class="msec"><h3>${esc(g.title)}</h3>${body}</section>` + (g.id === "sectors" ? rotationSection(s.rotation) : g.id === "assets" ? corrSection(s.corr) : "");
    }).join("");
    const errs = Object.keys(s.errors || {}).filter((k) => !s.data[k]);
    $("#markets").innerHTML = bar + sections + (errs.length ? `<div class="empty">No data for ${esc(errs.join(", "))}.</div>` : "");
  }

  function nameOf(sym) {
    for (const g of M.snap?.groups || []) {
      for (const it of g.items || []) if (it[0] === sym) return it[1];
      for (const p of g.pairs || []) for (const l of [p.a, p.b]) if (l[0] === sym) return l[1];
    }
    return sym;
  }

  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const num = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  function chartSvg(h, high) {
    const W = 400, H = 170;
    const xs = h.map((b) => b[0]), ys = h.map((b) => b[1]);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let lo = Math.min(...ys), hi = Math.max(...ys, high || 0);
    const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
    const X = (t) => ((t - x0) / (x1 - x0 || 1)) * W, Y = (v) => H - ((v - lo) / (hi - lo)) * H;
    const pts = h.map((b) => `${X(b[0]).toFixed(1)},${Y(b[1]).toFixed(1)}`).join(" ");
    const up = ys[ys.length - 1] >= ys[0], c = up ? "#3ecf8e" : "#f2706b";
    return `<div class="mch"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price history">
      <polygon points="0,${H} ${pts} ${W},${H}" fill="${c}" opacity=".13"/>
      ${high ? `<line x1="0" x2="${W}" y1="${Y(high).toFixed(1)}" y2="${Y(high).toFixed(1)}" stroke="#8b93ff" stroke-width="1" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ""}
      <polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>
      <span class="mchy t">${num(hi - pad)}</span><span class="mchy b">${num(lo + pad)}</span></div>
      <div class="mchx"><span>${day(x0)}</span><span>${day(x1)}</span></div>`;
  }

  function loadHistory() {
    const sym = M.sel, range = M.range;
    if (!sym) return;
    api.page.invoke("markets:history", sym, range).then((h) => {
      if (sym === M.sel && range === M.range) { M.hist = { sym, range, h }; renderDetail(); }
    });
  }

  function renderDetail() {
    const el = $("#mdetail");
    if (window.WireInstrument?.isOpen()) return;
    if (M.pair && !M.sel) { el.innerHTML = pairDetailHtml(); return; }
    const d = M.sel && M.snap?.data?.[M.sel];
    if (!d) { el.innerHTML = `<div class="empty">Select a tile to see its returns. Keys 1–9 switch the period; click a tile twice for the chart.</div>`; return; }
    const ann = (p) => (ANNUAL[p] ? pct(d.ann?.[p]) : "");
    const rows = (M.snap.periods || []).map((p) => `<tr${p === M.period ? ' class="cur"' : ""}><td>${p}</td><td class="${d.ret[p] > 0 ? "up" : d.ret[p] < 0 ? "dn" : ""}">${pct(d.ret[p])}</td>
      <td class="${d.ann?.[p] > 0 ? "up" : d.ann?.[p] < 0 ? "dn" : ""}">${ann(p)}</td></tr>`).join("");
    const hh = M.hist && M.hist.sym === M.sel && M.hist.range === M.range ? M.hist.h : null;
    el.innerHTML = `<div class="msum"><h2>${esc(nameOf(M.sel))}</h2><div class="dim">${esc(M.sel)} · ${num(d.last)} ${esc(d.currency || "")} · ${day(d.asOf)}</div>
      <h4>Returns</h4>
      <table class="mret"><tr class="hd"><th></th><th>Total</th><th>Per year</th></tr>${rows}</table>
      ${d.historyFrom ? `<div class="dim">History from ${day(d.historyFrom)}</div>` : ""}
      <p>52-week high ${num(d.high52)}${d.high52At ? ` <span class="dim">(${day(d.high52At)})</span>` : ""} · <span class="${d.fromHigh < -10 ? "dn" : ""}">${pct(d.fromHigh, 1)} from high</span></p>
      <h4>Price history</h4>
      <div class="mrange">${RANGES.map((r) => `<button type="button" data-range="${r}" aria-pressed="${r === M.range}">${r}</button>`).join("")}</div>
      ${hh && hh.length > 1 ? chartSvg(hh, d.high52) : `<div class="dim mchl">Loading…</div>`}
      <button type="button" class="mopen" data-open="${esc(M.sel)}">Open chart ↗</button></div>`;
    if (!hh && !M.histPending) { M.histPending = true; loadHistory(); setTimeout(() => (M.histPending = false), 300); }
  }

  function setPeriod(p) {
    if (!SCALE[p]) return;
    M.period = p;
    try { localStorage.setItem("wire.markets.period", p); } catch {}
    render(); renderDetail();
  }

  $("#markets").addEventListener("click", (e) => {
    const per = e.target.closest("[data-per]"); if (per) return setPeriod(per.dataset.per);
    if (e.target.closest("[data-ref]")) { api.page.invoke("markets:refresh").then((s) => { M.snap = s; render(); renderDetail(); }); return; }
    const tl = e.target.closest("[data-tail]");
    if (tl) { M.tail = +tl.dataset.tail; try { localStorage.setItem("wire.markets.tail", M.tail); } catch {} return render(); }
    const cs = e.target.closest("[data-cset]"), cw = e.target.closest("[data-cwin]");
    if (cs || cw) {
      if (cs) M.cset = cs.dataset.cset; else M.cwin = cw.dataset.cwin;
      try { localStorage.setItem("wire.markets.cset", M.cset); localStorage.setItem("wire.markets.cwin", M.cwin); } catch {}
      render(); renderDetail(); return;
    }
    const cell = e.target.closest(".cm-cell[data-ci]");
    if (cell) { const L = corrSet().labels; return setPair(L[+cell.dataset.ci][0], L[+cell.dataset.cj][0]); }
    const pr = e.target.closest("[data-pair]");
    if (pr) { const [a, b] = pr.dataset.pair.split(","); return setPair(a, b); }
    const rd = e.target.closest("[data-rot]");
    if (rd) { M.sel = rd.dataset.rot; M.pair = null; if (window.WireInstrument?.isOpen()) window.WireInstrument.close(); render(); renderDetail(); return; }
    const t = e.target.closest(".mtile"); if (!t) return;
    if (M.sel === t.dataset.sym && !window.WireInstrument?.isOpen()) return window.WireApp.openInstrument(t.dataset.sym);
    M.sel = t.dataset.sym; M.pair = null;
    if (window.WireInstrument?.isOpen()) window.WireInstrument.close();
    render(); renderDetail();
  });
  $("#markets").addEventListener("mouseover", (e) => { const c = e.target.closest(".cm-cell[data-ci]"); if (c) corrHover(c); else if (e.target.closest(".cm-svg")) corrHover(null); });
  $("#markets").addEventListener("mouseleave", () => corrHover(null));
  $("#mdetail").addEventListener("click", (e) => {
    const r = e.target.closest("[data-range]");
    if (r) { M.range = r.dataset.range; M.hist = null; M.histPending = false; renderDetail(); return; }
    const b = e.target.closest("[data-open]"); if (b) window.WireApp.openInstrument(b.dataset.open);
  });
  api.page.on("markets:update", (s) => { M.snap = s; render(); renderDetail(); });
  // terminal header: "US MARKET OPEN · REFRESH 15 MIN" and the data time
  function chrome() { const s = M.snap; if (!s) return; window.WireChrome?.pulled("markets", s.fetchedAt); window.WireChrome?.status("markets", `US MARKET ${s.open ? "OPEN" : "CLOSED"}`); }

  (window.WirePages ||= {}).markets = {
    show() {
      M.visible = true; render(); renderDetail();
      api.page.invoke("markets:get").then((s) => { M.snap = s; render(); renderDetail(); });
    },
    hide() { M.visible = false; },
    key(e) {
      const p = Object.keys(SCALE)[+e.key - 1];
      if (p && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setPeriod(p); }
      else if (e.key === "Enter" && M.sel) window.WireApp.openInstrument(M.sel);
    },
    restore() { renderDetail(); },
    detail: () => $("#mdetail")
  };
})();
