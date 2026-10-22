const { parseFeed } = require("./parse");

const { getText } = require("../data/http");

const fetchText = (url, timeoutMs = 12000) =>
  getText(url, { timeoutMs, headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });

// Items with no date in the feed are stamped with the time we first saw them, not the time of
// each pull: otherwise a whole undated batch looks brand new (and NEW) after every refresh.
const firstSeen = new Map();
function stampUndated(items, now = Date.now()) {
  for (const it of items) {
    if (!it.undated) continue;
    if (!firstSeen.has(it.link)) firstSeen.set(it.link, now);
    it.ts = firstSeen.get(it.link);
  }
  if (firstSeen.size > 20000) for (const k of [...firstSeen.keys()].slice(0, 5000)) firstSeen.delete(k);
  return items;
}

/** Fetch every feed in parallel. A failing feed never breaks the others. */
async function fetchAll(feeds) {
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const xml = await fetchText(f.url);
      const items = parseFeed(xml, f);
      if (!items.length) throw new Error("no items");
      return items;
    })
  );
  const items = [];
  const status = results.map((r, i) => {
    const f = feeds[i];
    if (r.status === "fulfilled") {
      items.push(...r.value);
      return { id: f.id, name: f.name, ok: true, count: r.value.length };
    }
    return { id: f.id, name: f.name, ok: false, error: String(r.reason?.message || r.reason) };
  });
  return { items: stampUndated(items), status };
}

module.exports = { fetchAll, fetchText, stampUndated };
