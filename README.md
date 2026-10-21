# Tickerkite — Market News Terminal for Mac

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

The installer lands in `dist/`. Without an Apple Developer ID certificate the build is unsigned, so the first time you open it, right-click **Tickerkite.app → Open → Open**. See *Selling Tickerkite* below to sign and notarize it.

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

Type a ticker into **+ add ticker** in the sidebar and press Enter. Any Yahoo Finance symbol works: `NVDA`, `BRK-B`, `7203.T`, `ASML.AS`. Tickerkite checks the symbol exists and looks up the company name.

- Each ticker shows its price, day change and sparkline. Click it for the full chart, momentum and "what moved it", the same as the markets below it. Hover and click **×**, or select it and press Delete, to remove it.
- Stories that mention your tickers get a green **★ NVDA** tag. **Watchlist** in the sidebar shows only those stories.
- A story counts as a mention when it uses the ticker in capitals (`NVDA`, `$NVDA`) or the company's short name ("Nvidia"). One- and two-letter tickers only count as `$F` or `(F)`, so "F-35" isn't a Ford story.
- A new story about one of your tickers sends a notification whatever its impact score. Turn this off under **View › Alerts for Watchlist Headlines**.
- For US stocks, the ticker's view also shows a **Company** section under the key numbers:
  - **Next earnings date**, from Nasdaq. The label says whether the date is confirmed or a Zacks estimate. When Nasdaq has no future date, Tickerkite estimates it from the company's past filing dates and labels it **ESTIMATED**.
  - **Valuation**: market cap, P/E (delayed price ÷ trailing-twelve-month diluted EPS) and price/sales, plus where today's P/E sits in its 5-year range.
  - **Fundamentals**: TTM revenue, net income, EPS, gross and operating margin, cash, total debt and shares outstanding.
  - **The last 8 quarters**.
- Fundamentals come from SEC EDGAR 10-Q/10-K filings (free, no key). Tickerkite caches them for 24 hours in `company-cache.json`.
  - The fourth quarter only appears inside the annual report, so it's worked out as the annual figure minus the first nine months, marked `*`.
  - Per-share figures are adjusted for stock splits.
- The SEC asks apps to send a contact email with each request. The first time you open a stock, the section asks for one. Tickerkite sends it only to sec.gov and saves it in `prefs.json` (`secContact`).
- ETFs, crypto, futures and non-US stocks show "No SEC filings for this symbol" instead of the Company section.
- **View › Edit Watchlist…** opens `watchlist.json`. Edit `terms` to change which words count as a mention, for example `["Nvidia", "Jensen Huang"]` or, for Target, `["Target Corp"]` so "inflation target" doesn't match. Tickerkite picks up the change as soon as you save.

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
5. **Inflation mode.** Stocks and bonds usually move apart: bad news means rate cuts, so bonds rally. When inflation is the main worry (the 1970s, 2022), bad news means higher rates and both fall together. Tickerkite measures inflation pressure from the inflation indicators and blends toward a second set of weights, `inflationary`, as it rises. In that set, bonds lose their credit as a hedge and inflation and rising yields hurt stocks and bonds more. `inflationMode.center` and `width` set where the switch happens. To turn it off, set `"inflationary": {}`.

Tune everything in **View › Edit Scorecard Weights…** (`scorecard-weights.json`). Tickerkite recalculates as soon as you save. **Reset Scorecard Weights to Defaults** undoes your changes. The math is in `src/macro/score.js` and the indicator list in `src/macro/indicators.js`.

### Backtest

`node scripts/backtest.js` downloads about 30 years of data, scores every month since 2007, and compares each score with that asset's return over the following 12 months (SPY, IEF, DBC, VNQ, BTC, GLD with dividends). Add `--cache file.json` to reuse the download. It also prints the scores at turning points (2008, 2020, 2022) and runs an experimental contrarian weighting.

What it showed (October 2026):

- Higher scores were followed by better returns for stocks, bonds, commodities and real estate on average, but the link is weak: correlations of 0.05–0.2. Crypto and gold showed none.
- Inflation mode improved bonds (0.15 → 0.19) and the relative ranking (top minus bottom asset +0.6% → +3.7% a year), and got bonds right in 2021–22.
- **The scorecard is most bearish near market bottoms** (November 2008, April 2020, June 2022), when conditions look worst but prices have already fallen. Treat very low scores as "conditions are bad", not "sell".

