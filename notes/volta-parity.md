# Volta Terminal parity checklist

Compared 27 Oct 2026: Volta Terminal 1.29 (TOP, ECST, ECO, WEI, FED, GP) against the installed Tickerkite 1.0.
DEAL and COMP are Volta-only deal tools and are out of scope. Branding, logo and name stay Tickerkite's.

## Global chrome
- [x] Theme: near-black background (#07090c), navy panels, thin grey rules, square corners, no vibrancy/blur look.
- [x] Monospace everywhere (labels, rows, figures); uppercase small labels with letter spacing.
- [x] Top bar: logo at left, function-code tabs (boxed, cyan fill when selected) for every page, clock "TUE 27 OCT 12:10 ET" at right. Tickerkite uses grouped dropdowns (Markets ▾, Macro ▾) in a rounded segmented control.
- [x] Page header strip under the tabs: bold CODE + uppercase title (+ page sub-tabs) on the left, "PULLED N MINUTES AGO" / "DATA PULLED 2 HOURS AGO" on the right.
- [x] Footer line per page: counts on the left, key hints on the right ("1–9 PERIOD · ARROWS MOVE · R RELOAD · SOURCE").
- [x] Buttons: square, outlined, uppercase (SOURCES, 14D, MORE »); primary action is a solid cyan block ("OPEN STORY ›").
- [x] Detail pane: uppercase key column (WHY, SIGNAL, CONF, SOURCE), no rounded card around the key/values.
- [x] Classic slate/indigo look stays available as an option.

## TOP ≈ Brief / News
- [x] News rows dense (~18px), numbered "1)", monospace, code + "+N" + date columns; selected row a solid grey-blue bar.
- [x] Section labels "TOP RANKED NEWS" / "TIME ORDERED NEWS" in small uppercase; toggle "TOP NEWS | BACKGROUND & OPINION" as square buttons.
- [x] Search box flat, full width, with "SOURCES" and window buttons beside it.
- [x] Brief: Volta has no Brief; restyle its cards as flat square tiles with big figures to match.

## ECST ≈ Scorecards
- [x] Gauge + "47 OF 100" macrosignal header, recession odds box with big "13%" — Tickerkite has dial + recession box; restyle flat, larger bold figures.
- [x] Decile board tiles: solid red→green fills, bold name + value, small "D3 2026 Q2" footer, square corners.
- [x] Range buttons ALL / 50Y / 30Y … as boxed uppercase buttons, cyan when on.

## ECO ≈ Calendar
- [x] Dense table with row numbers "50)", date-time, flag, country, event, period, survey, actual, prior, revised; uppercase column header row.
- [x] Selected row outlined in cyan; region tabs (G10 / AMERICAS / …) as boxed buttons.

## WEI ≈ Markets
- [x] Period tabs "1 1D · 2 1W · 3 1M …" with the key number shown in each tab, in the header strip.
- [x] Tiles: name, big bold "+1.92%", ticker + price; colour scale pale (small move) → deep (big move), dark text on pale tiles; square.
- [x] Section headers uppercase with a right-aligned note ("LOCAL CURRENCY, PRICE RETURN").
- [x] Footer "US MARKET OPEN · REFRESH 15 MIN" left, "1–9 PERIOD · ARROWS MOVE · R RELOAD · YAHOO FINANCE, DELAYED" right.

## FED ≈ Fed
- [x] Four big stat boxes on top (NEXT FOMC odds, priced by date, peak implied rate, market vs dot), large bold figures, red/green.
- [x] Meeting table with inline odds bars ("84% HIKE"), uppercase headers.
- [x] Path chart with dotted comparison lines and dot markers.

## GP ≈ Graphs
- [x] Black chart canvas, cyan line, grey recession bands, boxed range buttons (6M YTD 1Y … MAX), toolbar of boxed uppercase buttons (FREQ, TYPE, NORMALIZE, STUDIES, ADD DATA).

## Status (27 Oct 2026)
Everything above is done in the Terminal theme (renderer/theme.js, terminal.css, chrome.js), checked in a scratch copy at the user's 901 px window width. Notes:
- Volta has no sidebar; Tickerkite keeps its watchlist/markets sidebar (a feature), restyled as a dense monospace list without sparklines.
- ECO: at narrow widths the PERIOD, SURP and REVISED columns hide so the event name fits (all three stay in the detail pane).
- Board tiles had a pre-existing layout bug in both themes (Brief's `.bf` class also hit the tile footer); fixed in board.css.

## Left over
- Floating widget window keeps the classic look (its own small page; not part of Volta's layout).
- GP: a new chart's first series is still indigo in both themes (series colours are saved with each chart); the canvas, toolbar and buttons follow the theme.
- FED/GC charts and the Brief keep their existing structure; only colours, type and density changed (Volta has no Brief or yield-curve page to match).
- ⌘⌥T (app menu) and the Settings › Appearance buttons were not clicked in the scratch run; the switch they call (TkTheme.set) was, both ways.
