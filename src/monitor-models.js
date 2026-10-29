// The risk monitors: event models whose factors were chosen by cross-validation
// (scripts/select-factors.js; 6 time blocks, an h-month gap each side). Shown on the Brief page and
// available as presets on the Factor page. Re-run the script before changing a model, and keep
// only factors that improve the cross-validated AUC and whose direction makes economic sense.
//
// quality: cross-validated AUC and Brier skill vs always guessing the base rate, as measured 2026-10-29.
const F = (key, name, tf, lag = 0) => ({ key, name, tf, lag });

module.exports = [
  {
    id: "recession", name: "New recession within 12 months", short: "Recession", ridge: 10,
    target: { key: "fred:USREC", name: "US recession (NBER)", measure: "level" },
    c: { text: "A new US recession begins within the next 12 months", cond: "above", x: 0.5, h: 12, when: "within", unit: "pts", onlyNew: true },
    factors: [F("fred:T10Y3M", "Yield curve (10y minus 3m)", "level"), F("fred:PERMIT", "Building permits", "pct12"), F("fred:DFF", "Fed funds rate (cuts raise odds)", "chg12"), F("fred:WTISPLC", "Oil price (monthly)", "pct12")],
    quality: { auc: 0.887, skill: 0.085, grade: "Good", since: 1982 },
    why: "An inverted yield curve, falling building permits, the Fed starting to cut and oil spikes have come before US recessions."
  },
  {
    id: "jobs", name: "Unemployment up 0.5+ points within 12 months", short: "Jobs downturn", ridge: 20,
    target: { key: "fred:UNRATE", name: "Unemployment rate", measure: "level" },
    c: { text: "The unemployment rate rises 0.5 points or more within the next 12 months", cond: "rise", x: 0.5, h: 12, when: "within", unit: "pts" },
    factors: [F("fred:PERMIT", "Building permits", "pct12"), F("fred:INDPRO", "Industrial production", "pct12"), F("fred:DFF", "Fed funds rate", "level"), F("yahoo:^GSPC", "S&P 500", "pct6")],
    quality: { auc: 0.895, skill: 0.39, grade: "Strong", since: 1961 },
    why: "Housing and factory output slow, rates are high and stocks fall before layoffs pick up."
  },
  {
    id: "cuts", name: "Fed cuts 1+ point within 12 months", short: "Fed cutting cycle", ridge: 5,
    target: { key: "fred:DFF", name: "Fed funds rate", measure: "level" },
    c: { text: "The Fed cuts its rate by 1 point or more within the next 12 months", cond: "fall", x: 1, h: 12, when: "within", unit: "pts" },
    factors: [F("fred:DFF", "Fed funds rate", "level"), F("yahoo:^VIX", "VIX", "level")],
    quality: { auc: 0.863, skill: 0.34, grade: "Strong", since: 1990 },
    why: "Big cuts come when rates are high (room to cut) and markets are under stress."
  },
  {
    id: "bear", name: "S&P 500 falls 20%+ within 12 months", short: "Bear market", ridge: 2,
    target: { key: "yahoo:^GSPC", name: "S&P 500", measure: "level" },
    c: { text: "The S&P 500 falls 20% or more at some point in the next 12 months", cond: "fall", x: 20, h: 12, when: "within", unit: "pct" },
    factors: [F("fred:T10Y3M", "Yield curve, 12-mo change", "chg12"), F("fred:WTISPLC", "Oil price (monthly)", "pct12"), F("fred:UNRATE", "Unemployment rate", "level"), F("fred:NFCI", "Financial conditions (Chicago Fed)", "level")],
    quality: { auc: 0.862, skill: 0.19, grade: "Good", since: 1983 },
    why: "Bear markets tend to start near cycle peaks: low unemployment, tight financial conditions, an oil spike and a yield curve that is quickly steepening as the Fed eases."
  },
  {
    id: "inflation-surge", name: "Inflation up 1+ point within 12 months", short: "Inflation surge", ridge: 20,
    target: { key: "fred:CPIAUCSL", name: "CPI inflation", measure: "yoy" },
    c: { text: "CPI inflation rises 1 point or more within the next 12 months", cond: "rise", x: 1, h: 12, when: "within", unit: "pts" },
    factors: [F("fred:M2SL", "M2 money supply", "pct12"), F("fred:UNRATE", "Unemployment rate", "level")],
    quality: { auc: 0.669, skill: 0.08, grade: "Modest", since: 1960 },
    why: "Fast money growth and a tight job market come before inflation picks up. The weakest of the monitors: treat it as a hint."
  }
];
