// Every indicator on the scorecard: where its data comes from, how it's transformed,
// which section it shows in, and which scoring factor it feeds.
//
// src:    "fred:ID" (St. Louis Fed, no key) or "yahoo:SYMBOL" (daily closes)
// tf:     level | yoy | ann3m | chg3 (3-month average of monthly changes) | ma200 (% above 200-day average)
// factor: the driver it feeds in score.js (growth, inflation, labor, yields, fed, credit, conditions,
//         dollar, stress, consumer, global, or trend_<asset> for each asset's own price trend)
// sign:   +1 if a higher reading means more of that factor, -1 if less
//         (e.g. unemployment up = weaker labor, so -1)
// level:  how much the level counts vs the 6-month trend (default from weights; spreads and VIX lean on level)
// freq:   d / w / m / q, used to judge staleness

const SECTIONS = [
  ["growth", "Growth"],
  ["inflation", "Inflation"],
  ["labor", "Labor"],
  ["rates", "Rates & Fed"],
  ["credit", "Credit & Conditions"],
  ["consumer", "Consumer & Housing"],
  ["markets", "Markets"],
  ["global", "Global"]
];

const I = (id, section, name, src, o) => ({ id, section, name, src, tf: "level", unit: "", dec: 1, sign: 1, freq: "m", ...o });

