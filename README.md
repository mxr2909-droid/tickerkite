# WIRE — Market News Terminal for Mac

A desktop news terminal that pulls headlines from about 17 live sources every 2 minutes, merges the same story reported by different outlets, and ranks what is most likely to move markets. Delayed quotes for indices, yields, FX, oil, gold and bitcoin sit in the sidebar. Free sources only, no API keys.

## Run it

You need Node.js 20 or newer. Check with `node -v`; if it's missing, install the LTS from https://nodejs.org.

```bash
cd wire-terminal
npm install      # downloads Electron (~100 MB, first time only)
npm start
```

The first pull takes about 10 seconds. After that the app opens instantly from its cache.

### Build a real .app / .dmg

```bash
npm run dist
```

The installer lands in `dist/`. The build is unsigned, so the first time you open it, right-click **WIRE.app → Open → Open**. After that it launches normally and can live in your Dock.

## Using it

| Key | Action |
|---|---|
| `↑` `↓` or `j` `k` | Move through headlines |
| `Enter` or `o`, or double-click | Open the story in your browser |
| `1`–`7` | Top News, US Macro, Global, Fed / Rates, Earnings, Energy, All |
| `/` | Search (headlines, tickers, outlets, regions) |
| `Esc` | Clear search and source filter |
| `⌘R` | Refresh now |

- **Top Ranked News** shows the 3 highest-impact stories in the current filter. Click *More »* to show 10.
- **Time Ordered News** lists everything newest first. `+2` means two more outlets carry the same story; the story pane lists them under *Also reported by*.
- **Background & Opinion** switches to analysis, previews and columns.
- **HI** marks high-impact stories. **NEW** marks stories from the last 30 minutes.
- The sidebar filters to High Impact or Last Hour and shows which feeds are live.
- High-impact headlines trigger a macOS notification. Turn this off under **View › Alerts for High-Impact Headlines**.

## Watchlist

Type a ticker into **+ add ticker** in the sidebar and press Enter. Any Yahoo Finance symbol works: `NVDA`, `BRK-B`, `7203.T`, `ASML.AS`. WIRE checks the symbol exists and looks up the company name.

- Each ticker shows its price, day change and sparkline. Click it for the full chart, momentum and "what moved it", the same as the markets below it. Hover and click **×**, or select it and press Delete, to remove it.
- Stories that mention your tickers get a green **★ NVDA** tag. **Watchlist** in the sidebar shows only those stories.
- A story counts as a mention when it uses the ticker in capitals (`NVDA`, `$NVDA`) or the company's short name ("Nvidia"). One- and two-letter tickers only count as `$F` or `(F)`, so "F-35" isn't a Ford story.
- A new story about one of your tickers sends a notification whatever its impact score. Turn this off under **View › Alerts for Watchlist Headlines**.
- For US stocks, the ticker's view also shows a **Company** section under the key numbers:
  - **Next earnings date**, from Nasdaq. The label says whether the date is confirmed or a Zacks estimate. When Nasdaq has no future date, WIRE estimates it from the company's past filing dates and labels it **ESTIMATED**.
  - **Valuation**: market cap, P/E (delayed price ÷ trailing-twelve-month diluted EPS) and price/sales, plus where today's P/E sits in its 5-year range.
  - **Fundamentals**: TTM revenue, net income, EPS, gross and operating margin, cash, total debt and shares outstanding.
  - **The last 8 quarters**.
- Fundamentals come from SEC EDGAR 10-Q/10-K filings (free, no key). WIRE caches them for 24 hours in `company-cache.json`.
  - The fourth quarter only appears inside the annual report, so it's worked out as the annual figure minus the first nine months, marked `*`.
  - Per-share figures are adjusted for stock splits.
