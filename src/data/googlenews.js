// Google News RSS search URLs, used by the default feeds and the "what moved it" history.
// Building them in one place means swapping Google News for another search source is one file.

/** RSS URL for a Google News search, e.g. searchUrl("Federal Reserve when:2d"). */
const searchUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

module.exports = { searchUrl };
