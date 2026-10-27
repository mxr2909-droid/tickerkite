// Nasdaq's public API (no key): the economic calendar, next earnings dates and institutional holders.
// Unofficial like Yahoo's, so every Nasdaq call goes through here.
const { getJSON } = require("./http");

const BASE = "https://api.nasdaq.com/api";
const get = (path, timeoutMs = 15000) => getJSON(BASE + path, { timeoutMs, net: true, headers: { Accept: "application/json, text/plain, */*" } });

/** Economic events Nasdaq files under ?date=D (which are the day before D's; see calendar-nasdaq.js). */
const economicEvents = (date, timeoutMs) => get(`/calendar/economicevents?date=${encodeURIComponent(date)}`, timeoutMs);
/** Every US-listed company reporting on a date, with market cap, EPS consensus and (once out) the actual. */
const earnings = (date, timeoutMs) => get(`/calendar/earnings?date=${encodeURIComponent(date)}`, timeoutMs);
const earningsDate = (sym, timeoutMs = 8000) => get(`/analyst/${encodeURIComponent(sym)}/earnings-date`, timeoutMs);
const holdings = (sym, timeoutMs) => get(`/company/${encodeURIComponent(sym)}/institutional-holdings?limit=15&type=TOTAL&sortColumn=marketValue&sortOrder=DESC`, timeoutMs);

module.exports = { economicEvents, earnings, earningsDate, holdings };
