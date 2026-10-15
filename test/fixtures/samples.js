// Sample feed payloads modeled on real RSS shapes (Google News, CNBC, Atom).
const now = Date.parse("2026-10-15T13:40:00Z");
const ago = (h) => new Date(now - h * 3600e3).toUTCString();

const googleNews = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Google News</title>
<item><title>Inflation heats up in September as gasoline jumps, CPI rises 3.7% - Reuters</title>
<link>https://news.google.com/rss/articles/AAA1</link><pubDate>${ago(5)}</pubDate>
<description>&lt;a href="x"&gt;Inflation heats up in September as gasoline jumps, CPI rises 3.7%&lt;/a&gt;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Reuters&lt;/font&gt;</description>
<source url="https://www.reuters.com">Reuters</source></item>
<item><title>September CPI rises 3.7% as gasoline jumps, inflation heats up - Bloomberg</title>
<link>https://news.google.com/rss/articles/AAA2</link><pubDate>${ago(4.8)}</pubDate>
<description>September CPI rises 3.7%</description><source url="https://www.bloomberg.com">Bloomberg</source></item>
<item><title>Local bakery opens third location downtown - Springfield Gazette</title>
<link>https://news.google.com/rss/articles/BBB1</link><pubDate>${ago(2)}</pubDate>
<source url="https://example.com">Springfield Gazette</source></item>
<item><title>TSMC posts record profit, beats estimates on AI chip demand - Associated Press</title>
<link>https://news.google.com/rss/articles/CCC1</link><pubDate>${ago(1)}</pubDate>
<source url="https://apnews.com">Associated Press</source></item>
<item><title>Old story from last week about oil - Reuters</title>
<link>https://news.google.com/rss/articles/OLD</link><pubDate>${ago(200)}</pubDate>
<source url="https://www.reuters.com">Reuters</source></item>
<item><title>Opinion: Why the Fed should pause in October - MarketWatch</title>
<link>https://news.google.com/rss/articles/OP1</link><pubDate>${ago(3)}</pubDate>
<source url="https://www.marketwatch.com">MarketWatch</source></item>
</channel></rss>`;

const cnbc = `<?xml version="1.0"?><rss version="2.0"><channel><title>CNBC</title>
<item><title><![CDATA[Inflation heats up: September CPI rises 3.7% as gasoline jumps]]></title>
<link>https://www.cnbc.com/2026/10/14/cpi.html?utm=rss</link><pubDate>${ago(4.9)}</pubDate>
<description><![CDATA[Consumer prices rose 0.6% in September &amp; gasoline jumped 9.1%.]]></description></item>
<item><title>Houthi missile strike hits Saudi Aramco as Brent crude tops $106</title>
<link>https://www.cnbc.com/2026/10/14/oil.html</link><pubDate>${ago(11)}</pubDate>
<description>Oil rose after the attack.</description></item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Fed</title>
<entry><title type="html">Federal Reserve Board announces approval of application</title>
<link rel="alternate" href="https://www.federalreserve.gov/newsevents/pressreleases/a.htm"/>
<updated>${new Date(now - 6 * 3600e3).toISOString()}</updated><summary>Routine approval.</summary></entry>
</feed>`;

module.exports = { now, googleNews, cnbc, atom };