It uses today's revised data and overlapping 12-month windows, so treat it as a sanity check, not proof.

**Limits:** free data only. There are no consensus forecasts, so the scorecard can't show "CPI came in hotter than expected." FRED keeps only 3 years of the credit-spread history, so those rows compare against 3 years. China has no good free monthly data; exports (several months behind), Chinese stocks and copper stand in. Past scores (the 12-month line and the 1- and 3-month changes) use today's revised data, so they can differ slightly from what the scorecard would have shown at the time. The scores summarize conditions; they are not a forecast or investment advice.

### Recession odds

Under the regime box, **RECESSION ODDS · 12 MONTHS** shows the chance of a US recession 12 months from now from the classic yield-curve probit: P = Φ(a + b × spread), where spread = 10-year minus 3-month Treasury yield (FRED `GS10` − `TB3MS`, monthly since 1953) and the outcome is the NBER recession flag (`USREC`) 12 months later. Tickerkite fits a and b itself by maximum likelihood on every month whose outcome is known, and refits on each daily refresh (cached in `recession-cache.json`). The latest reading uses the daily `T10Y3M` (30-day average) when it is fresher than the monthly data; the detail pane says which. The Sahm rule (`SAHMREALTIME`, triggered at 0.50) is shown alongside as a second signal.

Click the box for the right-pane detail: probability history with recessions shaded and the 30% threshold, the spread history, the fitted parameters and range, the base rate, and the track record. A warning is a run of months at or above 30%; it catches a recession that starts 0–24 months after the run begins (lead = months between them). A run with no recession within 24 months is a false alarm; one that started less than 24 months ago is pending. As of October 2026 it caught 7 of the 10 recessions since 1957 (missing 1957, 1960 and 1990), with a 9-month average lead, and gave 2 false alarms (1966, 2022–24).

The track record is in-sample (the model is fitted on the same history), so it flatters the model. The curve says little about timing within the window and nothing about anything else. The code is `src/recession.js`.

### Decile board

**OUTLOOK | BOARD** at the top right of the Scorecards page (or `B`) switches to the board: all 53 indicators in eight columns (Growth, Inflation, Labor, Rates & Fed, Credit, Consumer & Housing, Markets, Global), each tile ranked **D1–D10 against its own full history**.

- **Direction-aware:** D10 is always the best tenth of history for the economy and D1 the worst. Direction is the indicator's `sign` times whether more of its factor is good (growth, labor, credit, easier Fed and conditions, consumer, global and each asset's own trend are good; inflation, higher yields, a stronger dollar and market stress are bad). So low unemployment and low inflation rank high. Override with `good: 1` or `-1` on an indicator in `src/macro/indicators.js`.
- **Each tile** shows the latest value with ▲/▼ against the prior reading, its decile and the month. Colors run from red (1) to green (10). Striped tiles are stale, and tiles more than 400 days old don't count toward the section score.
- **Scores:** each column's number is the average percentile of its tiles (0–100, 50 = typical), and the gauge is the average of the eight columns.
- **Rank against:** ALL, 50Y, 30Y, 20Y, 10Y or 5Y, or drag the timeline's handles. The left handle sets where each indicator's history starts. Pull the right handle back to see the board as of that month; **BACK TO LATEST** returns to today. With a preset, the window keeps its length as the right handle moves. Recessions are shaded on the timeline. A series that starts later than the range uses all it has, and the detail pane says from when.
- **Click a tile** for its value, decile, "Nth percentile of N readings since YEAR" and which way is better, the prior reading and a year ago, the source, **OPEN ON FRED** (or the price chart for Yahoo series), and its full history with recessions shaded and the ranked range highlighted. Arrow keys move between tiles.

