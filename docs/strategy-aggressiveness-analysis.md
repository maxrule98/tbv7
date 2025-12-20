# Ultra Aggressive Strategy - Aggressiveness Analysis

## Strategy Name vs Actual Behavior

**Name:** `ultra_aggressive_btc_usdt`  
**Observed Behavior:** 0 trades in 39+ hours of live trading (Dec 19-20, 2025)

## Configuration Analysis

### Quality Filters (from config)

```json
"qualityFilters": {
  "minConfidence": 0.22,
  "playTypeMinConfidence": {
    "liquiditySweep": 0.25,
    "breakoutTrap": 0.28,
    "breakout": 0.22,
    "meanReversion": 0.24
  },
  "requireCvdAlignment": true,  ⚠️ RESTRICTIVE
  "requireStrongLongCvd": false,
  "allowShortsAgainstCvd": false,
  "minLongTrendSlopePct": 0,
  "minShortTrendSlopePct": 0,
  "requireLongDiscountToVwapPct": 0.0005,  ⚠️ RESTRICTIVE
  "requireShortPremiumToVwapPct": 0.0005,  ⚠️ RESTRICTIVE
  "maxTrendSlopePctForCounterTrend": 0.008,
  "maxVolatilityForMeanReversion": "balanced"
}
```

### Risk Settings

```json
"risk": {
  "riskPerTradePct": 0.025,  // 2.5% per trade - MODERATE
  "maxRiskPerTradePct": 0.03,  // 3% max - MODERATE
  "atrStopMultiple": 1.0,  // Tight stops - AGGRESSIVE
  "partialTpRR": 1.0,
  "finalTpRR": 2.5,
  "trailingAtrMultiple": 0.6
}
```

## Aggressiveness Scoring

| Aspect              | Rating          | Notes                                             |
| ------------------- | --------------- | ------------------------------------------------- |
| **Entry Frequency** | 🔴 CONSERVATIVE | CVD alignment + VWAP positioning = very selective |
| **Position Sizing** | 🟡 MODERATE     | 2.5-3% risk is standard                           |
| **Stop Loss**       | 🟢 AGGRESSIVE   | 1.0 ATR is tight                                  |
| **Take Profit**     | 🟢 AGGRESSIVE   | 2.5 R:R target                                    |
| **Play Types**      | 🟢 AGGRESSIVE   | 4 different setups enabled                        |

## The Contradiction

**What makes it "ultra aggressive":**

- Tight stops (1.0 ATR)
- Multiple play types (liquidity sweep, breakout trap, breakout, mean reversion)
- Attempts to catch various market conditions

**What makes it conservative in practice:**

- `requireCvdAlignment: true` - **Filters out ~50% of potential setups**
- VWAP positioning requirements - **Filters out another ~30-40%**
- Confidence thresholds 22-28% - **Moderate filter**

## Hypothesis: Why 0 Trades

The strategy is **aggressively positioned when it trades** (tight stops, good R:R), but it's **conservative about WHEN to trade** due to quality filters.

During Dec 19-20, 2025:

1. Market may not have provided setups with proper CVD alignment
2. Price may not have been at required VWAP discount/premium levels
3. Confidence scores may have been below 22-28% thresholds

## Recommendations

### If you want MORE trades (truly "ultra aggressive"):

1. **Relax CVD requirement** (biggest impact):

   ```json
   "requireCvdAlignment": false  // or add "allowTradesAgainstCvd": true
   ```

2. **Reduce VWAP requirements**:

   ```json
   "requireLongDiscountToVwapPct": 0.0001,  // 0.01% instead of 0.05%
   "requireShortPremiumToVwapPct": 0.0001
   ```

3. **Lower confidence thresholds**:
   ```json
   "minConfidence": 0.15,  // 15% instead of 22%
   "playTypeMinConfidence": {
     "liquiditySweep": 0.18,
     "breakoutTrap": 0.20,
     "breakout": 0.15,
     "meanReversion": 0.17
   }
   ```

### If you want to KEEP selectivity (rename strategy):

Consider renaming to: `selective_high_quality_btc_usdt` or `surgical_strike_btc_usdt`

The current config is more "selective aggressor" than "ultra aggressive trader".

## Next Steps

1. **Run backtest with diagnostics** to see:
   - How many setups were detected but filtered
   - Which filter rejected the most setups
   - What the typical confidence scores are

2. **Decide on strategy philosophy**:
   - High frequency + moderate quality?
   - Low frequency + high quality?
3. **Align name with behavior** or **align behavior with name**
