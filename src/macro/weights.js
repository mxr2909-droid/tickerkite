// Default scorecard weights. On first launch these are copied to
// ~/Library/Application Support/WIRE/scorecard-weights.json (View › Edit Scorecard Weights…).
//
// Each asset gives every factor a weight from -2 to +2: how much "more of this factor"
// helps (+) or hurts (-) that asset over the next 6–12 months. 0 or missing = ignored.
// A weight can also be { "level": x, "trend": y } to score the level and the 6-month
// trend separately (bonds: high yields pay more income, rising yields cut prices).

module.exports = {
  horizonMonths: 6,  // how far back "trend" looks
  historyYears: 10,  // window for "high or low vs history"
  levelShare: 0.35,  // default mix: 35% level, 65% trend (indicators can override)
  stretch: 1.5,      // spreads the average out to 0–100; 1 = raw average
  assets: {
    stocks: {
      growth: 2, inflation: -1, labor: 1, yields: -1, fed: 1, credit: 2, conditions: 1,
      dollar: -1, stress: -2, consumer: 1, global: 1, trend_stocks: 1
    },
    bonds: {
      growth: -1, inflation: -2, labor: -1, yields: { level: 1, trend: -1.5 }, fed: 2, credit: 1,
      stress: 1, consumer: -0.5, global: -1, trend_bonds: 1
    },
    commodities: {
      growth: 2, inflation: 2, labor: 1, yields: -1, fed: 1, credit: 1, conditions: 1,
      dollar: -2, stress: -1, global: 2, trend_commodities: 1
    },
    realestate: {
      growth: 1, labor: 1, yields: -2, fed: 2, credit: 1, conditions: 1,
      stress: -1, consumer: 1.5, trend_realestate: 1
    },
    crypto: {
      growth: 1, yields: -1, fed: 2, credit: 1, conditions: 2,
      dollar: -1, stress: -2, global: 1, trend_crypto: 2
    },
    alts: {
      inflation: 1, yields: -2, fed: 1, dollar: -2, stress: 1, trend_alts: 1
    }
  }
};
