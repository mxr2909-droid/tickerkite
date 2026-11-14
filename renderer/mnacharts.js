/* M&A page charts (window.TkMnaCharts). renderer/mna.js owns the page and calls render(el, ctx) after each change:
   ctx = { snap, F, deals (in the chosen window), prev (the window before), all (every date, other filters applied),
           now, selected, select(id), setFilter(patch) }.
   Seven cards, all drawn as SVG at the card's real width:
     pulse     where today's pace sits inside its own three-year range
     flow      new deals (or disclosed value) per month, by type, with closings reported in 8-Ks
     bubbles   every deal in the window by date and size
     gap       open offers: the gap between the offer price and the stock price (only when there are any)
     sizes     the size mix against the period before
     heat      sectors × quarters
     spend     cash paid for acquisitions by all SEC filers, by year (not filtered) */
(() => {
  const S = window.TkMnaStats;
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SECTOR_COL = { Technology: "#5ec2f2", "Health care": "#3ecf8e", Financials: "#f2b34a", "Real estate": "#e88ac0", Industrials: "#8b93ff", Consumer: "#f08a3c",
    Energy: "#f2706b", Materials: "#d9c27a", "Communication & media": "#b48cf2", Utilities: "#58d0c0", "SPACs & shells": "#6b7280", Other: "#9aa6b6" };
  const TYPE_COL = { Merger: "#5ec2f2", "Tender offer": "#f2b34a", "Going private": "#e88ac0", "SPAC merger": "#6b7280" };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monLabel = (m, long) => `${MON[+m.slice(5, 7) - 1]} ${long ? m.slice(0, 4) : "’" + m.slice(2, 4)}`;
  const dayLabel = (iso) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const pctTxt = (v) => (v == null ? "" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}%`);

  const C = { el: null, ctx: null, mode: "count", key: "", tips: {}, ro: null, lastW: 0 };
  try { C.mode = localStorage.getItem("wire.mna.chartmode") === "value" ? "value" : "count"; } catch {}

  // ---------- pulse: today's pace inside its own three-year range ----------
  function pulse(ctx) {
    const months = ctx.snap.months.slice(0, -1); // the month in progress is left out: it always looks slow
    if (months.length < 15) return "";
    const rows = S.monthly(ctx.all, months);
    const sized = ctx.all.filter((d) => d.value != null);
    const med = months.map((m, i) => {
      if (i < 5) return null;
      const from = months[i - 5], vals = sized.filter((d) => d.date.slice(0, 7) >= from && d.date.slice(0, 7) <= m).map((d) => d.value);
      return vals.length >= 5 ? S.median(vals) : null;
    });
    const close = ctx.snap.closings.slice(0, -1).map(([, v]) => ({ v }));
    const metrics = [
      ["New deals a month", S.trailing(rows, "n"), (v) => v.toFixed(1), "3-month average"],
      ["Disclosed value a month", S.trailing(rows, "value"), (v) => S.money(v), "3-month average"],
      ["Deals of $1B+ a month", S.trailing(rows, "big"), (v) => v.toFixed(1), "3-month average"],
      ["Typical (median) deal size", med, (v) => S.money(v), "last 6 months"],
      ["Closings reported, all sectors", close.every((c) => c.v != null) ? S.trailing(close, "v") : [], (v) => Math.round(v).toLocaleString(), "8-K filings a month, 3-month average"]
    ];
    const out = [];
    for (const [name, series, fmt, note] of metrics) {
      const xs = series.filter((v) => v != null);
      if (xs.length < 12 || !(Math.max(...xs) > 0)) continue; // nothing to place yet (sizes not read)
      const cur = xs[xs.length - 1], ago = xs[xs.length - 13] ?? null, lo = Math.min(...xs), hi = Math.max(...xs);
      const rank = Math.round((xs.filter((v) => v <= cur).length / xs.length) * 100);
      out.push({ name, note, cur, ago, lo, hi, rank, fmt, pos: hi > lo ? (cur - lo) / (hi - lo) : 0.5, agoPos: ago != null && hi > lo ? (ago - lo) / (hi - lo) : null });
    }
    if (!out.length) return "";
    const lead = out[0], word = lead.rank >= 75 ? "busy" : lead.rank <= 25 ? "quiet" : "about normal";
    const dir = lead.ago ? (lead.cur - lead.ago) / lead.ago : null;
    const scope = [ctx.F.sector, ctx.F.industry, ctx.F.type, ctx.F.size ? S.SIZES.find((s) => s[0] === ctx.F.size)?.[1] : ""].filter(Boolean).join(" · ");
    const read = `${scope ? esc(scope) + ": deal" : "Deal"}-making is <b class="pl-${word === "busy" ? "hot" : word === "quiet" ? "cold" : "mid"}">${word}</b> for the last three years: ${lead.fmt(lead.cur)} new deals a month lately, higher than in ${lead.rank}% of that stretch`
      + (dir == null ? "." : Math.abs(dir) < 0.08 ? ", and about the same as a year ago." : `, and ${dir > 0 ? "up" : "down"} ${Math.abs(dir * 100).toFixed(0)}% from a year ago.`);
    const rowsHtml = out.map((m) => `<div class="pl-row" title="${esc(m.name)}: ${m.fmt(m.cur)} now${m.ago != null ? `, ${m.fmt(m.ago)} a year ago` : ""}; three-year range ${m.fmt(m.lo)} to ${m.fmt(m.hi)}">
        <span class="pl-n">${esc(m.name)}<em>${esc(m.note)}</em></span><b>${m.fmt(m.cur)}</b>
        <span class="pl-bar"><i class="pl-fill" style="width:${(m.pos * 100).toFixed(1)}%"></i>${m.agoPos != null ? `<i class="pl-ago" style="left:${(m.agoPos * 100).toFixed(1)}%"></i>` : ""}<i class="pl-now" style="left:${(m.pos * 100).toFixed(1)}%"></i></span>
        <span class="pl-r">${m.rank >= 75 ? "high" : m.rank <= 25 ? "low" : "mid"} · ${m.rank}%</span></div>`).join("");
    return `<div class="mac-card mac-wide"><div class="mac-h"><b>Market pulse</b><span class="dim">where today sits inside its own three-year range</span></div>
      <p class="pl-read">${read}</p>
      <div class="pl"><div class="pl-row pl-head"><span></span><b>Now</b><span class="pl-ends"><span>3-year low</span><span>3-year high</span></span><span class="pl-r">Rank</span></div>${rowsHtml}</div>
      <p class="mac-note"><i class="pl-key now"></i>now &nbsp; <i class="pl-key ago"></i>a year ago. The month in progress is left out.${ctx.snap.sizing?.active ? " Deal sizes are still being read, so the value rows will rise." : ""}</p></div>`;
  }

  // ---------- flow: deals or value per month ----------
  function flow(ctx, W) {
    const months = ctx.snap.months, rows = S.monthly(ctx.all, months), n = months.length;
    if (!n) return "";
    const value = C.mode === "value", H = 270, pl = 40, pr = 44, pt = 16, pb = 26, pw = W - pl - pr, ph = H - pt - pb, band = pw / n, bw = Math.max(2, band * 0.72);
    const { from, to } = S.span(ctx.F, ctx.now), inWin = (m) => m >= from.slice(0, 7) && m <= to.slice(0, 7);
    const vals = rows.map((r) => (value ? r.value : r.n)), max = Math.max(1, ...vals) * 1.12;
    const X = (i) => pl + i * band + band / 2, Y = (v) => pt + (1 - v / max) * ph;
    const avg = S.trailing(rows, value ? "value" : "n");
    const cl = ctx.snap.closings.map(([, v]) => v), hasCl = cl.some((v) => v != null), clMax = Math.max(1, ...cl.filter((v) => v != null)) * 1.15, YC = (v) => pt + (1 - v / clMax) * ph;
    let g = `<svg viewBox="0 0 ${W} ${H}" class="mac-svg" role="img" aria-label="${value ? "Disclosed deal value" : "New deals"} per month">`;
    const step = niceStep(max, 4);
    for (let v = 0; v <= max; v += step) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="mac-grid"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end" class="mac-ax">${value ? S.money(v, 0).replace("$0K", "0") : v}</text>`;
    const cstep = niceStep(clMax, 4);
    for (let v = cstep; hasCl && v <= clMax; v += cstep) g += `<text x="${W - pr + 6}" y="${YC(v) + 3}" class="mac-ax mac-ax2">${v}</text>`;
    rows.forEach((r, i) => {
      const dim = inWin(r.m) ? "" : " off", part = i === n - 1 ? " part" : "", x = X(i) - bw / 2;
      if (value) g += `<rect class="mac-bar${dim}${part}" style="--d:${i}" x="${x.toFixed(1)}" y="${Y(r.value).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0) - Y(r.value)).toFixed(1)}" fill="var(--accent)"/>`;
      else {
        let base = 0;
        for (const t of S.TYPES) { const c = r.byType[t] || 0; if (!c) continue; g += `<rect class="mac-bar${dim}${part}" style="--d:${i}" x="${x.toFixed(1)}" y="${Y(base + c).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(base) - Y(base + c)).toFixed(1)}" fill="${TYPE_COL[t]}"/>`; base += c; }
      }
      if (value && r.big) g += `<text x="${X(i).toFixed(1)}" y="${(Y(r.value) - 4).toFixed(1)}" text-anchor="middle" class="mac-ax${dim}">${r.big}</text>`;
      const every = band < 14 ? 6 : band < 26 ? 3 : 2, mo = +r.m.slice(5, 7);
      if ((mo - 1) % every === 0) g += `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="mac-ax${mo === 1 ? " strong" : ""}">${mo === 1 ? r.m.slice(0, 4) : MON[mo - 1]}</text>`;
    });
    const line = (ys, yf, cls) => { const p = ys.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${yf(v).toFixed(1)}`)).filter(Boolean); return p.length > 1 ? `<polyline points="${p.join(" ")}" class="${cls}" fill="none"/>` : ""; };
    g += line(cl.map((v, i) => (i === n - 1 ? null : v)), YC, "mac-close") + line(avg.map((v, i) => (i === n - 1 ? null : v)), Y, "mac-avg");
    rows.forEach((r, i) => { g += `<rect class="mac-hit" data-tip="flow" data-i="${i}" x="${(pl + i * band).toFixed(1)}" y="${pt}" width="${band.toFixed(1)}" height="${ph}"/>`; });
    g += "</svg>";
    C.tips.flow = rows.map((r, i) => {
      const types = S.TYPES.filter((t) => r.byType[t]).map((t) => `<span><i style="background:${TYPE_COL[t]}"></i>${plural(r.byType[t], t.toLowerCase())}</span>`).join("");
      return `<b>${monLabel(r.m, true)}${i === n - 1 ? " (so far)" : ""}</b><div>${plural(r.n, "new deal")} · ${S.money(r.value)} disclosed${r.big ? ` · ${r.big} of $1B+` : ""}</div><div class="tt-types">${types}</div>${cl[i] != null ? `<div class="dim">${cl[i].toLocaleString()} closings reported, all sectors</div>` : ""}<div class="dim">Click to show only this month</div>`;
    });
    C.tips.flowMonths = months;
    const legend = (value ? `<span><i style="background:var(--accent)"></i>Disclosed value</span><span class="dim">number above a bar = deals of $1B+</span>`
      : S.TYPES.filter((t) => rows.some((r) => r.byType[t])).map((t) => `<span><i style="background:${TYPE_COL[t]}"></i>${t}</span>`).join(""))
      + `<span><i class="ln avg"></i>3-month average</span>${hasCl ? `<span><i class="ln close"></i>Closings reported (right scale)</span>` : ""}`;
    return `<div class="mac-card mac-wide"><div class="mac-h"><b>${value ? "Deal value by month" : "New deals by month"}</b><span class="dim">three years · the lit months are your date frame</span>
        <span class="mac-tog"><button type="button" data-mode="count" aria-pressed="${!value}">Deals</button><button type="button" data-mode="value" aria-pressed="${value}">Value</button></span></div>
      ${g}<div class="mac-leg">${legend}</div>
      <p class="mac-note">A deal is counted in the month of its first SEC filing, usually days to weeks after it is announced. Closings are 8-Ks reporting a completed acquisition or sale of assets, across all sectors, so they include deals for private companies and lag announcements by months.</p></div>`;
  }

  // ---------- bubbles: every deal in the window ----------
  function bubbles(ctx, W) {
    const ds = ctx.deals;
    if (!ds.length) return "";
    const H = 340, pl = 46, pr = 14, pt = 14, pb = 40, pw = W - pl - pr, ph = H - pt - pb;
    const { from, to } = S.span(ctx.F, ctx.now), t0 = Date.parse(from), t1 = Date.parse(to) + 864e5;
    const sized = ds.filter((d) => d.value != null).sort((a, b) => b.value - a.value).slice(0, 700), blind = ds.filter((d) => d.value == null);
    const lo = 1e7, hi = Math.max(1e11, ...sized.map((d) => d.value * 2));
    const X = (iso) => pl + ((Date.parse(iso) - t0) / (t1 - t0 || 1)) * pw, Y = (v) => pt + (1 - (Math.log10(Math.max(lo, v)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * ph;
    const R = (v) => Math.min(38, 2.6 + 9 * Math.sqrt(v / 1e10));
    let g = `<svg viewBox="0 0 ${W} ${H}" class="mac-svg" role="img" aria-label="Each deal by date and size">`;
    for (let v = lo; v <= hi; v *= 10) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="mac-grid"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end" class="mac-ax">${S.money(v, 0)}</text>`;
    // month ticks along the bottom
    const span = (t1 - t0) / 864e5, every = span > 800 ? 6 : span > 400 ? 3 : span > 150 ? 2 : 1;
    for (let d = new Date(Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth() + 1, 1)); d.getTime() < t1; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const mo = d.getUTCMonth();
      if (mo % every) continue;
      const x = pl + ((d.getTime() - t0) / (t1 - t0)) * pw;
      g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${pt}" y2="${pt + ph}" class="mac-grid v"/><text x="${x.toFixed(1)}" y="${pt + ph + 30}" text-anchor="middle" class="mac-ax${mo === 0 ? " strong" : ""}">${mo === 0 ? d.getUTCFullYear() : MON[mo]}</text>`;
    }
    const med = S.median(sized.map((d) => d.value));
    if (med) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(med)}" y2="${Y(med)}" class="mac-med"/><text x="${pl + 4}" y="${Y(med) - 4}" class="mac-lb">typical deal ${S.money(med)}</text>`;
    const tipOf = {};
    const tip = (d) => { tipOf[d.id] = `<b>${esc(d.target.name)}${d.target.tickers[0] ? ` <span class="dim">${esc(d.target.tickers[0])}</span>` : ""}</b><div>${d.value != null ? S.money(d.value) : "Size not disclosed"}${d.price ? ` · $${d.price.toLocaleString()} a share` : ""}</div>
      <div>${d.acquirers[0] ? "Buyer: " + esc(d.acquirers[0].name) : esc(d.type)}</div><div class="dim">${esc(d.sector)} · ${esc(d.type)} · ${dayLabel(d.date)}</div>`; };
    blind.slice(0, 600).forEach((d) => { tip(d); g += `<circle class="mac-dot blind${d.id === ctx.selected ? " sel" : ""}" data-tip="deal" data-d="${esc(d.id)}" cx="${X(d.date).toFixed(1)}" cy="${pt + ph + 9}" r="2.4" fill="${SECTOR_COL[d.sector] || "#9aa6b6"}"/>`; });
    sized.forEach((d, i) => { tip(d); g += `<circle class="mac-dot${d.id === ctx.selected ? " sel" : ""}" style="--d:${Math.min(60, i)}" data-tip="deal" data-d="${esc(d.id)}" cx="${X(d.date).toFixed(1)}" cy="${Y(d.value).toFixed(1)}" r="${R(d.value).toFixed(1)}" fill="${SECTOR_COL[d.sector] || "#9aa6b6"}"/>`; });
    // name the biggest few, flipping the label to the left near the right edge
    const placed = [];
    sized.slice(0, 14).forEach((d) => {
      if (placed.length >= (W > 700 ? 7 : 4)) return;
      const x = X(d.date), r = R(d.value), left = x > W - pr - 150, y = Y(d.value), w = Math.min(22, d.target.name.length) * 6.2 + 6;
      const box = { x0: left ? x - r - 4 - w : x + r + 4, x1: left ? x - r - 4 : x + r + 4 + w, y0: y - 8, y1: y + 6 };
      if (box.x0 < pl || placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) return; // skip a name that would sit on another
      placed.push(box);
      g += `<text x="${(x + (left ? -r - 4 : r + 4)).toFixed(1)}" y="${(Y(d.value) + 3.5).toFixed(1)}" text-anchor="${left ? "end" : "start"}" class="mac-lb">${esc(d.target.name.length > 22 ? d.target.name.slice(0, 21) + "…" : d.target.name)}</text>`;
    });
    g += "</svg>";
    C.tips.deal = tipOf;
    const present = [...new Set(ds.map((d) => d.sector))].sort((a, b) => ds.filter((d) => d.sector === b).length - ds.filter((d) => d.sector === a).length);
    return `<div class="mac-card mac-wide"><div class="mac-h"><b>Every deal in your date frame</b><span class="dim">${plural(sized.length, "deal")} with a disclosed size${blind.length ? ` · ${blind.length} without, along the bottom` : ""} · click one to open it</span></div>
      ${g}<div class="mac-leg">${present.map((s) => `<button type="button" data-sector="${esc(s)}"${ctx.F.sector === s ? ' class="on"' : ""}><i style="background:${SECTOR_COL[s] || "#9aa6b6"}"></i>${esc(s)}</button>`).join("")}</div>
      <p class="mac-note">Higher is bigger, and the scale multiplies: each line is ten times the one below. A circle's area is the deal's size.</p></div>`;
  }

  // ---------- gap: open offers against their offer price (merger-arbitrage spread) ----------
  const gapTxt = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
  const usd = (v) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  function gap(ctx, W) {
    const all = S.spreads(ctx.deals);
    if (!all.length) return "";
    const MAX = 24, ds = all.slice(0, MAX), sum = S.spreadSummary(ctx.deals);
    const rh = 22, pt = 18, pb = 24, H = pt + ds.length * rh + pb, lw = Math.min(240, Math.max(130, W * 0.3)), rw = W > 560 ? 64 : 0;
    const vs = ds.map((d) => d.spread), lo0 = Math.min(0, ...vs), hi0 = Math.max(S.SPREAD_BANDS.tight + 1, ...vs);
    const step = niceStep(hi0 - lo0, W > 560 ? 6 : 4), lo = Math.floor(lo0 / step) * step, hi = Math.ceil(hi0 / step) * step;
    // room for the percent beside the dot: on the right of a gap, and on the left of a negative one
    const x0 = lw + (lo < 0 ? 46 : 8), x1 = W - rw - 48, X = (v) => x0 + ((v - lo) / (hi - lo || 1)) * (x1 - x0);
    let g = `<svg viewBox="0 0 ${W} ${H}" class="mac-svg mac-gap" role="img" aria-label="Gap between the offer price and the stock price for each open offer">`;
    g += `<rect class="mac-gband" x="${X(0).toFixed(1)}" y="${pt}" width="${(X(Math.min(hi, S.SPREAD_BANDS.tight)) - X(0)).toFixed(1)}" height="${ds.length * rh}"/>`;
    for (let v = lo; v <= hi + step / 2; v += step) {
      const x = X(v).toFixed(1), t = +v.toFixed(6);
      g += `<line x1="${x}" x2="${x}" y1="${pt}" y2="${pt + ds.length * rh}" class="mac-grid v"/><text x="${x}" y="${H - 8}" text-anchor="middle" class="mac-ax">${t > 0 ? "+" : t < 0 ? "−" : ""}${Math.abs(t)}%</text>`;
    }
    g += `<line x1="${X(0).toFixed(1)}" x2="${X(0).toFixed(1)}" y1="${pt - 4}" y2="${pt + ds.length * rh}" class="mac-gzero"/><text x="${X(0).toFixed(1)}" y="${pt - 7}" text-anchor="middle" class="mac-ax strong">offer price</text>`;
    if (rw) g += `<text x="${W - 2}" y="${pt - 7}" text-anchor="end" class="mac-ax">size</text>`;
    const tipOf = {};
    ds.forEach((d, i) => {
      const y = pt + i * rh, cy = y + rh / 2, v = d.spread, k = S.spreadKey(v), xv = X(v), xz = X(0), r = S.spreadRead(v), tk = d.target.tickers[0] || "";
      const room = Math.max(6, Math.floor((lw - 14 - tk.length * 6.6) / 6.3)), nm = d.target.name.length > room ? d.target.name.slice(0, room - 1) + "…" : d.target.name;
      tipOf[d.id] = `<b>${esc(d.target.name)}${tk ? ` <span class="dim">${esc(tk)}</span>` : ""}</b>${d.acquirers[0] ? `<div>Buyer: ${esc(d.acquirers[0].name)}</div>` : ""}
        <div>Offer ${usd(d.price)} · last price ${usd(d.last)}</div><div>Gap to the offer: <b class="g-${k}">${gapTxt(v)}</b>${d.value != null ? ` · ${S.money(d.value)} deal` : ""}</div><div class="dim">${esc(r.text)}</div>`;
      g += `<g class="mac-gr k-${k}${d.id === ctx.selected ? " sel" : ""}" data-tip="gap" data-d="${esc(d.id)}" style="--d:${i}">
        <rect class="mac-ghit" x="0" y="${y}" width="${W}" height="${rh}" rx="3"/>
        <text x="${lw - 8}" y="${cy + 3.5}" text-anchor="end" class="mac-glb">${esc(nm)}${tk ? `<tspan class="mac-gtk" dx="5">${esc(tk)}</tspan>` : ""}</text>
        <line class="mac-gstem" x1="${xz.toFixed(1)}" x2="${xv.toFixed(1)}" y1="${cy}" y2="${cy}" style="transform-origin:${xz.toFixed(1)}px ${cy}px"/>
        <circle class="mac-gdot" cx="${xv.toFixed(1)}" cy="${cy}" r="4.5"/>
        <text x="${(xv + (v < 0 ? -9 : 9)).toFixed(1)}" y="${cy + 3.5}" text-anchor="${v < 0 ? "end" : "start"}" class="mac-gv">${gapTxt(v)}</text>
        ${rw && d.value != null ? `<text x="${W - 2}" y="${cy + 3.5}" text-anchor="end" class="mac-ax">${S.money(d.value)}</text>` : ""}</g>`;
    });
    g += "</svg>";
    C.tips.gap = tipOf;
    const med = sum.median, parts = [];
    if (sum.tight) parts.push(`${sum.tight} trade${sum.tight === 1 ? "s" : ""} within 2% of the offer`);
    if (sum.some) parts.push(`${sum.some} ${sum.some === 1 ? "has a gap" : "have gaps"} of 2–8%`);
    if (sum.wide) parts.push(`${sum.wide} ${sum.wide === 1 ? "has a gap" : "have gaps"} above 8%`);
    if (sum.over) parts.push(`${sum.over} trade${sum.over === 1 ? "s" : ""} above ${sum.over === 1 ? "its" : "their"} offer`);
    const read = `${plural(sum.n, "open offer")}: the typical gap is ${med < 0 ? "−" : ""}${Math.abs(med).toFixed(1)}%. ${parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0]}.`;
    return `<div class="mac-card mac-wide"><div class="mac-h"><b>Open offers: gap to the offer price</b><span class="dim">${all.length > MAX ? `showing the ${MAX} widest of ${all.length}` : "deals in progress, widest gap first"} · click one to open it</span></div>
      <p class="pl-read">${esc(read)}</p>${g}
      <div class="mac-leg"><span><i class="k-tight"></i>Within 2%: expected to close</span><span><i class="k-some"></i>2–8%: some doubt or a long wait</span><span><i class="k-wide"></i>Above 8%: doubt</span><span><i class="k-over"></i>Above the offer: a higher bid expected</span></div>
      <p class="mac-note">The gap is (offer − last price) ÷ last price: what a buyer today makes if the deal closes at the offer, before costs. Offer prices come from the SEC fee exhibit; cash-and-stock deals and deals with price adjustments can show a misleading gap.</p></div>`;
  }

  // ---------- sizes: this period against the one before ----------
  function sizes(ctx, W) {
    const a = S.sizeHist(ctx.deals), b = S.sizeHist(ctx.prev), na = a.reduce((s, x) => s + x.n, 0), nb = b.reduce((s, x) => s + x.n, 0);
    if (na < 3) return `<div class="mac-card"><div class="mac-h"><b>How big the deals are</b></div><p class="mac-note">Not enough deals with a disclosed size in this date frame yet.</p></div>`;
    const H = 240, pl = 34, pr = 8, pt = 18, pb = 36, pw = W - pl - pr, ph = H - pt - pb, band = pw / a.length, bw = Math.min(34, band * 0.34);
    const sa = a.map((x) => (x.n / na) * 100), sb = b.map((x) => (nb ? (x.n / nb) * 100 : 0)), max = Math.max(10, ...sa, ...sb) * 1.18, Y = (v) => pt + (1 - v / max) * ph;
    let g = `<svg viewBox="0 0 ${W} ${H}" class="mac-svg" role="img" aria-label="Share of deals in each size step, now and in the period before">`;
    for (let v = 0; v <= max; v += niceStep(max, 4)) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="mac-grid"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end" class="mac-ax">${v}%</text>`;
    a.forEach((x, i) => {
      const cx = pl + i * band + band / 2;
      if (nb) g += `<rect class="mac-bar" style="--d:${i * 2}" x="${(cx - bw - 1).toFixed(1)}" y="${Y(sb[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0) - Y(sb[i])).toFixed(1)}" fill="#55607a"><title>Period before: ${plural(b[i].n, "deal")} (${sb[i].toFixed(0)}%)</title></rect>`;
      g += `<rect class="mac-bar" style="--d:${i * 2 + 1}" x="${(cx + 1).toFixed(1)}" y="${Y(sa[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0) - Y(sa[i])).toFixed(1)}" fill="var(--accent)"><title>This period: ${plural(x.n, "deal")} (${sa[i].toFixed(0)}%)</title></rect>
        <text x="${(cx + 1 + bw / 2).toFixed(1)}" y="${(Y(sa[i]) - 4).toFixed(1)}" text-anchor="middle" class="mac-ax strong">${x.n}</text>
        <text x="${cx.toFixed(1)}" y="${H - 18}" text-anchor="middle" class="mac-ax">${esc(x.label)}</text>`;
    });
    g += "</svg>";
    const bigA = sa.slice(3).reduce((s, v) => s + v, 0), bigB = sb.slice(3).reduce((s, v) => s + v, 0);
    const read = !nb ? "" : Math.abs(bigA - bigB) < 4 ? "The mix of small and large deals is about the same as in the period before."
      : `Deals of $1B and up are ${bigA.toFixed(0)}% of those with a known size, ${bigA > bigB ? "up" : "down"} from ${bigB.toFixed(0)}% in the period before: the market has shifted toward ${bigA > bigB ? "larger" : "smaller"} deals.`;
    return `<div class="mac-card"><div class="mac-h"><b>How big the deals are</b><span class="dim">share of deals with a known size</span></div>${g}
      <div class="mac-leg"><span><i style="background:var(--accent)"></i>This period (${na})</span>${nb ? `<span><i style="background:#55607a"></i>The period before (${nb})</span>` : ""}</div>
      <p class="mac-note">${read} The number on each bar is how many deals.</p></div>`;
  }

  // ---------- heat: sectors × quarters ----------
  function heat(ctx, W) {
    const nq = W < 430 ? 8 : 12, quarters = S.quarterKeys(nq, ctx.now), rows = S.sectorQuarters(ctx.all, quarters), value = C.mode === "value";
    if (!rows.length) return "";
    const lw = Math.min(150, W * 0.3), tw = 34, cw = (W - lw - tw) / nq, ch = 24, th = 22, H = th + rows.length * ch + 4;
    const cell = (r, i) => (value ? r.value[i] : r.n[i]), max = Math.max(1, ...rows.flatMap((r) => quarters.map((_, i) => cell(r, i))));
    let g = `<svg viewBox="0 0 ${W} ${H}" class="mac-svg" role="img" aria-label="Deals by sector and quarter">`;
    quarters.forEach((q, i) => { g += `<text x="${(lw + i * cw + cw / 2).toFixed(1)}" y="${th - 8}" text-anchor="middle" class="mac-ax${q.endsWith("Q1") ? " strong" : ""}">${q.endsWith("Q1") || i === 0 ? "’" + q.slice(2, 4) + " " : ""}${q.slice(5)}${i === nq - 1 ? "*" : ""}</text>`; });
    g += `<text x="${W - 2}" y="${th - 8}" text-anchor="end" class="mac-ax">all</text>`;
    rows.forEach((r, j) => {
      const y = th + j * ch, col = SECTOR_COL[r.sector] || "#9aa6b6", on = ctx.F.sector === r.sector;
      g += `<text x="${lw - 8}" y="${y + ch / 2 + 3.5}" text-anchor="end" class="mac-rowlb${on ? " on" : ""}" data-sector="${esc(r.sector)}">${esc(r.sector)}</text>`;
      quarters.forEach((q, i) => {
        const v = cell(r, i), k = v ? 0.14 + 0.86 * Math.sqrt(v / max) : 0;
        g += `<g class="mac-cell" data-sector="${esc(r.sector)}" data-q="${q}"><rect style="--d:${i + j}" x="${(lw + i * cw + 1).toFixed(1)}" y="${y + 1}" width="${(cw - 2).toFixed(1)}" height="${ch - 2}" fill="${v ? col : "var(--surface-2)"}" opacity="${v ? k.toFixed(2) : 1}"/>
          ${v && cw > 26 ? `<text x="${(lw + i * cw + cw / 2).toFixed(1)}" y="${y + ch / 2 + 3.5}" text-anchor="middle" class="mac-cv">${value ? S.money(v, 0).replace("$", "") : v}</text>` : ""}
          <title>${esc(r.sector)}, ${q}: ${plural(r.n[i], "deal")}, ${S.money(r.value[i])} disclosed. Click to show them.</title></g>`;
      });
      g += `<text x="${W - 2}" y="${y + ch / 2 + 3.5}" text-anchor="end" class="mac-ax strong">${value ? S.money(r.value.reduce((s, v) => s + v, 0), 0).replace("$", "") : r.total}</text>`;
    });
    g += "</svg>";
    // which sector has gained the most ground: its share of deals in the last four quarters against the four before
    const share = (r, a, b) => { const tot = rows.reduce((s, x) => s + x.n.slice(a, b).reduce((p, v) => p + v, 0), 0); return tot ? (r.n.slice(a, b).reduce((p, v) => p + v, 0) / tot) * 100 : 0; };
    const moves = nq >= 8 ? rows.map((r) => ({ s: r.sector, d: share(r, nq - 4, nq) - share(r, nq - 8, nq - 4), now: share(r, nq - 4, nq) })).sort((a, b) => b.d - a.d) : [];
    const up = moves[0], dn = moves[moves.length - 1];
    const read = up && up.d >= 2 ? `${esc(up.s)} has gained the most ground: ${up.now.toFixed(0)}% of deals in the last four quarters, up ${up.d.toFixed(0)} points on the four before.${dn && dn.d <= -2 ? ` ${esc(dn.s)} has lost the most (down ${Math.abs(dn.d).toFixed(0)} points).` : ""}` : "";
    return `<div class="mac-card"><div class="mac-h"><b>Where the deals are</b><span class="dim">${value ? "disclosed value" : "new deals"} by sector and quarter · click to filter</span></div>${g}
      <p class="mac-note">${read} Darker means more. *Quarter in progress.</p></div>`;
  }

  // ---------- spend: cash paid for acquisitions, by year ----------
  function spend(ctx, W) {
    const ys = ctx.snap.spend || [];
    if (ys.length < 3) return "";
    const H = 230, pl = 44, pr = 34, pt = 14, pb = 24, pw = W - pl - pr, ph = H - pt - pb, band = pw / ys.length, bw = band * 0.66;
    const max = Math.max(...ys.map((y) => y.total)) * 1.12, bmax = Math.max(1, ...ys.map((y) => y.big)) * 1.2, Y = (v) => pt + (1 - v / max) * ph, YB = (v) => pt + (1 - v / bmax) * ph;
    let g = `<svg viewBox="0 0 ${W} ${H}" class="mac-svg" role="img" aria-label="Cash paid for acquisitions by year">`;
    for (let v = 0; v <= max; v += niceStep(max, 4)) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="mac-grid"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end" class="mac-ax">${S.money(v, 0).replace("$0K", "0")}</text>`;
    ys.forEach((y, i) => {
      const cx = pl + i * band + band / 2;
      g += `<rect class="mac-bar" style="--d:${i}" x="${(cx - bw / 2).toFixed(1)}" y="${Y(y.total).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0) - Y(y.total)).toFixed(1)}" fill="${i === ys.length - 1 ? "var(--accent)" : "#4f6f96"}"><title>${y.year}: ${S.money(y.total)} by ${y.n.toLocaleString()} companies; ${y.big} spent $1B or more. Largest: ${esc(y.top.slice(0, 3).map((t) => `${t.name} ${S.money(t.val)}`).join(", "))}</title></rect>`;
      if (band > 26 || i % 2 === 0) g += `<text x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle" class="mac-ax">${band > 34 ? y.year : "’" + String(y.year).slice(2)}</text>`;
    });
    g += `<polyline points="${ys.map((y, i) => `${(pl + i * band + band / 2).toFixed(1)},${YB(y.big).toFixed(1)}`).join(" ")}" class="mac-avg" fill="none"/>`;
    ys.forEach((y, i) => { g += `<circle cx="${(pl + i * band + band / 2).toFixed(1)}" cy="${YB(y.big).toFixed(1)}" r="2.6" fill="#fff"/>`; });
    for (let v = niceStep(bmax, 3); v <= bmax; v += niceStep(bmax, 3)) g += `<text x="${W - pr + 6}" y="${YB(v) + 3}" class="mac-ax mac-ax2">${v}</text>`;
    g += "</svg>";
    const last = ys[ys.length - 1], prev = ys[ys.length - 2], peak = ys.reduce((a, b) => (b.total > a.total ? b : a));
    const ch = prev.total ? ((last.total - prev.total) / prev.total) * 100 : null;
    return `<div class="mac-card"><div class="mac-h"><b>What companies spend on acquisitions</b><span class="dim">cash paid by every SEC filer, by fiscal year · not filtered</span></div>${g}
      <div class="mac-leg"><span><i style="background:#4f6f96"></i>Cash paid for acquisitions</span><span><i class="ln avg"></i>Companies spending $1B+ (right scale)</span></div>
      <p class="mac-note">${last.year}: ${S.money(last.total)}${ch == null ? "" : `, ${pctTxt(ch)} on ${prev.year}`}${peak.year !== last.year ? `; the peak was ${S.money(peak.total)} in ${peak.year}` : ", the highest on record here"}. Largest in ${last.year}: ${esc(last.top.slice(0, 4).map((t) => `${t.name} (${S.money(t.val)})`).join(", "))}. This counts completed deals when the cash goes out, including purchases of private companies, so it runs behind announcements. Deals paid in shares are not in it.</p></div>`;
  }

  /** A round step that gives about `n` ticks up to `max`. */
  function niceStep(max, n) {
    const raw = max / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
    return +((f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p).toPrecision(6);
  }

  // ---------- drawing and events ----------
  function draw(animate) {
    const el = C.el, ctx = C.ctx;
    if (!el || !ctx?.snap) return;
    const W = Math.max(320, el.clientWidth || 800), two = W >= 880, wide = W - 30, half = two ? (W - 12) / 2 - 30 : wide;
    C.lastW = W; C.tips = {};
    if (!ctx.snap.deals?.length) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="mac${animate ? " mac-anim" : ""}${two ? " two" : ""}">${pulse(ctx)}${flow(ctx, wide)}${bubbles(ctx, wide)}${gap(ctx, wide)}${sizes(ctx, half)}${heat(ctx, half)}${two ? "" : ""}${spend(ctx, two ? wide : half)}</div><div class="mac-tip" hidden></div>`;
  }

  function showTip(e, html) {
    const tip = C.el.querySelector(".mac-tip");
    if (!tip) return;
    if (!html) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    const box = C.el.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top, w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(box.width - w - 4, x + 14)) + "px";
    tip.style.top = Math.max(4, y - h - 12 < 4 ? y + 18 : y - h - 12) + "px";
  }

  function bind(el) {
    el.addEventListener("mousemove", (e) => {
      const t = e.target.closest?.("[data-tip]");
      if (!t) return showTip(e, null);
      showTip(e, t.dataset.tip === "flow" ? C.tips.flow?.[+t.dataset.i] : t.dataset.tip === "gap" ? C.tips.gap?.[t.dataset.d] : C.tips.deal?.[t.dataset.d]);
    });
    el.addEventListener("mouseleave", (e) => showTip(e, null));
    el.addEventListener("click", (e) => {
      const ctx = C.ctx;
      if (!ctx) return;
      const m = e.target.closest("[data-mode]");
      if (m) { C.mode = m.dataset.mode; try { localStorage.setItem("wire.mna.chartmode", C.mode); } catch {} return draw(true); }
      const dot = e.target.closest("[data-d]");
      if (dot) return ctx.select?.(dot.dataset.d);
      const hit = e.target.closest('[data-tip="flow"]');
      if (hit) {
        const mo = C.tips.flowMonths[+hit.dataset.i], [y, mm] = mo.split("-").map(Number), end = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
        const same = ctx.F.range === "custom" && ctx.F.from === `${mo}-01`;
        return ctx.setFilter?.(same ? { range: "1Y", from: "", to: "" } : { range: "custom", from: `${mo}-01`, to: end });
      }
      const cell = e.target.closest(".mac-cell");
      if (cell) {
        const [y, q] = cell.dataset.q.split(" Q").map(Number), from = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`, to = new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
        return ctx.setFilter?.({ sector: cell.dataset.sector, industry: "", range: "custom", from, to });
      }
      const sec = e.target.closest("[data-sector]");
      if (sec) return ctx.setFilter?.({ sector: ctx.F.sector === sec.dataset.sector ? "" : sec.dataset.sector, industry: "" });
    });
    // redraw at the new width when the pane is resized
    C.ro = new ResizeObserver(() => { const w = el.clientWidth; if (C.ctx && w && Math.abs(w - C.lastW) > 24) draw(false); });
    C.ro.observe(el);
  }

  window.TkMnaCharts = {
    /** Draw every card. Bars and circles animate in only when the filters changed, not on a data refresh. */
    render(el, ctx) {
      if (!el) return;
      if (C.el !== el) { C.ro?.disconnect(); C.el = el; bind(el); }
      const key = JSON.stringify(ctx.F) + C.mode;
      const animate = key !== C.key; C.key = key; C.ctx = ctx;
      draw(animate);
    },
    /** Move the highlight to another deal without redrawing. */
    select(id) {
      if (!C.el) return;
      if (C.ctx) C.ctx.selected = id;
      C.el.querySelectorAll(".mac-dot.sel").forEach((d) => d.classList.remove("sel"));
      if (id) C.el.querySelectorAll(".mac-dot").forEach((d) => { if (d.dataset.d === id) d.classList.add("sel"); });
      C.el.querySelectorAll(".mac-gr.sel").forEach((d) => d.classList.remove("sel"));
      if (id) C.el.querySelectorAll(".mac-gr").forEach((d) => { if (d.dataset.d === id) d.classList.add("sel"); });
    }
  };
})();
