// Series you can search for by plain name on the Regression page, so nobody needs FRED codes.
// tf = the transform that usually makes sense: % change for prices and indexes, change (points)
// for rates and spreads, % vs a year ago for slow-moving totals.
//   [key, name, category, tf, extra search words]
const C = (key, name, cat, tf, aka = "") => ({ key, name, cat, tf, aka });

module.exports = [
  // inflation
  C("fred:CPIAUCSL", "CPI, consumer prices", "Inflation", "pct", "inflation consumer price index headline"),
  C("fred:CPILFESL", "Core CPI (ex food & energy)", "Inflation", "pct", "inflation core consumer price"),
  C("fred:PCEPI", "PCE prices", "Inflation", "pct", "inflation personal consumption expenditures"),
  C("fred:PCEPILFE", "Core PCE (Fed's target)", "Inflation", "pct", "inflation core personal consumption fed"),
  C("fred:PPIFIS", "PPI, producer prices", "Inflation", "pct", "inflation wholesale producer price index"),
  C("fred:T5YIE", "5-year inflation expectations", "Inflation", "diff", "breakeven expected inflation market"),
  // jobs
  C("fred:UNRATE", "Unemployment rate", "Jobs", "diff", "jobless labor unemployment"),
  C("fred:PAYEMS", "Nonfarm payrolls (jobs added)", "Jobs", "diff", "jobs report employment nfp hiring"),
  C("fred:ICSA", "Initial jobless claims", "Jobs", "pct", "unemployment claims layoffs weekly"),
  C("fred:JTSJOL", "Job openings (JOLTS)", "Jobs", "pct", "vacancies hiring labor demand"),
  C("fred:CES0500000003", "Average hourly earnings", "Jobs", "yoy", "wages pay salary wage growth"),
  // growth
  C("fred:GDPC1", "Real GDP (quarterly)", "Growth", "pct", "economy output gross domestic product growth"),
  C("fred:INDPRO", "Industrial production", "Growth", "pct", "factory manufacturing output"),
  C("fred:RSAFS", "Retail sales", "Growth", "pct", "consumer spending shopping"),
  C("fred:PCEC96", "Real consumer spending", "Growth", "pct", "personal consumption expenditures consumer"),
  C("fred:UMCSENT", "Consumer sentiment (UMich)", "Growth", "diff", "confidence michigan survey mood"),
  C("fred:HOUST", "Housing starts", "Housing", "pct", "construction new homes building"),
  C("fred:CSUSHPINSA", "Home prices (Case-Shiller)", "Housing", "yoy", "house prices real estate housing"),
  C("fred:MORTGAGE30US", "30-year mortgage rate", "Housing", "diff", "mortgage rates home loan"),
  // rates
  C("fred:DFF", "Fed funds rate", "Rates", "diff", "federal reserve policy rate interest fomc"),
  C("fred:DGS3MO", "3-month Treasury bill yield", "Rates", "diff", "t-bill short rate treasury"),
  C("fred:DGS2", "2-year Treasury yield", "Rates", "diff", "treasury bond yield interest rate"),
  C("fred:DGS10", "10-year Treasury yield", "Rates", "diff", "treasury bond yield interest rate 10y ten"),
  C("fred:DGS30", "30-year Treasury yield", "Rates", "diff", "treasury long bond yield"),
  C("fred:DFII10", "10-year real yield (TIPS)", "Rates", "diff", "real interest rate inflation adjusted tips"),
  C("fred:T10Y2Y", "Yield curve (10y minus 2y)", "Rates", "diff", "curve spread inversion recession"),
  C("fred:T10Y3M", "Yield curve (10y minus 3m)", "Rates", "diff", "curve spread inversion recession"),
  // credit & money
  C("fred:BAMLH0A0HYM2", "High-yield (junk) bond spread (last 3 years only)", "Credit", "diff", "credit spread risk junk bonds"),
  C("fred:BAMLC0A0CM", "Investment-grade bond spread", "Credit", "diff", "credit spread corporate bonds"),
  C("fred:BAA10Y", "Corporate bond spread (Baa, since 1986)", "Credit", "diff", "credit spread corporate bonds baa moodys long history"),
  C("fred:NFCI", "Financial conditions (Chicago Fed)", "Credit", "diff", "stress conditions liquidity"),
  C("fred:M2SL", "M2 money supply", "Money", "yoy", "money printing liquidity"),
  C("fred:WALCL", "Fed balance sheet", "Money", "pct", "qe quantitative easing liquidity assets"),
  // markets
  C("yahoo:^GSPC", "S&P 500", "Stocks", "pct", "stock market spx sp500 index"),
  C("yahoo:^IXIC", "Nasdaq Composite", "Stocks", "pct", "tech stocks nasdaq index"),
  C("yahoo:^DJI", "Dow Jones Industrial Average", "Stocks", "pct", "dow stocks index"),
  C("yahoo:^RUT", "Russell 2000 (small caps)", "Stocks", "pct", "small cap stocks index"),
  C("yahoo:^VIX", "VIX (volatility / fear index)", "Stocks", "pct", "volatility fear risk"),
  C("yahoo:^STOXX50E", "Euro Stoxx 50 (Europe)", "Stocks", "pct", "europe european stocks"),
  C("yahoo:^N225", "Nikkei 225 (Japan)", "Stocks", "pct", "japan japanese stocks"),
  C("yahoo:EEM", "Emerging markets stocks (EEM)", "Stocks", "pct", "emerging markets china india brazil"),
  C("yahoo:TLT", "Long-term Treasury bonds (TLT)", "Bonds", "pct", "bonds treasuries etf"),
  C("yahoo:HYG", "High-yield bonds (HYG)", "Bonds", "pct", "junk bonds credit etf"),
  C("yahoo:CL=F", "Crude oil (WTI)", "Commodities", "pct", "oil crude wti energy petroleum"),
  C("yahoo:BZ=F", "Crude oil (Brent)", "Commodities", "pct", "oil crude brent energy"),
  C("yahoo:NG=F", "Natural gas", "Commodities", "pct", "gas energy natgas"),
  C("yahoo:GC=F", "Gold", "Commodities", "pct", "gold precious metals bullion"),
  C("yahoo:SI=F", "Silver", "Commodities", "pct", "silver precious metals"),
  C("yahoo:HG=F", "Copper", "Commodities", "pct", "copper industrial metals dr copper"),
  C("yahoo:ZC=F", "Corn", "Commodities", "pct", "corn grain agriculture"),
  C("yahoo:DX-Y.NYB", "US dollar index", "Currencies", "pct", "dollar dxy usd currency"),
  C("yahoo:EURUSD=X", "Euro vs dollar", "Currencies", "pct", "euro eur currency fx"),
  C("yahoo:JPY=X", "Dollar vs yen", "Currencies", "pct", "yen jpy japan currency fx"),
  C("yahoo:BTC-USD", "Bitcoin", "Crypto", "pct", "bitcoin crypto btc"),
  C("yahoo:ETH-USD", "Ethereum", "Crypto", "pct", "ethereum crypto eth"),
  // sectors
  C("yahoo:XLK", "Tech sector (XLK)", "Sectors", "pct", "technology sector etf"),
  C("yahoo:XLE", "Energy sector (XLE)", "Sectors", "pct", "energy oil sector etf"),
  C("yahoo:XLF", "Financials sector (XLF)", "Sectors", "pct", "banks financial sector etf"),
  C("yahoo:XLV", "Health care sector (XLV)", "Sectors", "pct", "healthcare pharma sector etf"),
  C("yahoo:XLRE", "Real estate sector (XLRE)", "Sectors", "pct", "reits real estate sector etf"),
  C("yahoo:JETS", "Airlines (JETS)", "Sectors", "pct", "airlines travel etf")
];