- The SEC asks apps to send a contact email with each request. The first time you open a stock, the section asks for one. WIRE sends it only to sec.gov and saves it in `prefs.json` (`secContact`).
- ETFs, crypto, futures and non-US stocks show "No SEC filings for this symbol" instead of the Company section.
- **View › Edit Watchlist…** opens `watchlist.json`. Edit `terms` to change which words count as a mention, for example `["Nvidia", "Jensen Huang"]` or, for Target, `["Target Corp"]` so "inflation target" doesn't match. WIRE picks up the change as soon as you save.

## Scorecards

Click **Scorecards** at the top (or ⌘⌥2; ⌘⌥1 goes back to News). Each tab scores one asset class from 0 to 100 for the next 6–12 months: **Stocks, Bonds, Commodities, Real Estate, Crypto, Alts** (gold and precious metals). 50 is neutral; higher means conditions are more supportive of that asset. Keys `1`–`6` switch tabs, `↑` `↓` move through indicators.

- **53 indicators in 8 sections:** Growth, Inflation, Labor, Rates & Fed, Credit & Conditions, Consumer & Housing, Markets and Global. Data comes from the St. Louis Fed (FRED, no key needed) and Yahoo Finance, refreshed every 6 hours or with **UPDATE DATA**.
- **Each row** shows the latest reading, where it was 6 months ago, its trend, where it sits in its own history, and how many points it adds to or takes from the selected score.
- **Pushing up / pulling down** lists the biggest drivers of the score.
- **What changed** explains a score move: the total change over the last week (**1W**) or month (**1M**) and the indicators that moved it most, with each one's value then → now and the points it added or took away. Click one to open it. Rows in the main table tagged **NEW** got a fresh data point in the last 7 days.
- **Vs the average of all six** ranks the assets against each other. Even when everything scores low, it shows which are least and most exposed.
- **Regime** plots growth against inflation (Goldilocks, Reflation, Slowdown, Stagflation) from the direction of the last 6 months.
- **Inflation mode** shows how far the weights have shifted for an inflation-driven market (below).
- **Click any indicator** for its history with recessions shaded, and its effect on all six outlooks. Market indicators link to the full price chart.

### How the score is built

1. Every indicator gets a **level** reading (where today sits in the last 10 years) and a **trend** reading (how its 6-month change compares with past 6-month changes). Both run from −1 to +1 and are mixed 35% level / 65% trend.
2. Every indicator feeds one **factor**: growth, inflation, labor, yields, Fed policy, credit, financial conditions, dollar, market stress, consumer, global, or the asset's own price trend.
3. Each asset weights each factor from −2 to +2. Rising inflation is −1 for stocks, −2 for bonds and +2 for commodities, for example. A factor's weight is split across its indicators, so inflation having 7 indicators doesn't make it count 7 times.
4. The weighted average is stretched (×1.5) and mapped to 0–100.
5. **Inflation mode.** Stocks and bonds usually move apart: bad news means rate cuts, so bonds rally. When inflation is the main worry (the 1970s, 2022), bad news means higher rates and both fall together. WIRE measures inflation pressure from the inflation indicators and blends toward a second set of weights, `inflationary`, as it rises. In that set, bonds lose their credit as a hedge and inflation and rising yields hurt stocks and bonds more. `inflationMode.center` and `width` set where the switch happens. To turn it off, set `"inflationary": {}`.

Tune everything in **View › Edit Scorecard Weights…** (`scorecard-weights.json`). WIRE recalculates as soon as you save. **Reset Scorecard Weights to Defaults** undoes your changes. The math is in `src/macro/score.js` and the indicator list in `src/macro/indicators.js`.

### Backtest

`node scripts/backtest.js` downloads about 30 years of data, scores every month since 2007, and compares each score with that asset's return over the following 12 months (SPY, IEF, DBC, VNQ, BTC, GLD with dividends). Add `--cache file.json` to reuse the download. It also prints the scores at turning points (2008, 2020, 2022) and runs an experimental contrarian weighting.

What it showed (October 2026):

