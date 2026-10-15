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
src/news/feeds.js    default sources
src/news/fetcher.js  parallel feed download with timeouts
src/news/parse.js    RSS/Atom parser (no dependencies)
src/news/rank.js     clustering, tagging and impact scoring
renderer/            the terminal UI (HTML/CSS/JS)
test/                parser and ranking tests (npm test)
```

## Next steps

- Paid real-time data (Finnhub, Polygon, Benzinga) as an optional source, set up with your API key.
- A watchlist that pins stories mentioning your tickers and alerts on them.
- An economic calendar pane (CPI, FOMC, earnings dates).
- AI one-line summaries for each top story.