The board needs longer history than the scorecard's 10 years, so it downloads its own copy the first time you open it: every FRED series from its first observation and Yahoo daily closes back to 1928 (a few seconds). It's transformed exactly as the scorecard does it (year-over-year, vs 200-day and so on), cut to one reading per month (the last of each month, so daily and monthly series rank against comparable histories), cached in `board-cache.json` and refreshed at most daily, or with **UPDATE DATA**. Some history is short: GDPNow starts in 2011, PPI in 2010, the dollar index in 2006 and the credit spreads in 2023 (FRED's limit).

Readings are dated by the period they cover and use today's revised data, so the board as of a past date shows what that data says now, not what was known then. The math is in `src/macro/board.js` (tests in `test/board.test.js`), the download in `src/board.js` and the view in `renderer/board.js`.

## Markets

The Markets page (⌘⌥4) is a heatmap of what's leading and lagging, in three sections:

- **US sectors**: the 11 S&P sector ETFs (XLK, XLC, XLY, XLF, XLI, XLV, XLP, XLE, XLB, XLU, XLRE), sorted best to worst.
- **Global markets**: S&P 500, Nasdaq, Russell 2000; Euro Stoxx 50, FTSE 100, DAX; Nikkei 225, Hang Seng, Shanghai, Sensex; and EEM for emerging markets.
- **Style**: growth vs value (IWF/IWD), large vs small caps (IWB/IWM) and equal- vs cap-weight S&P (RSP/SPY), each with the spread between them.

Tiles are green or red by return, darker the bigger the move relative to the period. Switch periods with the buttons or keys 1–9 (1D, 1W, 1M, 3M, YTD, 1Y, 3Y, 5Y, 10Y); each period has its own color scale. Click a tile for the right pane: a RETURNS table (TOTAL, plus PER YEAR annualized for 3Y/5Y/10Y), how far back the history goes, the 52-week high with its date and your distance from it, and a PRICE HISTORY chart (1Y/3Y/5Y/10Y/MAX, daily closes for 1Y, weekly beyond, last point at the live price, dashed line at the 52-week high). Click the tile again, press Enter, or use "Open chart" for the full price chart. A period longer than a symbol's history shows —.

Tickerkite downloads one year of daily prices per symbol from Yahoo Finance and computes every period locally; the full weekly history (for 3Y+ and the long chart) is downloaded once a day and kept in `markets-history-cache.json` (long returns are measured from the last weekly close before the start date). It refreshes every 5 minutes while the US market is open and every 30 minutes otherwise (only after you first open the page), and keeps the last result in `markets-cache.json` in the app's data folder so the page opens instantly. Returns are price returns in each market's own currency, ignoring dividends.

## Calendar

The Calendar page (⌘⌥3) shows one week at a time: US economic releases, Fed meetings and earnings for your watchlist stocks from the official schedules, plus global releases, central-bank speakers and auctions from Nasdaq's economic calendar, with the consensus forecast for each. All times are US Eastern.

- **Columns**: time (ET), country flag and code, importance (●●● high, ●●○ medium, ●○○ low), event, period, survey (consensus), actual, surprise (actual − survey; green above, red below the survey), prior and revised (when the previous reading changed since it first printed).
- **Filters**: G10 / Americas / Europe/MEA / Asia/Pacific / World (keys 1–5) and All / Macro / Fed / Earnings. ‹ › or ←/→ change week, "This week" or t goes back to now (and to the next event), / searches event names and countries (Esc clears). ↑/↓ or j/k move, r re-downloads everything. Hovering a row shows its countdown.
- **Official backbone**: CPI, PPI, jobs report, JOLTS, weekly jobless claims, GDP, PCE, retail sales and FOMC decisions come from the agencies' own schedules (below) and take their survey/actual/prior from the matching Nasdaq row, so the time and period are the official ones. If Nasdaq has no row (or is down) they still show, with the last reading from the scorecard data instead.
- **Right pane**: when, a countdown to this release and to the next one, the survey/actual/surprise/prior figures, then *actual vs survey* for up to the last 24 releases: a line chart (actual solid, survey dashed, dots green/red/grey for above/below/on), a summary like "Last 23 with a survey: 6 above, 12 below, 5 on it · typical miss 0.3% · SD 0.6%" (typical miss = average absolute surprise, SD = standard deviation of the surprises) and a table of release date, period, actual, survey, prior (→ revised) and surprise. Below that, Nasdaq's description of the indicator, the scorecard readings and Tickerkite headlines that mention it. Earnings rows open the stock's chart with Enter.

Sources, all free and keyless:
- Schedules: the Federal Reserve's FOMC calendar page, BEA's release schedule (GDP, PCE), Census's retail sales schedule and BLS's per-release schedule pages (CPI, PPI, jobs, JOLTS). Jobless claims follow the Labor Department's rule (Thursdays, Wednesday in Thanksgiving and Christmas weeks). Cached in `calendar-cache.json` and refreshed once a day. BLS often blocks apps, so when a source can't be reached Tickerkite uses a built-in list checked against the official pages, and those rows are tagged "fallback".
- Consensus and global events: `api.nasdaq.com/api/calendar/economicevents`, one request per day shown. Cached in `calendar-nasdaq.json` (60 days): today is re-read every 15 minutes while the app is open (and on opening the page if it is 10+ minutes old), so actuals appear soon after they print, past days settle after two days, future days every 6 hours. Two quirks Tickerkite corrects for: the reply for a date holds the previous day's events, and its times are Eastern at today's offset. Nasdaq gives no importance, period or revisions, so importance comes from Tickerkite's own list (headline releases and central-bank heads are high, anything with a forecast medium, the rest low), periods only for the official releases, and revisions from the history below. When Nasdaq is unreachable the bar says "consensus unavailable" and the official schedule carries on.
- History: every release Tickerkite sees (survey, actual, prior) goes into `calendar-history.json` in the app's data folder, keyed by country and event, last 36 per event, so it builds up over time. On first run Tickerkite also walks back two years of past days in the background, one day every 4 seconds (about 50 minutes of the app being open, resumed where it left off), so the charts have depth early. Events Nasdaq lists twice under one name (CPI y/y and m/m, building permits level and %) are kept apart by matching each to the series its prior continues.

## Fed

The Fed page (⌘⌥5) shows where markets expect the Fed's policy rate to go, meeting by meeting, against the Fed's own projections.

- **Header**: effective fed funds (EFFR), when the futures were last quoted and how old the data is. The target range is read off the prime rate (prime = top of the range + 3 points).
- **Four tiles**: the next FOMC meeting's odds of a 25bp move and its direction; the cumulative move priced by the last meeting with futures ("+75bp ≈ 3.0 hikes"); the peak (or trough) implied rate and the meeting it comes after; and the gap between the market and the Fed's latest median dot.
- **Meeting by meeting**: a "Today" row (EFFR), then each meeting's implied rate, move in bp, odds of a 25bp move as a bar (red for hikes, blue for cuts), cumulative bp, cumulative number of hikes, and the prime rate that implies (fed funds + 3.12%). Meetings with new projections are tagged SEP. ↑/↓ or j/k pick a meeting; r refreshes.
- **How the path moved**: a stepped chart of today's path, with the path as of 1 week ago (dashed) and 1 month ago (dotted) and the Fed's median dots as diamonds, plus how much the end-of-path rate moved.
- **Right pane**: the selected meeting's rate before and after, odds of holding / a 25bp / a 50bp move, how it was priced a week and a month ago, the Fed dot for that year, and Tickerkite headlines about the Fed.
- **Market vs Fed dots**: the median fed funds projection for each year and the longer run from the latest Summary of Economic Projections, next to the previous SEP and the market's year-end rate.
- **Treasury curve and money markets** (right column, or below on narrow windows): 1M–30Y par yields today, about 1 month ago (dashed) and 1 year ago (dotted), with 3M/2Y/10Y/30Y levels and 1-month / 1-year changes; then effective fed funds, SOFR, prime, 2Y and 10Y with 1-month changes.

How the path is worked out: each monthly 30-day fed funds future (CBOT ZQ) implies that month's average rate as 100 − price. In a month with a meeting on day d of N, the old rate holds d days and the new one N − d, so post = (N·average − d·pre) / (N − d); when the following month has no meeting, its average is used as the post-meeting rate directly. The first meeting starts from today's effective fed funds rate and each meeting's result feeds the next. The move is split between the two nearest 25bp steps for the odds (a +10bp move = 40% odds of a 25bp hike). If futures can't be loaded, the page says so instead of showing a path.

Sources, all free and keyless: Yahoo Finance for ZQ futures prices (with ~3 months of daily closes, used for the 1-week / 1-month comparison), the Federal Reserve's FOMC calendar and SEP projections table (a checked copy is built in, marked in the page, if the Fed's site can't be reached), the U.S. Treasury's daily par yield curve CSV, FRED's CSV export (DFF, SOFR, DPRIME, DGS2, DGS10), and FOMC dates from the Calendar page. Data is cached in `fed-cache.json` (opens instantly) and refreshed every 4 hours; each day's futures-implied rates are also saved in `fed-history.json` so the comparisons keep working for contracts that have expired.

## Graphs

The Graphs page (⌘⌥6) is a charting workspace for any FRED series or market symbol.

- **Add a series**: type a FRED ID (`UNRATE`, `T10Y2Y`, `CPIAUCSL`) or a Yahoo symbol (`^GSPC`, `NVDA`, `CL=F`) and press Enter, or use **Quick picks** (your watchlist and the 53 scorecard indicators). Anything with `^ = . -` is treated as a symbol; force one with `fred:` or `yahoo:`. Up to 6 series per chart; `/` focuses the box.
- **Compare**: SHARED puts everything on one axis, DUAL gives left and right axes (flip each series with its ◀ L / R ▶ button), NORMALIZE rebases every series to 100 at the start of the range (the first series' first date).
- **Per series**: Level, % YoY or Change, plus a moving-average study (MA, in observations, drawn dashed; 0 = off). Ranges 6M / YTD / 1Y / 2Y / 5Y / 10Y / 20Y / MAX / CUSTOM (from–to dates).
- **NBER RECESSION** shades recessions (FRED `USREC`). **CLIP 1–99%** fits the y-axis to the 1st–99th percentile so one spike doesn't flatten the rest. Hover for a crosshair with every series' value.
- **Reading it**: legend chips show each series' latest value and date ("UNRATE 4.3% 09/26"), and the latest value sits as a colored tag on its axis. Under the chart, for the selected series (click its name): frequency, where the latest reading ranks in its full history ("30th percentile of 314 readings since 1948"), the transform, the prior print, the value a year ago, the source ID and OPEN ON FRED.
- **Lines**: TREND LINE then drag; H-LINE then click. Click a line (with no tool selected) to remove it, or CLEAR LINES. In DUAL mode lines attach to the selected series' axis.
- **Save**: SAVE names the chart (series, transforms, range, lines) into `graphs.json`; reopen or delete it from **MY GRAPHS** in the right pane. NEW starts over. The current chart is also kept between launches.
- **Export**: CSV and PNG go to ~/Downloads ("Tickerkite <name>.csv/.png"); COPY FOR EXCEL puts tab-separated rows on the clipboard. Exports hold what's on the chart (transformed, in range, MA columns included).

Data: FRED's public CSV export and series page (title, units, frequency), and Yahoo daily closes, full history, cached per series in `graphs-cache/` for a day (the last copy is used offline).

## Charts, momentum and "what moved it"

Click any price in the sidebar (or in the widget) to open its chart in the right-hand pane.

- **Ranges:** 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y. Press `[` and `]` to step through them, and `Esc` to go back to the story. Tickerkite remembers the last range you used.
- **Live updates:** 1D refreshes every minute, 5D every 3 minutes, and longer ranges every 5–30 minutes.
- **Chart:** price over the range. Orange numbered circles mark the biggest moves. Hover anywhere to read the price, the change and the momentum at that point.
- **Velocity (1st derivative):** how fast the smoothed price is moving, in %/hr on 1D, %/day on 5D through 1Y, and %/week on 5Y. Treasury yields use basis points.
- **Acceleration (2nd derivative):** whether that speed is building or fading.
- **Momentum readout:** a plain-English summary such as "Falling, but losing steam", plus where today's velocity ranks within the range and when momentum last flipped.
- **Key numbers:** change, high/low, position in the range, annualized volatility, max drawdown, best and worst day, share of up days, distance from the 52-week high and low, and volume versus average.
- **What moved it:** the biggest moves in the range, each with the headlines published around it.
  - On **1D**, these are the largest half-hour swings (plus the opening gap), matched to stories in Tickerkite's own feed from up to an hour before each swing.
  - On longer ranges, Tickerkite searches Google News for that market on each big-move day and caches the results.
- **Latest in the feed:** current Tickerkite stories about that market.

Headlines are matched by time and topic. They show what the market was reacting to, not proof of cause. The topic lists for each market live in `src/instruments.js`, and the math in `src/analytics.js`.

## Floating widget

Press **⌘⇧W**, click **▣ WIDGET** in the status bar, or choose **View › Floating Widget**. A small panel opens showing SPX, Nasdaq, the 10-year yield and Brent, plus the top 15 stories from the last 24 hours.

- **TOP / LATEST** switches between ranked by impact and newest first.
- **Click** a headline to open it in the main window. **⌥-click** opens the article in your browser.
- Drag the red bar to move the panel, and drag an edge to resize it. Tickerkite remembers its position and reopens it at launch.
- By default the widget sits on your desktop in the top-left corner, and other windows can cover it like any app. **PIN** (orange when on) floats it above every app and Space instead. **↗** opens the main window and **×** closes the panel.
- You can close the main window and keep only the widget running. Click Tickerkite in the Dock to get the main window back.

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

Use **View › Edit Feeds…** to open `~/Library/Application Support/Tickerkite/feeds.json`. Each entry looks like this:

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
src/graphs.js        graph workspace: FRED/Yahoo downloads, cache, saved charts, exports
src/macro/           scorecards: indicators, data downloads, scoring, default weights

src/macro/           scorecards: indicators, data downloads, scoring, default weights, decile board math
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

## Settings, trial and license

- **Tickerkite › Settings…** (`⌘,`) shows your license, an optional Finnhub key and links to the License Agreement, Privacy Policy and Data Sources.
- The first launch asks you to accept the License Agreement (`legal/EULA.md`). Raising `TERMS_VERSION` in `src/settings.js` asks everyone again.
- A packaged Tickerkite.app runs a 14-day trial, then needs a Lemon Squeezy license key. `npm start` is a development run and is never locked.
- **Finnhub key (optional):** with your own free key from finnhub.io, prices for US stocks and ETFs on your watchlist and portfolio come from Finnhub. Indices, futures, FX and charts still come from Yahoo. The key is encrypted with the macOS Keychain.

## Where the data comes from

Every outside request goes through `src/data/`:

- `http.js` sends every request as `Tickerkite/<version>`, never as a browser. Set `"homepage"` in package.json and the URL is added to the User-Agent.
- `yahoo.js`, `nasdaq.js` and `googlenews.js` are the unofficial sources. Replacing one means editing one file.
- `finnhub.js` is the optional keyed quote source.

`legal/DATA-SOURCES.md` lists every source, including the FRED series that are copyrighted by their original publishers.

## Selling Tickerkite

Here's what you need to fill in before the first sale:

1. **Lemon Squeezy.** Create the product with *Generate license keys* turned on. Then set `storeId`, `productId` and `checkoutUrl` in `STORE` at the top of `src/license.js`.
2. **Legal text.** Replace every `[bracketed]` item in `legal/EULA.md` and `legal/PRIVACY.md`, and have a lawyer review both.
3. **Signing and notarization.** Join the Apple Developer Program and install your *Developer ID Application* certificate in Keychain. Then build with these set:
   ```bash
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com › App-Specific Passwords
   export APPLE_TEAM_ID="ABCDE12345"
   npm run dist
   ```
4. **Auto-updates.** Set `build.publish[0].owner` in package.json to your GitHub username, and create the `tickerkite` repository. To ship an update, bump `version`, then run `GH_TOKEN=<token with repo scope> npm run release`. That uploads the .dmg, the .zip and `latest-mac.yml` to a GitHub release. Installed copies pick the update up within 6 hours, or straight away from **Tickerkite › Check for Updates…**. Only signed builds can update themselves.
5. **Optional:** add an app icon at `build/icon.icns`, an `"author"` field, and a `"homepage"` field in package.json.