- Higher scores were followed by better returns for stocks, bonds, commodities and real estate on average, but the link is weak: correlations of 0.05–0.2. Crypto and gold showed none.
- Inflation mode improved bonds (0.15 → 0.19) and the relative ranking (top minus bottom asset +0.6% → +3.7% a year), and got bonds right in 2021–22.
- **The scorecard is most bearish near market bottoms** (November 2008, April 2020, June 2022), when conditions look worst but prices have already fallen. Treat very low scores as "conditions are bad", not "sell".

It uses today's revised data and overlapping 12-month windows, so treat it as a sanity check, not proof.

**Limits:** free data only. There are no consensus forecasts, so the scorecard can't show "CPI came in hotter than expected." FRED keeps only 3 years of the credit-spread history, so those rows compare against 3 years. China has no good free monthly data; exports (several months behind), Chinese stocks and copper stand in. Past scores (the 12-month line and the 1- and 3-month changes) use today's revised data, so they can differ slightly from what the scorecard would have shown at the time. The scores summarize conditions; they are not a forecast or investment advice.

## Markets

The Markets page (⌘⌥4) is a heatmap of what's leading and lagging, in three sections:

- **US sectors**: the 11 S&P sector ETFs (XLK, XLC, XLY, XLF, XLI, XLV, XLP, XLE, XLB, XLU, XLRE), sorted best to worst.
- **Global markets**: S&P 500, Nasdaq, Russell 2000; Euro Stoxx 50, FTSE 100, DAX; Nikkei 225, Hang Seng, Shanghai, Sensex; and EEM for emerging markets.
- **Style**: growth vs value (IWF/IWD), large vs small caps (IWB/IWM) and equal- vs cap-weight S&P (RSP/SPY), each with the spread between them.

Tiles are green or red by return, darker the bigger the move relative to the period. Switch periods with the buttons or keys 1–5 (1D, 1W, 1M, 3M, YTD). Click a tile for every period's return and its distance from the 52-week high; click it again, press Enter, or use "Open chart" for the full price chart.

WIRE downloads one year of daily prices per symbol from Yahoo Finance once and computes every period locally. It refreshes every 5 minutes while the US market is open and every 30 minutes otherwise (only after you first open the page), and keeps the last result in `markets-cache.json` in the app's data folder so the page opens instantly. Returns are price returns in each market's own currency, ignoring dividends.

## Charts, momentum and "what moved it"

Click any price in the sidebar (or in the widget) to open its chart in the right-hand pane.

- **Ranges:** 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y. Press `[` and `]` to step through them, and `Esc` to go back to the story. WIRE remembers the last range you used.
- **Live updates:** 1D refreshes every minute, 5D every 3 minutes, and longer ranges every 5–30 minutes.
- **Chart:** price over the range. Orange numbered circles mark the biggest moves. Hover anywhere to read the price, the change and the momentum at that point.
- **Velocity (1st derivative):** how fast the smoothed price is moving, in %/hr on 1D, %/day on 5D through 1Y, and %/week on 5Y. Treasury yields use basis points.
- **Acceleration (2nd derivative):** whether that speed is building or fading.
- **Momentum readout:** a plain-English summary such as "Falling, but losing steam", plus where today's velocity ranks within the range and when momentum last flipped.
- **Key numbers:** change, high/low, position in the range, annualized volatility, max drawdown, best and worst day, share of up days, distance from the 52-week high and low, and volume versus average.
- **What moved it:** the biggest moves in the range, each with the headlines published around it.
  - On **1D**, these are the largest half-hour swings (plus the opening gap), matched to stories in WIRE's own feed from up to an hour before each swing.
  - On longer ranges, WIRE searches Google News for that market on each big-move day and caches the results.
- **Latest in the feed:** current WIRE stories about that market.

Headlines are matched by time and topic. They show what the market was reacting to, not proof of cause. The topic lists for each market live in `src/instruments.js`, and the math in `src/analytics.js`.

