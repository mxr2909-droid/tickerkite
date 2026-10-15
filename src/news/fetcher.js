const { parseFeed } = require("./parse");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) WIRE/0.1";

async function fetchText(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      redirect: "follow"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
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
  return { items, status };
}

module.exports = { fetchAll, fetchText };
