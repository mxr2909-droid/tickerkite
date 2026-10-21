/* Tickerkite instrument view: price chart over a chosen range, 1st/2nd derivative momentum, stats,
   and the headlines behind the biggest moves. Renders into the right-hand detail pane. */
(() => {
  const api = window.wire;
  const RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y"];
  const RANGE_NAME = { "1D": "today", "5D": "5 days", "1M": "1 month", "3M": "3 months", "6M": "6 months", YTD: "year to date", "1Y": "1 year", "5Y": "5 years" };
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const I = { sym: null, range: "1M", data: null, news: null, err: null, loading: false, newsLoading: false, timer: null, seq: 0, el: null, onStory: null, onClose: null };
  try { I.range = localStorage.getItem("wire.inst.range") || "1M"; if (!RANGES.includes(I.range)) I.range = "1M"; } catch {}

  // ---------- formatting ----------
  const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
  function fmtPx(v, type) {
    if (v == null || !Number.isFinite(v)) return "—";
    if (type === "yld") return v.toFixed(3) + "%";
    if (type === "fx") return v.toFixed(v > 20 ? 2 : 4);
    return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtRet(r, type, dp = 2) {
    if (r == null || !Number.isFinite(r)) return "—";
    return type === "yld" ? `${sign(r)}${Math.abs(r).toFixed(1)}bp` : `${sign(r)}${Math.abs(r).toFixed(dp)}%`;
  }
  function fmtChg(st, type) {
    if (!st) return "—";
    if (type === "yld") return `${sign(st.chg)}${Math.abs(st.chg * 100).toFixed(1)}bp`;
    return `${sign(st.chg)}${fmtPx(Math.abs(st.chg), type)} (${sign(st.pct)}${Math.abs(st.pct).toFixed(2)}%)`;
  }
  const fmtNum = (v, dp = 2) => `${sign(v)}${Math.abs(v).toFixed(dp)}`;
  const ord = (n) => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

  // exchange-local time labels
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function lt(t) { return new Date(t + (I.data?.meta?.gmtoffset || 0) * 1000); }
  const hm = (d) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  function axisLabel(t) {
    const d = lt(t), k = I.data.cfg.kind;
    if (k === "intra") return hm(d);
    if (k === "intra5") return `${DOW[d.getUTCDay()]} ${d.getUTCDate()}`;
    if (k === "weekly") return `${MON[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
    return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  function tipLabel(t) {
    const d = lt(t), k = I.data.cfg.kind;
    if (k === "intra" || k === "intra5") return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()} · ${hm(d)}`;
    if (k === "weekly") return `Week of ${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }
  function moveLabel(m) {
    const k = I.data.cfg.kind;
    if (k === "intra") return m.gap ? "Open vs prior close" : `${hm(lt(m.t))}–${hm(lt(m.end))}`;
    const d = new Date(m.day + "T12:00:00Z");
    if (k === "weekly") return `Week to ${MON[d.getUTCMonth()]} ${d.getUTCDate()} '${String(d.getUTCFullYear()).slice(2)}`;
    return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  const barWord = () => ({ intra: "5-min bar", intra5: "30-min bar", daily: "day", weekly: "week" }[I.data.cfg.kind]);
  const moveWord = () => ({ intra: "half-hour windows", intra5: "days", daily: "days", weekly: "weeks" }[I.data.cfg.kind]);

  // ---------- data ----------
  async function load(force = false) {
    const seq = ++I.seq;
    I.loading = !I.data || I.data.range !== I.range || I.data.sym !== I.sym;
    if (I.loading) { I.news = null; render(); }
    const r = await api.getInstrument(I.sym, I.range, force);
    if (seq !== I.seq || !I.sym) return;
    I.loading = false;
    if (!r.ok) { I.err = r.error; if (!I.data || I.data.sym !== I.sym || I.data.range !== I.range) I.data = null; render(); return; }
    I.err = null;
    const changedView = !I.data || I.data.sym !== r.data.sym || I.data.range !== r.data.range;
    I.data = r.data;
    render();
    if (changedView || I.data.cfg.kind === "intra" || !I.news) loadNews(seq);
    schedule();
  }
  async function loadNews(seq) {
    I.newsLoading = true;
    renderNews();
    const r = await api.getInstrumentNews(I.sym, I.range);
    if (seq !== I.seq) return;
    I.newsLoading = false;
    I.news = r.ok ? r : { error: r.error, moves: [], live: [] };
    renderNews();
  }
  function schedule() {
    clearTimeout(I.timer);
    if (!I.sym || !I.data) return;
    I.timer = setTimeout(() => { if (!document.hidden) load(); else schedule(); }, I.data.cfg.refreshMs);
  }

  // ---------- render ----------
  function render() {
    const el = I.el;
    if (!el || !I.sym) return;
    const d = I.data && I.data.sym === I.sym ? I.data : null;
    const type = d?.type || "idx";
    const st = d?.stats;
    const head = `
      <div class="ih"><span class="isym">${esc(I.sym)}</span><span class="inm">${esc(d?.label || "")}</span>
        <button type="button" class="iclose" data-act="close" title="Back to story (Esc)">× CLOSE</button></div>
      <div class="ipx num"><b>${fmtPx(d?.meta?.last ?? st?.last, type)}</b>
        <span class="${st ? (st.chg >= 0 ? "up" : "dn") : "dim"}">${st ? fmtChg(st, type) : ""}</span>
        <span class="dim">${I.range === "1D" ? "vs prior close" : RANGE_NAME[I.range]}</span></div>
      <div class="rtabs" role="tablist">${RANGES.map((r) => `<button type="button" role="tab" data-range="${r}" aria-selected="${r === I.range}">${r}</button>`).join("")}
        <span class="upd num">${d ? "Updated " + new Date(d.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>`;
    if (I.loading || (!d && !I.err)) { el.innerHTML = `<div class="inst">${head}<div class="iload">Loading ${esc(I.range)} history…</div></div>`; return; }
    if (!d) { el.innerHTML = `<div class="inst">${head}<div class="iload">Couldn't load prices: ${esc(I.err)}. Tickerkite will try again; check your connection.</div></div>`; schedule(); return; }

    el.innerHTML = `<div class="inst">${head}
      <div class="chart" id="ichart"><div class="tip" id="itip" hidden></div></div>
      ${d.moves?.length ? `<div class="ihint">Click a numbered circle to jump to its headlines below ↓</div>` : ""}
      ${momentumBlock(d)}
      <div class="isec">KEY NUMBERS · ${esc(RANGE_NAME[I.range]).toUpperCase()}</div>
      ${statsBlock(d)}
      <div id="icomp"></div>
      <div id="inews"></div>
      <p class="ifoot">Prices are delayed (Yahoo Finance). Headlines are matched to moves by date and topic; they show what the market was reacting to, not proof of cause.</p>
    </div>`;
    drawChart();
    window.WireCompany?.mount(document.getElementById("icomp"), I.sym);
    renderNews();
  }

  function momentumBlock(d) {
    const m = d.momentum;
    if (!m) return "";
    const type = d.type, u = type === "yld" ? "bp" : "%";
    const per = m.unitVel.split("/")[1];
    const rate = Math.abs(m.vNow);
    const dp = rate < 0.1 ? 3 : 2;
    const accelUp = m.aNow > 0;
    let sentence;
    if (m.tone === "flat" || m.regime.startsWith("Flat")) sentence = `Price is roughly flat right now${m.regime.includes("up") ? ", with momentum starting to build upward" : m.regime.includes("down") ? ", with momentum starting to tilt lower" : ""}.`;
    else if (m.vNow > 0) sentence = `Price is rising about ${rate.toFixed(dp)}${u} per ${per}, and the move is ${accelUp ? "speeding up" : "slowing down"}.`;
    else sentence = `Price is falling about ${rate.toFixed(dp)}${u} per ${per}, and the decline is ${accelUp ? "slowing down" : "speeding up"}.`;
    const turn = m.turn ? ` Velocity last flipped ${m.turn.dir === "up" ? "positive" : "negative"} ${axisLabel(m.turn.t)}.` : "";
    return `<div class="mom ${m.tone}">
      <div class="reg">${esc(m.regime)}</div>
      <p class="msent">${sentence}</p>
      <div class="mgrid num">
        <span class="ml">VELOCITY</span><b class="${m.vNow >= 0 ? "up" : "dn"}">${fmtNum(m.vNow, dp)} ${m.unitVel}</b><span class="dim">${rankWords(m.velPct, I.range === "1D" ? "today" : "in " + esc(RANGE_NAME[I.range]))}</span>
        <span class="ml">ACCELERATION</span><b class="${m.aNow >= 0 ? "up" : "dn"}">${fmtNum(m.aNow, m.aNow !== 0 && Math.abs(m.aNow) < 0.01 ? 4 : 3)} ${m.unitAcc}</b><span class="dim">${rankWords(m.accPct, I.range === "1D" ? "today" : "in " + esc(RANGE_NAME[I.range]))}</span>
      </div>
      <p class="mexp">Velocity is the first derivative: how fast the smoothed price is moving. Acceleration is the second derivative: whether that speed is building or fading. Smoothed over ${m.smooth} ${barWord()}s.${turn}</p>
    </div>`;
  }

  function statsBlock(d) {
    const st = d.stats, type = d.type;
    if (!st) return "";
    const rows = [
      ["CHANGE", `<span class="${st.chg >= 0 ? "up" : "dn"}">${fmtChg(st, type)}</span>`],
      ["HIGH / LOW", `${fmtPx(st.hi, type)} / ${fmtPx(st.lo, type)}`],
      ["IN RANGE", `${Math.round(st.pos * 100)}% <span class="pbar"><i style="left:${(st.pos * 100).toFixed(1)}%"></i></span>`],
      ["VOLATILITY", `${st.vol.toFixed(1)}${type === "yld" ? "bp" : "%"} <span class="dim">annualized</span>`],
      [type === "yld" ? "MAX PULLBACK" : "DRAWDOWN", `<span class="dn">${fmtRet(st.maxDD, type, 2)}</span> <span class="dim">${axisLabel(st.ddPeak)} → ${axisLabel(st.ddTrough)}</span>`],
      ["BEST " + barWord().toUpperCase(), `<span class="up">${fmtRet(st.best.v, type)}</span> <span class="dim">${axisLabel(st.best.t)}</span>`],
      ["WORST " + barWord().toUpperCase(), `<span class="dn">${fmtRet(st.worst.v, type)}</span> <span class="dim">${axisLabel(st.worst.t)}</span>`],
      ["UP " + barWord().toUpperCase() + "S", `${Math.round(st.upShare * 100)}% <span class="dim">of ${st.bars}</span>`]
    ];
    if (st.fromHigh52 != null) rows.push(["VS 52W HIGH", `${fmtRet(st.fromHigh52, type, 1)} <span class="dim">${fmtPx(d.meta.high52, type)}</span>`]);
    if (st.fromLow52 != null) rows.push(["VS 52W LOW", `${fmtRet(st.fromLow52, type, 1)} <span class="dim">${fmtPx(d.meta.low52, type)}</span>`]);
    if (st.avgVol > 0 && d.cfg.kind === "daily") rows.push(["VOLUME", `${(st.lastVol / st.avgVol).toFixed(2)}× <span class="dim">avg for range</span>`]);
    return `<dl class="istats num">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  }

  function renderNews() {
    const box = I.el?.querySelector("#inews");
    if (!box || !I.data) return;
    const d = I.data, type = d.type;
    const moves = d.moves || [];
    const nm = new Map((I.news?.moves || []).map((x) => [x.n, x]));
    const c = d.contribution;
    const contrib = c && moves.length
      ? `<p class="icon">These ${moves.length} ${moveWord()} add up to <b class="${c.fromMoves >= 0 ? "up" : "dn"}">${fmtRet(c.fromMoves, type)}</b>; the whole ${esc(RANGE_NAME[I.range])} change is <b class="${c.total >= 0 ? "up" : "dn"}">${fmtRet(c.total, type)}</b>.</p>`
      : "";
    const moveHtml = moves.map((m) => {
      const n = nm.get(m.n);
      let hl;
      if (!n) hl = I.newsLoading ? `<div class="hnone">Searching headlines…</div>` : `<div class="hnone">—</div>`;
      else if (n.error) hl = `<div class="hnone">Couldn't search news for this ${d.cfg.kind === "weekly" ? "week" : "day"} (${esc(n.error)}).</div>`;
      else if (!n.headlines.length) hl = `<div class="hnone">${d.cfg.kind === "intra" ? "No matching headline in the Tickerkite feed around this time." : "No matching headlines found."}</div>`;
      else hl = n.headlines.map((h) => `<button type="button" class="hl" data-url="${esc(h.link)}"><span class="c">${esc(h.code)}</span><span class="t">${esc(h.title)}</span></button>`).join("");
      return `<div class="mv" data-n="${m.n}"><div class="mvh num"><button type="button" class="mk" data-act="chart" title="Back up to the chart">${m.n}</button><span class="md">${esc(moveLabel(m))}</span>
        <span class="mr ${m.ret >= 0 ? "up" : "dn"}">${fmtRet(m.ret, type)}</span><span class="mz" title="Size versus a typical ${barWord()} in this range">${Math.abs(m.z).toFixed(1)}σ</span></div>${hl}</div>`;
    }).join("");

    const live = I.news?.live || [];
    const liveHtml = live.length
      ? live.map((s) => `<button type="button" class="hl" data-story="${esc(s.id)}" data-url="${esc(s.link)}"><span class="c">${esc(s.code)}</span><span class="t">${s.sev === "h" ? '<span class="badge hi">HI</span>' : ""}${esc(s.title)}</span><span class="w num">${new Date(s.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span></button>`).join("")
      : `<div class="hnone">${I.newsLoading ? "Checking the feed…" : "Nothing in the current Tickerkite feed mentions this market."}</div>`;

    box.innerHTML = `
      <div class="isec">WHAT MOVED IT · ${moves.length} BIGGEST ${moveWord().toUpperCase()}</div>
      ${contrib}
      ${I.news?.error ? `<div class="hnone">Couldn't load headlines: ${esc(I.news.error)}</div>` : ""}
      ${moveHtml || '<div class="hnone">Not enough data for this range yet.</div>'}
      <div class="isec">LATEST IN THE FEED · ${esc(d.label).toUpperCase()}</div>
      ${liveHtml}`;
  }

  // ---------- chart ----------
  function niceStep(span, target = 4) {
    const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  // axis labels only need as many decimals as the grid step
  function axisPx(v, step, type) {
    if (type === "yld") return v.toFixed(step < 0.01 ? 3 : 2) + "%";
    const dp = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 4;
    return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function rankWords(p, span) {
    if (p <= 2) return `lowest reading ${span}`;
    if (p >= 98) return `highest reading ${span}`;
    return `${ord(p)} percentile ${span}`;
  }
  function drawChart() {
    const box = I.el?.querySelector("#ichart");
    if (!box || !I.data) return;
    const d = I.data, pts = d.points, type = d.type, m = d.momentum;
    const n = pts.length;
    const old = box.querySelector("svg"); if (old) old.remove();
    if (n < 2) { box.insertAdjacentHTML("afterbegin", `<div class="iload">Not enough price data for this range.</div>`); return; }

    const W = Math.max(300, box.clientWidth), padL = 4, padR = 62;
    const P1 = { top: 8, h: 176 }, P2 = { top: P1.top + P1.h + 24, h: 52 }, P3 = { top: 0, h: 52 };
    P3.top = P2.top + P2.h + 24;
    const H = P3.top + P3.h + 22;
    const plotW = W - padL - padR;
    const x = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);

    const base = d.stats?.base ?? pts[0].c;
    let lo = Math.min(...pts.map((p) => p.c)), hi = Math.max(...pts.map((p) => p.c));
    if (d.cfg.kind === "intra" && d.meta.prevClose) { lo = Math.min(lo, d.meta.prevClose); hi = Math.max(hi, d.meta.prevClose); }
    const padY = (hi - lo || hi * 0.01) * 0.1; lo -= padY; hi += padY;
    const y = (v) => P1.top + (1 - (v - lo) / (hi - lo)) * P1.h;
    const up = pts.at(-1).c >= base;
    const UP = css("--up") || "#3ecf8e", DN = css("--down") || "#f2706b", DIM = "#8c93a1", GRID = "rgba(255,255,255,.07)", ORG = "#8b93ff", CY = "#7cc4f5";
    const col = up ? UP : DN;

    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="isvg" role="img" aria-label="${esc(d.label)} ${I.range} price, velocity and acceleration">`;
    // price grid + labels
    const step = niceStep(hi - lo);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const yy = y(v).toFixed(1);
      s += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${GRID}"/><text x="${W - padR + 6}" y="${(+yy + 3.5).toFixed(1)}" fill="${DIM}" font-size="10">${esc(axisPx(v, step, type))}</text>`;
    }
    if (d.cfg.kind === "intra" && d.meta.prevClose) {
      const yy = y(d.meta.prevClose).toFixed(1);
      s += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${DIM}" stroke-dasharray="3 3"/><text x="${padL + 2}" y="${(+yy - 4).toFixed(1)}" fill="${DIM}" font-size="9">PRIOR CLOSE</text>`;
    }
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
    s += `<polygon points="${x(0).toFixed(1)},${P1.top + P1.h} ${line} ${x(n - 1).toFixed(1)},${P1.top + P1.h}" fill="${col}" fill-opacity=".10"/>`;
    s += `<polyline points="${line}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>`;
    // last price tag
    const ly = y(pts.at(-1).c);
    s += `<circle cx="${x(n - 1).toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${col}"/>`;
    s += `<rect x="${W - padR + 2}" y="${(ly - 8).toFixed(1)}" width="${padR - 4}" height="16" fill="${col}"/><text x="${W - padR + 6}" y="${(ly + 4).toFixed(1)}" fill="#000" font-size="10" font-weight="700">${esc(fmtPx(pts.at(-1).c, type))}</text>`;
    // big-move markers
    const idxAt = (t) => { let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const dd = Math.abs(pts[i].t - t); if (dd < bd) { bd = dd; best = i; } } return best; };
    const markers = [];
    for (const mv of d.moves || []) {
      const i = idxAt(mv.end);
      const px = x(i), py = y(pts[i].c);
      const cy = Math.max(P1.top + 9, Math.min(P1.top + P1.h - 9, py + (mv.ret >= 0 ? -16 : 16)));
      s += `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${py.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${ORG}" stroke-width="1"/>`;
      markers.push({ n: mv.n, mv, px, cy });
      s += `<circle class="mkc" data-n="${mv.n}" cx="${px.toFixed(1)}" cy="${cy.toFixed(1)}" r="8" fill="${ORG}" stroke="#fff" stroke-width="0"/><text x="${px.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" fill="#1a0d00" font-size="10" font-weight="700">${mv.n}</text>`;
    }

    // derivative panels
    const panel = (P, arr, label, unit, kind) => {
      const mx = Math.max(...arr.map((v) => Math.abs(v))) || 1;
      const yz = P.top + P.h / 2;
      const yv = (v) => yz - (v / mx) * (P.h / 2 - 2);
      let o = `<text x="${padL}" y="${P.top - 7}" fill="${DIM}" font-size="9.5" letter-spacing=".06em">${label}</text>`;
      o += `<rect x="${padL}" y="${P.top}" width="${plotW}" height="${P.h}" fill="rgba(255,255,255,.02)"/>`;
      o += `<line x1="${padL}" x2="${W - padR}" y1="${yz}" y2="${yz}" stroke="${DIM}" stroke-opacity=".5"/>`;
      if (kind === "bars") {
        const bw = Math.max(1, (plotW / n) * 0.72);
        for (let i = 0; i < n; i++) {
          const v = arr[i], yy = yv(v);
          o += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${Math.min(yy, yz).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(yy - yz)).toFixed(1)}" fill="${v >= 0 ? UP : DN}" fill-opacity=".85"/>`;
        }
      } else {
        const l = arr.map((v, i) => `${x(i).toFixed(1)},${yv(v).toFixed(1)}`).join(" ");
        o += `<polygon points="${x(0).toFixed(1)},${yz} ${l} ${x(n - 1).toFixed(1)},${yz}" fill="${CY}" fill-opacity=".14"/><polyline points="${l}" fill="none" stroke="${CY}" stroke-width="1.4"/>`;
      }
      const now = arr.at(-1);
      o += `<text x="${W - padR + 6}" y="${(yv(now) + 3.5).toFixed(1)}" fill="${now >= 0 ? UP : DN}" font-size="10">${fmtNum(now, Math.abs(now) < 0.01 ? 4 : Math.abs(now) < 0.1 ? 3 : 2)}</text>`;
      o += `<text x="${W - padR + 6}" y="${P.top + P.h + 10}" fill="${DIM}" font-size="8.5">${unit}</text>`;
      return o;
    };
    if (m) {
      s += panel(P2, m.vel, "VELOCITY · 1ST DERIVATIVE", m.unitVel, "bars");
      s += panel(P3, m.acc, "ACCELERATION · 2ND DERIVATIVE", m.unitAcc, "line");
    }
    // x labels
    const ticks = Math.min(5, n);
    for (let k = 0; k < ticks; k++) {
      const i = Math.round((k / (ticks - 1 || 1)) * (n - 1));
      const anchor = k === 0 ? "start" : k === ticks - 1 ? "end" : "middle";
      s += `<text x="${x(i).toFixed(1)}" y="${H - 6}" fill="${DIM}" font-size="10" text-anchor="${anchor}">${esc(axisLabel(pts[i].t))}</text>`;
    }
    // crosshair + hit area
    s += `<line id="ixh" x1="0" x2="0" y1="${P1.top}" y2="${P3.top + P3.h}" stroke="#fff" stroke-opacity=".35" visibility="hidden"/>`;
    s += `<circle id="ixd" r="3.5" fill="#fff" visibility="hidden"/>`;
    s += `<rect id="ihit" x="${padL}" y="0" width="${plotW}" height="${H}" fill="transparent"/>`;
    s += `</svg>`;
    box.insertAdjacentHTML("afterbegin", s);

    const svg = box.querySelector("svg"), xh = svg.querySelector("#ixh"), xd = svg.querySelector("#ixd"), tip = box.querySelector("#itip");
    const hit = svg.querySelector("#ihit");
    const markerAt = (e) => {
      const r = svg.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * W, my = ((e.clientY - r.top) / r.height) * H;
      return markers.find((k) => Math.hypot(k.px - mx, k.cy - my) <= 12) || null;
    };
    const ring = (n) => svg.querySelectorAll(".mkc").forEach((c) => c.setAttribute("stroke-width", +c.dataset.n === n ? "2" : "0"));
    hit.addEventListener("click", (e) => { const k = markerAt(e); if (k) jumpToMove(k.n); });
    hit.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * W;
      const k = markerAt(e);
      hit.style.cursor = k ? "pointer" : "crosshair";
      ring(k ? k.n : 0);
      if (k) {
        const nm = (I.news?.moves || []).find((x) => x.n === k.n);
        const top = nm?.headlines?.[0];
        xh.setAttribute("visibility", "hidden"); xd.setAttribute("visibility", "hidden");
        tip.innerHTML = `<div class="tt">MOVE ${k.n} · ${esc(moveLabel(k.mv))}</div>
          <div><b class="${k.mv.ret >= 0 ? "up" : "dn"}">${fmtRet(k.mv.ret, type)}</b> <span class="dim">${Math.abs(k.mv.z).toFixed(1)}σ</span></div>
          <div class="th">${top ? `<span class="c">${esc(top.code)}</span> ${esc(top.title)}` : I.newsLoading ? "Searching headlines…" : "No matching headline"}</div>
          <div class="dim">Click for all headlines ↓</div>`;
        tip.hidden = false;
        const left = (k.px / W) * r.width;
        tip.style.left = (left > r.width * 0.55 ? left - tip.offsetWidth - 14 : left + 14) + "px";
        tip.style.top = Math.max(4, (k.cy / H) * r.height - 20) + "px";
        return;
      }
      const i = Math.max(0, Math.min(n - 1, Math.round(((mx - padL) / plotW) * (n - 1))));
      const p = pts[i], px = x(i);
      xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("visibility", "visible");
      xd.setAttribute("cx", px); xd.setAttribute("cy", y(p.c)); xd.setAttribute("visibility", "visible");
      const chg = type === "yld" ? (p.c - base) * 100 : (p.c / base - 1) * 100;
      tip.innerHTML = `<div class="tt">${esc(tipLabel(p.t))}</div>
        <div><b>${esc(fmtPx(p.c, type))}</b> <span class="${chg >= 0 ? "up" : "dn"}">${fmtRet(chg, type)}</span></div>
        ${m ? `<div class="dim">vel <span class="${m.vel[i] >= 0 ? "up" : "dn"}">${fmtNum(m.vel[i], 3)}</span> · acc <span class="${m.acc[i] >= 0 ? "up" : "dn"}">${fmtNum(m.acc[i], 4)}</span></div>` : ""}`;
      tip.hidden = false;
      const left = (px / W) * r.width;
      tip.style.left = (left > r.width * 0.6 ? left - tip.offsetWidth - 12 : left + 12) + "px";
      tip.style.top = "8px";
    });
    hit.addEventListener("mouseleave", () => { xh.setAttribute("visibility", "hidden"); xd.setAttribute("visibility", "hidden"); tip.hidden = true; ring(0); });
  }

  /** Scroll the "What moved it" list to a move and flash it. */
  function jumpToMove(n) {
    const row = I.el?.querySelector(`.mv[data-n="${n}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
  }

  // ---------- public ----------
  function open(sym, el) {
    I.el = el;
    if (I.sym !== sym) { I.data = null; I.news = null; I.err = null; }
    I.sym = sym;
    document.querySelectorAll(".q[data-sym]").forEach((q) => q.classList.toggle("on", q.dataset.sym === sym));
    render();
    load();
  }
  function close() {
    clearTimeout(I.timer);
    I.sym = null; I.seq++;
    document.querySelectorAll(".q[data-sym]").forEach((q) => q.classList.remove("on"));
  }
  function setRange(r) {
    if (!RANGES.includes(r) || r === I.range) return;
    I.range = r;
    try { localStorage.setItem("wire.inst.range", r); } catch {}
    load();
  }

  document.addEventListener("click", (e) => {
    if (!I.sym || !I.el || !I.el.contains(e.target)) return;
    const rb = e.target.closest("[data-range]"); if (rb) { setRange(rb.dataset.range); return; }
    if (e.target.closest("[data-act=close]")) { I.onClose?.(); return; }
    if (e.target.closest("[data-act=chart]")) { I.el.scrollTo({ top: 0, behavior: "smooth" }); return; }
    const st = e.target.closest("[data-story]");
    if (st && I.onStory?.(st.dataset.story)) return;
    const u = e.target.closest("[data-url]"); if (u) api?.open(u.dataset.url);
  });
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => I.sym && drawChart(), 120); });

  window.WireInstrument = {
    open, close, setRange,
    isOpen: () => !!I.sym,
    current: () => I.sym,
    cycleRange: (dir) => { const i = RANGES.indexOf(I.range); setRange(RANGES[(i + dir + RANGES.length) % RANGES.length]); },
    set onStory(fn) { I.onStory = fn; },
    set onClose(fn) { I.onClose = fn; }
  };
})();