## Floating widget

Press **⌘⇧W**, click **▣ WIDGET** in the status bar, or choose **View › Floating Widget**. A small panel opens showing SPX, Nasdaq, the 10-year yield and Brent, plus the top 15 stories from the last 24 hours.

- **TOP / LATEST** switches between ranked by impact and newest first.
- **Click** a headline to open it in the main window. **⌥-click** opens the article in your browser.
- Drag the red bar to move the panel, and drag an edge to resize it. WIRE remembers its position and reopens it at launch.
- By default the widget sits on your desktop in the top-left corner, and other windows can cover it like any app. **PIN** (orange when on) floats it above every app and Space instead. **↗** opens the main window and **×** closes the panel.
- You can close the main window and keep only the widget running. Click WIRE in the Dock to get the main window back.

## How stories are ranked

Each story gets a 0–100 impact score in `src/news/rank.js`:

- **Topic weight.** Keyword rules for inflation data, the Fed and central banks, jobs, growth data, rates, energy, geopolitics, trade, earnings, market stress, FX, China and AI. The strongest match counts in full and the next two count partially.
- **Confirmation.** +10 per additional outlet carrying the same story, up to +30.
- **Source authority.** Reuters, Bloomberg, WSJ, FT and central banks rank highest.
- **Recency.** Up to +20, fading over a few hours.
- **Mega-caps.** A boost when the story names a top index weight, especially for earnings.
- **Discounts.** Routine admin releases and "data due later" previews are marked down.

75+ is **HIGH**, 50–74 **MEDIUM**, and below 50 **LOW**. Tune any of this in `rank.js`, then run `npm test` to check that nothing broke.

## Changing sources

Use **View › Edit Feeds…** to open `~/Library/Application Support/WIRE/feeds.json`. Each entry looks like this:

```json
{ "id": "my-feed", "name": "Display Name", "url": "https://…/rss", "weight": 6, "kind": "news" }
```

- `kind` is `"news"` or `"ctx"` (background & opinion).
- `"enabled": false` turns a feed off without deleting it.
- **View › Reset Feeds to Defaults** restores the original list.

Any RSS or Atom feed works. Google News searches are the easiest way to cover a topic or region: copy one of the `gn(...)` URLs and change the query.

## Notes and limits

- Quotes come from Yahoo Finance's public chart endpoint. They are delayed and unofficial, so a symbol can occasionally show `—`.
- Some outlets block RSS readers or change feed URLs. The sidebar shows each failing feed and why.
- Google News links go through a Google redirect before reaching the publisher.
- Summaries are whatever the feed provides. Many feeds carry only headlines.

## Project layout

```
src/main.js          app window, refresh loop, notifications, menu
src/preload.js       safe bridge between the app and the UI
src/quotes.js        delayed market quotes and price history
src/analytics.js     range stats, velocity/acceleration, big-move detection
src/instruments.js   which headlines matter for each market; news-to-move matching
src/watchlist.js     your tickers: symbol cleanup and which stories mention them
src/markets.js       market heatmap: sectors, global indexes, style pairs
src/company.js       company panel: SEC EDGAR fundamentals, valuation, next earnings date
src/macro/           scorecards: indicators, data downloads, scoring, default weights
scripts/backtest.js  scorecard backtest since 2007
src/news/feeds.js    default sources
src/news/fetcher.js  parallel feed download with timeouts
src/news/parse.js    RSS/Atom parser (no dependencies)
src/news/rank.js     clustering, tagging and impact scoring
renderer/            the terminal UI (HTML/CSS/JS)
test/                parser and ranking tests (npm test)
```

## Next steps

- Paid real-time data (Finnhub, Polygon, Benzinga) as an optional source, set up with your API key.
- An economic calendar pane (CPI, FOMC, earnings dates), using a free FRED API key for release dates.
- AI one-line summaries for each top story.
