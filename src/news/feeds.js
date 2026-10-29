// Default news sources. On first launch these are copied to
// ~/Library/Application Support/Tickerkite/feeds.json, which you can edit
// (View > Edit Feeds…). Changes apply on the next refresh.
//
// kind: "news" = headlines, "ctx" = background, analysis and opinion
// weight: 0–10 source authority, added to the impact score

const { searchUrl } = require("../data/googlenews");
const gn = (q) => searchUrl(q + " when:2d");

module.exports = [
  // Google News searches surface Reuters, Bloomberg, WSJ, FT, AP etc. The real publisher is read from each item.
  { id: "gn-markets", name: "Google News: Markets", url: gn("stock market OR Wall Street OR S&P 500"), weight: 0, kind: "news" },
  { id: "gn-fed", name: "Google News: Fed & Rates", url: gn("Federal Reserve OR FOMC OR Treasury yields"), weight: 0, kind: "news" },
  { id: "gn-macro", name: "Google News: Macro Data", url: gn("CPI OR inflation OR jobs report OR GDP OR retail sales"), weight: 0, kind: "news" },
  { id: "gn-energy", name: "Google News: Energy", url: gn("oil prices OR OPEC OR Brent crude"), weight: 0, kind: "news" },
  { id: "gn-earnings", name: "Google News: Earnings", url: gn("quarterly earnings results"), weight: 0, kind: "news" },
  { id: "gn-global", name: "Google News: Global Markets", url: gn("ECB OR Bank of Japan OR China economy OR European stocks OR Asian markets"), weight: 0, kind: "news" },
  { id: "gn-geo", name: "Google News: Geopolitics", url: gn("tariffs OR sanctions OR Strait of Hormuz markets"), weight: 0, kind: "news" },

  { id: "cnbc-top", name: "CNBC Top News", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", weight: 7, kind: "news" },
  { id: "cnbc-markets", name: "CNBC Markets", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", weight: 7, kind: "news" },
  { id: "mw-top", name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", weight: 6, kind: "news" },
  // Yahoo Finance's RSS feed (finance.yahoo.com/news/rssindex) was removed: it returns 404 since 2026
  { id: "bbc-biz", name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", weight: 5, kind: "news" },
  { id: "nikkei", name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar", weight: 6, kind: "news" },
  { id: "fed", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", weight: 10, kind: "news" },
  { id: "ecb", name: "ECB Press", url: "https://www.ecb.europa.eu/rss/press.html", weight: 9, kind: "news" },

  { id: "ft-markets", name: "FT Markets", url: "https://www.ft.com/markets?format=rss", weight: 8, kind: "ctx" },
  { id: "mw-opinion", name: "MarketWatch Commentary", url: "https://feeds.content.dowjones.io/public/rss/mw_marketpulse", weight: 4, kind: "ctx" }
];
