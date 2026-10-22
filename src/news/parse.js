// Minimal RSS 2.0 / Atom parser. No dependencies. Handles CDATA, entities,
// Atom <link href>, and Google News <source url> publisher tags.

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENT ? ENT[n.toLowerCase()] : m));
}
function safeChar(c) {
  try { return String.fromCodePoint(c); } catch { return ""; }
}
function unCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function stripTags(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}
function clean(s) {
  if (!s) return "";
  // decode once before stripping (escaped HTML in descriptions), then again for leftovers
  return decode(stripTags(decode(unCdata(s)))).replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  return m ? { attrs: m[1] || "", text: m[2] } : null;
}
function attr(attrs, name) {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? decode(m[1]) : "";
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const alt = links.find((a) => /rel=["']alternate["']/i.test(a)) || links.find((a) => !/rel=/i.test(a)) || links[0];
  return alt ? attr(alt, "href") : "";
}

/** "https://www.nikkei.com/x" -> "nikkei.com"; "" when it isn't a URL */
function siteOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function parseFeed(xml, feed = {}) {
  if (typeof xml !== "string" || !xml) return [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const out = [];
  for (const b of blocks) {
    let title = clean(tag(b, "title")?.text);
    if (!title) continue;

    let link = "";
    if (isAtom) link = atomLink(b);
    else {
      const l = tag(b, "link");
      link = l ? clean(l.text) : "";
      if (!link) link = clean(tag(b, "guid")?.text);
    }
    if (!/^https?:\/\//i.test(link)) continue;

    const dateRaw = clean((tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"))?.text);
    const ts = Date.parse(dateRaw);

    const desc = clean((tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content"))?.text);

    // Google News: publisher in <source>, and appended to the title as " - Publisher"
    let publisher = "";
    const src = tag(b, "source");
    if (src) publisher = clean(src.text);
    if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3)).trim();
    if (!publisher) publisher = feed.name || "Unknown";
    // the publisher's own site: Google News gives it as <source url>, otherwise the link's host
    const site = siteOf((src && attr(src.attrs, "url")) || link);

    let summary = desc;
    // Google News descriptions just repeat the headline and publisher
    if (summary && (summary.startsWith(title) || summary.length < 25)) summary = "";
    if (summary.length > 420) summary = summary.slice(0, 417).replace(/\s+\S*$/, "") + "…";

    out.push({
      title,
      link,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      undated: !Number.isFinite(ts),
      site,
      summary,
      publisher,
      feedId: feed.id || "",
      feedWeight: feed.weight || 0,
      kind: feed.kind || "news"
    });
  }
  return out;
}

module.exports = { parseFeed, clean, siteOf };
