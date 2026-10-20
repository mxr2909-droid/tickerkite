const { parseFeed } = require("./parse");

const { getText } = require("../data/http");

const fetchText = (url, timeoutMs = 12000) =>
  getText(url, { timeoutMs, headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });

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
  return { items, status };
}

module.exports = { fetchAll, fetchText };
