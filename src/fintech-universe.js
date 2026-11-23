// Fintech page universe: which companies count as fintech, in which sub-sector, and the benchmarks they are
// measured against. One sub-sector per company. Symbols are Yahoo's (Nasdaq's are the same for these).
// Plain data, no require(): the renderer loads this file with a <script> tag (window.TkFintechUniverse) for
// renderer/fintechstats.js; src/fintech.js and the tests require() it.
//
// `alias` is a case-sensitive regex source for the names headlines use (renderer/fintechstats.js newsFilter).
// Many fintech names are ordinary words (Affirm, Block, Chime, Bullish, Root, Circle), so those aliases ask for a
// company-like context ("Affirm Holdings", "Block's", "Root Insurance") rather than the bare word.
(function (root) {
  const SUBSECTORS = [
    { id: "pay", name: "Payments & networks", blurb: "Card networks, processors, merchant acquirers, cross-border and remittance." },
    { id: "lend", name: "Lending & BNPL", blurb: "Buy now, pay later, online consumer lenders and digital mortgage." },
    { id: "bank", name: "Digital banks", blurb: "App-first banks and neobanks." },
    { id: "brok", name: "Brokerage & wealth", blurb: "Retail and professional brokers, wealth platforms and market makers." },
    { id: "cryp", name: "Crypto & digital assets", blurb: "Crypto exchanges, stablecoin issuers and digital-asset firms." },
    { id: "infra", name: "Market infrastructure & data", blurb: "Exchanges, electronic bond trading, indexes, data and credit scores." },
    { id: "soft", name: "Financial software", blurb: "Software that banks, small businesses and households run their money on." },
    { id: "ins", name: "Insurtech", blurb: "App-first insurers." }
  ];

  // [sym, sub, fallback name (Nasdaq's name replaces it), headline alias]
  const ROWS = [
    ["V", "pay", "Visa", "Visa(?:'s| Inc\\b)|Visa,? (?:and )?Mastercard|Mastercard,? (?:and )?Visa"],
    ["MA", "pay", "Mastercard", "Mastercard"],
    ["AXP", "pay", "American Express", "American Express|\\bAmex\\b"],
    ["PYPL", "pay", "PayPal", "PayPal|Venmo"],
    ["XYZ", "pay", "Block", "\\bBlock(?: Inc\\b|'s)|Cash App|Afterpay"],
    ["FISV", "pay", "Fiserv", "Fiserv"],
    ["FIS", "pay", "Fidelity National Information Services", "Fidelity National Information"],
    ["GPN", "pay", "Global Payments", "Global Payments"],
    ["CPAY", "pay", "Corpay", "Corpay"],
    ["TOST", "pay", "Toast", "\\bToast(?: Inc\\b|'s (?:shares|stock|earnings|revenue))"],
    ["FOUR", "pay", "Shift4 Payments", "Shift4"],
    ["WEX", "pay", "WEX", "\\bWEX\\b"],
    ["FLYW", "pay", "Flywire", "Flywire"],
    ["PAYO", "pay", "Payoneer", "Payoneer"],
    ["MQ", "pay", "Marqeta", "Marqeta"],
    ["DLO", "pay", "DLocal", "\\b[dD][lL]ocal\\b"],
    ["EVTC", "pay", "Evertec", "Evertec|EVERTEC"],
    ["RELY", "pay", "Remitly", "Remitly"],
    ["WU", "pay", "Western Union", "Western Union"],
    ["IMXI", "pay", "International Money Express", "International Money Express|Intermex"],
    ["PAGS", "pay", "PagSeguro", "PagSeguro|PagBank"],
    ["STNE", "pay", "StoneCo", "StoneCo"],
    ["AFRM", "lend", "Affirm", "\\bAffirm(?: Holdings|'s| Inc\\b| shares| stock)"],
    ["KLAR", "lend", "Klarna", "Klarna"],
    ["SEZL", "lend", "Sezzle", "Sezzle"],
    ["UPST", "lend", "Upstart", "Upstart(?: Holdings|'s| shares| stock)"],
    ["PGY", "lend", "Pagaya", "Pagaya"],
    ["OPFI", "lend", "OppFi", "OppFi"],
    ["ENVA", "lend", "Enova", "\\bEnova\\b"],
    ["RKT", "lend", "Rocket Companies", "Rocket Companies|Rocket Mortgage"],
    ["NU", "bank", "Nu Holdings", "Nubank|Nu Holdings"],
    ["SOFI", "bank", "SoFi Technologies", "\\bSoFi\\b"],
    ["CHYM", "bank", "Chime Financial", "\\bChime(?! [Ii]n\\b)(?:'s| Financial\\b|\\b)"],
    ["DAVE", "bank", "Dave", "\\bDave Inc\\b"],
    ["GDOT", "bank", "Green Dot", "Green Dot"],
    ["KSPI", "bank", "Kaspi.kz", "Kaspi"],
    ["SCHW", "brok", "Charles Schwab", "Schwab"],
    ["HOOD", "brok", "Robinhood", "Robinhood"],
    ["IBKR", "brok", "Interactive Brokers", "Interactive Brokers"],
    ["LPLA", "brok", "LPL Financial", "LPL Financial"],
    ["ETOR", "brok", "eToro", "\\beToro\\b"],
    ["XP", "brok", "XP Inc", "\\bXP Inc\\b"],
    ["VIRT", "brok", "Virtu Financial", "Virtu Financial"],
    ["COIN", "cryp", "Coinbase", "Coinbase"],
    ["CRCL", "cryp", "Circle Internet Group", "Circle Internet|\\bCircle's (?:USDC|stablecoin|shares|stock|IPO)|(?:stablecoin|USDC) issuer Circle"],
    ["GLXY", "cryp", "Galaxy Digital", "Galaxy Digital"],
    ["BLSH", "cryp", "Bullish", "\\bBullish (?:Inc|exchange|IPO|shares|stock|Global)\\b"],
    ["GEMI", "cryp", "Gemini Space Station", "Gemini (?:Space Station|exchange|Trust|IPO)|Winklevoss"],
    ["BKKT", "cryp", "Bakkt", "Bakkt"],
    ["ICE", "infra", "Intercontinental Exchange", "Intercontinental Exchange|NYSE (?:parent|owner)"],
    ["CME", "infra", "CME Group", "\\bCME\\b"],
    ["NDAQ", "infra", "Nasdaq Inc", "\\bNasdaq Inc\\b|exchange operator Nasdaq"],
    ["CBOE", "infra", "Cboe Global Markets", "\\bCboe\\b"],
    ["TW", "infra", "Tradeweb", "Tradeweb"],
    ["MKTX", "infra", "MarketAxess", "MarketAxess"],
    ["MSCI", "infra", "MSCI", "\\bMSCI Inc\\b"],
    ["FDS", "infra", "FactSet", "FactSet"],
    ["FICO", "infra", "Fair Isaac", "\\bFICO\\b|Fair Isaac"],
    ["INTU", "soft", "Intuit", "Intuit|TurboTax|Credit Karma|QuickBooks"],
    ["JKHY", "soft", "Jack Henry", "Jack Henry"],
    ["BILL", "soft", "BILL Holdings", "\\bB(?:ill|ILL) Holdings|Bill\\.com"],
    ["ACIW", "soft", "ACI Worldwide", "ACI Worldwide"],
    ["QTWO", "soft", "Q2 Holdings", "Q2 Holdings"],
    ["NCNO", "soft", "nCino", "\\bnCino\\b"],
    ["ALKT", "soft", "Alkami Technology", "Alkami"],
    ["LMND", "ins", "Lemonade", "\\bLemonade(?: Inc\\b|'s|\\b(?= (?:shares|stock|insurance|earnings)))"],
    ["ROOT", "ins", "Root", "\\bRoot (?:Inc\\b|Insurance)"],
    ["HIPO", "ins", "Hippo", "\\bHippo (?:Holdings|Insurance)|\\bHippo's"]
  ];
  const COMPANIES = ROWS.map(([sym, sub, name, alias]) => ({ sym, sub, name, alias }));

  // SPY first: its trading days are the page's calendar. ETFs Yahoo has no data for are dropped by src/fintech.js.
  const BENCHMARKS = [
    { sym: "SPY", name: "S&P 500" },
    { sym: "XLF", name: "Financials sector" },
    { sym: "FINX", name: "Global X FinTech ETF" },
    { sym: "ARKF", name: "ARK Fintech Innovation ETF" },
    { sym: "IPAY", name: "Amplify Digital Payments ETF" }
  ];

  const subOf = Object.fromEntries(COMPANIES.map((c) => [c.sym, c.sub]));
  /** Every symbol to download: benchmarks first, then the companies. */
  const symbols = () => [...BENCHMARKS.map((b) => b.sym), ...COMPANIES.map((c) => c.sym)];

  const api = { SUBSECTORS, COMPANIES, BENCHMARKS, subOf, symbols };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TkFintechUniverse = api;
})(typeof window !== "undefined" ? window : globalThis);