const INDICATORS = [
  // ---- growth ----
  I("gdp", "growth", "Real GDP growth", "fred:A191RL1Q225SBEA", { unit: "%", factor: "growth", freq: "q",
    desc: "Quarter-over-quarter growth in inflation-adjusted output, annualized. The broadest measure of the economy." }),
  I("gdpnow", "growth", "GDPNow (Atlanta Fed)", "fred:GDPNOW", { unit: "%", factor: "growth", freq: "q",
    desc: "The Atlanta Fed's running estimate of current-quarter GDP growth, updated as data arrives. Months ahead of the official number." }),
  I("indpro", "growth", "Industrial production", "fred:INDPRO", { tf: "yoy", unit: "%", factor: "growth",
    desc: "Output of factories, mines and utilities vs a year ago. Tracks the goods side of the economy." }),
  I("retail", "growth", "Real retail sales", "fred:RRSFS", { tf: "yoy", unit: "%", factor: "growth",
    desc: "Inflation-adjusted retail and food-service sales vs a year ago. Consumer spending is about 70% of US GDP." }),
  I("cfnai", "growth", "Chicago Fed activity index", "fred:CFNAIMA3", { unit: "", dec: 2, factor: "growth",
    desc: "3-month average of 85 activity indicators. Zero is trend growth; below −0.7 has historically signaled recession." }),
  I("philly", "growth", "Philly Fed manufacturing", "fred:GACDFSA066MSFRBPHI", { unit: "", factor: "growth",
    desc: "Survey of regional manufacturers. Above zero means more firms report rising activity than falling. A free stand-in for the ISM survey." }),

  // ---- inflation ----
  I("cpi", "inflation", "CPI", "fred:CPIAUCSL", { tf: "yoy", unit: "%", factor: "inflation",
    desc: "Consumer prices vs a year ago, all items." }),
  I("corecpi", "inflation", "Core CPI", "fred:CPILFESL", { tf: "yoy", unit: "%", factor: "inflation",
    desc: "Consumer prices excluding food and energy vs a year ago. Shows the underlying trend." }),
  I("corecpi3m", "inflation", "Core CPI, 3-mo annualized", "fred:CPILFESL", { tf: "ann3m", unit: "%", factor: "inflation",
    desc: "The last three months of core CPI, annualized. Turns before the year-over-year number does." }),
  I("ppi", "inflation", "PPI final demand", "fred:PPIFIS", { tf: "yoy", unit: "%", factor: "inflation",
    desc: "Producer (wholesale) prices vs a year ago. Often leads consumer prices." }),
  I("coreppi", "inflation", "Core PPI", "fred:PPICOR", { tf: "yoy", unit: "%", factor: "inflation",
    desc: "Producer prices excluding food, energy and trade services vs a year ago." }),
  I("corepce", "inflation", "Core PCE", "fred:PCEPILFE", { tf: "yoy", unit: "%", factor: "inflation",
    desc: "The Fed's preferred inflation gauge, excluding food and energy. The Fed targets 2%." }),
  I("be5", "inflation", "5-year breakeven inflation", "fred:T5YIE", { unit: "%", dec: 2, factor: "inflation", freq: "d",
    desc: "Inflation the bond market expects over the next five years (nominal minus TIPS yield)." }),

  // ---- labor ----
  I("payrolls", "labor", "Nonfarm payrolls (3-mo avg)", "fred:PAYEMS", { tf: "chg3", unit: "k", dec: 0, factor: "labor",
    desc: "Average monthly jobs added over the last three months. Around 100k keeps up with population growth." }),
  I("unrate", "labor", "Unemployment rate", "fred:UNRATE", { unit: "%", factor: "labor", sign: -1,
    desc: "Share of the labor force without a job. A rise of 0.5 points off the low has preceded every modern recession (the Sahm rule)." }),
  I("claims", "labor", "Initial jobless claims (4-wk)", "fred:IC4WSA", { unit: "k", dec: 0, scale: 0.001, factor: "labor", sign: -1, freq: "w",
    desc: "New unemployment filings, 4-week average. The most up-to-date labor signal; rising claims lead layoffs in the payroll data." }),
  I("jolts", "labor", "Job openings (JOLTS)", "fred:JTSJOL", { unit: "M", dec: 2, scale: 0.001, factor: "labor",
    desc: "Unfilled job openings. Falling openings mean employers are pulling back on hiring." }),
  I("ahe", "labor", "Average hourly earnings", "fred:CES0500000003", { tf: "yoy", unit: "%", factor: "labor",
    desc: "Wage growth vs a year ago. Strong wages support spending but can keep inflation sticky." }),

  // ---- rates & Fed ----
  I("ff", "rates", "Fed funds rate", "fred:DFF", { unit: "%", dec: 2, factor: "fed", sign: -1, freq: "d",
    desc: "The Fed's policy rate. Falling means the Fed is easing, which supports most assets." }),
  I("cuts", "rates", "2-year minus Fed funds", "derived:DGS2-DFF", { unit: "pt", dec: 2, factor: "fed", sign: -1, freq: "d",
    desc: "Negative means the bond market expects rate cuts over the next two years; positive means hikes." }),
  I("y2", "rates", "2-year Treasury yield", "fred:DGS2", { unit: "%", dec: 2, factor: "yields", freq: "d",
    desc: "Tracks where the market expects the Fed's rate to go." }),
  I("y10", "rates", "10-year Treasury yield", "fred:DGS10", { unit: "%", dec: 2, factor: "yields", freq: "d",
    desc: "The benchmark long-term rate. Sets mortgage rates and the discount rate for stock valuations." }),
  I("real10", "rates", "10-year real yield (TIPS)", "fred:DFII10", { unit: "%", dec: 2, factor: "yields", freq: "d",
    desc: "The 10-year yield after inflation. Rising real yields pressure stock valuations, gold and crypto most." }),
  I("curve", "rates", "Yield curve (10y − 2y)", "fred:T10Y2Y", { unit: "pt", dec: 2, factor: "growth", level: 0.5, freq: "d",
    desc: "Negative (inverted) has preceded every US recession since the 1970s. A healthy curve slopes upward." }),
  I("curve3m", "rates", "Yield curve (10y − 3m)", "fred:T10Y3M", { unit: "pt", dec: 2, factor: "growth", level: 0.5, freq: "d",
    desc: "The Fed's preferred curve measure for recession risk." }),

  // ---- credit & conditions ----
  I("hy", "credit", "High-yield credit spread", "fred:BAMLH0A0HYM2", { unit: "pt", dec: 2, factor: "credit", sign: -1, level: 0.5, freq: "d",
    desc: "Extra yield investors demand to hold junk bonds over Treasuries. Widening spreads are often the first sign of stress." }),
  I("ig", "credit", "Investment-grade spread", "fred:BAMLC0A0CM", { unit: "pt", dec: 2, factor: "credit", sign: -1, level: 0.5, freq: "d",
    desc: "Extra yield on high-quality corporate bonds over Treasuries." }),
  I("nfci", "credit", "Financial conditions (NFCI)", "fred:NFCI", { unit: "", dec: 2, factor: "conditions", sign: -1, level: 0.5, freq: "w",
    desc: "Chicago Fed index of credit, leverage and risk. Below zero means looser-than-average conditions." }),
  I("vix", "credit", "VIX", "fred:VIXCLS", { unit: "", dec: 1, factor: "stress", level: 0.6, freq: "d",
    desc: "Expected S&P 500 volatility over the next 30 days. Above 25–30 signals fear." }),
  I("dollar", "credit", "Dollar index (broad)", "fred:DTWEXBGS", { unit: "", dec: 1, factor: "dollar", freq: "d",
    desc: "The dollar against a broad basket of currencies. A rising dollar tightens global financial conditions and weighs on commodities." }),

  // ---- consumer & housing ----
  I("sent", "consumer", "Consumer sentiment (UMich)", "fred:UMCSENT", { unit: "", factor: "consumer",
    desc: "University of Michigan survey of how households feel about their finances and the economy." }),
  I("starts", "consumer", "Housing starts", "fred:HOUST", { unit: "k", dec: 0, factor: "consumer",
    desc: "New homes started, annualized. Housing is one of the most rate-sensitive parts of the economy." }),
  I("mort", "consumer", "30-year mortgage rate", "fred:MORTGAGE30US", { unit: "%", dec: 2, factor: "consumer", sign: -1, freq: "w",
    desc: "Freddie Mac's average 30-year fixed rate. Higher rates cut affordability and home sales." }),
  I("homes", "consumer", "Home prices (Case-Shiller)", "fred:CSUSHPINSA", { tf: "yoy", unit: "%", factor: "consumer",
    desc: "National home prices vs a year ago. Runs about two months behind." }),

  // ---- markets: each asset's own trend ----
  I("spx", "markets", "S&P 500 vs 200-day average", "yahoo:^GSPC", { tf: "ma200", unit: "%", factor: "trend_stocks", freq: "d",
    desc: "How far the S&P 500 is above (+) or below (−) its 200-day moving average. The classic trend filter." }),
  I("tlt", "markets", "Long Treasuries vs 200-day", "yahoo:TLT", { tf: "ma200", unit: "%", factor: "trend_bonds", freq: "d",
    desc: "The 20+ year Treasury ETF against its 200-day average." }),
  I("dbc", "markets", "Commodity index vs 200-day", "yahoo:DBC", { tf: "ma200", unit: "%", factor: "trend_commodities", freq: "d",
    desc: "A broad commodities basket (energy, metals, agriculture) against its 200-day average." }),
  I("oil", "markets", "WTI crude vs 200-day", "yahoo:CL=F", { tf: "ma200", unit: "%", factor: "trend_commodities", freq: "d",
    desc: "US crude oil against its 200-day average." }),
  I("vnq", "markets", "REITs vs 200-day", "yahoo:VNQ", { tf: "ma200", unit: "%", factor: "trend_realestate", freq: "d",
    desc: "US real estate investment trusts against their 200-day average." }),
  I("btc", "markets", "Bitcoin vs 200-day", "yahoo:BTC-USD", { tf: "ma200", unit: "%", factor: "trend_crypto", freq: "d",
    desc: "Bitcoin against its 200-day average." }),
  I("gold", "markets", "Gold vs 200-day", "yahoo:GC=F", { tf: "ma200", unit: "%", factor: "trend_alts", freq: "d",
    desc: "Gold against its 200-day average." }),
  I("silver", "markets", "Silver vs 200-day", "yahoo:SI=F", { tf: "ma200", unit: "%", factor: "trend_alts", freq: "d",
    desc: "Silver against its 200-day average." }),
  I("cugold", "markets", "Copper / gold ratio", "derived:HG=F/GC=F", { unit: "×1000", dec: 2, scale: 1000, factor: "growth", freq: "d",
    desc: "Copper (industrial demand) relative to gold (safety). Rises when markets expect stronger growth." }),

  // ---- global ----
  I("ezgdp", "global", "Euro area real GDP", "fred:CLVMNACSCAB1GQEA19", { tf: "yoy", unit: "%", factor: "global", freq: "q",
    desc: "Euro area output vs a year ago." }),
  I("ezhicp", "global", "Euro area inflation (HICP)", "fred:CP0000EZ19M086NEST", { tf: "yoy", unit: "%", factor: "global", sign: -1,
    desc: "Euro area consumer prices vs a year ago. Higher inflation keeps the ECB tight." }),
  I("ecb", "global", "ECB deposit rate", "fred:ECBDFR", { unit: "%", dec: 2, factor: "global", sign: -1, freq: "d",
    desc: "The European Central Bank's policy rate. Cuts ease global financial conditions." }),
  I("boj", "global", "Japan policy rate", "fred:IRSTCI01JPM156N", { unit: "%", dec: 2, factor: "global", sign: -1,
    desc: "Bank of Japan short-term rate. Japanese hikes can pull global money home and tighten conditions." }),
  I("bund", "global", "German 10-year yield", "fred:IRLTLT01DEM156N", { unit: "%", dec: 2, factor: "global", sign: -1,
    desc: "Europe's benchmark long-term rate." }),
  I("china", "global", "China exports", "fred:XTEXVA01CNM667S", { tf: "yoy", unit: "%", factor: "global",
    desc: "Chinese exports vs a year ago, a free proxy for China's activity. Published with a delay of several months." }),
  I("fxi", "global", "China stocks vs 200-day", "yahoo:FXI", { tf: "ma200", unit: "%", factor: "global", freq: "d",
    desc: "Large Chinese companies (FXI) against their 200-day average." }),
  I("eem", "global", "Emerging markets vs 200-day", "yahoo:EEM", { tf: "ma200", unit: "%", factor: "global", freq: "d",
    desc: "Emerging-market stocks (EEM) against their 200-day average." }),
  I("stoxx", "global", "Euro Stoxx 50 vs 200-day", "yahoo:^STOXX50E", { tf: "ma200", unit: "%", factor: "global", freq: "d",
    desc: "Europe's 50 largest companies against their 200-day average." }),
  I("nikkei", "global", "Nikkei 225 vs 200-day", "yahoo:^N225", { tf: "ma200", unit: "%", factor: "global", freq: "d",
    desc: "Japan's main index against its 200-day average." })
];

/** Raw series each indicator needs, e.g. "fred:DGS2" or "yahoo:^GSPC". */
function sourcesFor(def) {
  if (def.src.startsWith("derived:")) {
    const expr = def.src.slice(8);
    if (expr.includes("/")) return expr.split("/").map((s) => "yahoo:" + s);
    return expr.split("-").map((s) => "fred:" + s);
  }
  return [def.src];
}

const RECESSIONS = "fred:USREC";

module.exports = { SECTIONS, INDICATORS, sourcesFor, RECESSIONS };
