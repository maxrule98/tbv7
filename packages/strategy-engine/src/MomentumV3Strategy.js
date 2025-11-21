"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MomentumV3Strategy = void 0;
const indicators_1 = require("@agenai/indicators");
class MomentumV3Strategy {
    constructor(config, deps) {
        this.config = config;
        this.deps = deps;
        this.toAtrInput = (candle) => ({
            high: candle.high,
            low: candle.low,
            close: candle.close,
        });
        if (!deps?.getHTFTrend) {
            throw new Error("MomentumV3Strategy requires a higher timeframe trend fetcher");
        }
    }
    async decide(candles, position = "FLAT") {
        if (candles.length < this.minimumCandlesRequired()) {
            return this.noAction(candles, "insufficient_candles");
        }
        const latest = candles[candles.length - 1];
        const closes = candles.map((candle) => candle.close);
        const volumes = candles.map((candle) => candle.volume);
        const rsiValue = (0, indicators_1.calculateRSI)(closes, this.config.rsiPeriod);
        const atrSeries = (0, indicators_1.calculateATRSeries)(candles.map(this.toAtrInput), this.config.atrPeriod);
        const atrValue = atrSeries.length ? atrSeries[atrSeries.length - 1] : null;
        const atrEmaValue = this.calculateAtrEma(atrSeries);
        const atrInBreakout = atrValue !== null && atrEmaValue !== null && atrValue > atrEmaValue;
        const volumeSma = (0, indicators_1.sma)(volumes, this.config.volumeSmaPeriod);
        const volumeSpike = volumeSma !== null &&
            latest.volume > volumeSma * this.config.volumeSpikeMultiplier;
        const macdResult = (0, indicators_1.macd)(closes, this.config.macdFast, this.config.macdSlow, this.config.macdSignal);
        const macdHist1m = macdResult.histogram;
        const macdBullish = macdHist1m !== null && macdHist1m > 0;
        const macdBearish = macdHist1m !== null && macdHist1m < 0;
        const breakoutWindow = this.getBreakoutWindow(candles);
        const breakoutLong = this.isBreakoutLong(latest.close, breakoutWindow);
        const breakoutShort = this.isBreakoutShort(latest.close, breakoutWindow);
        const trend = await this.deps.getHTFTrend(latest.symbol, this.config.htfTimeframe);
        const htfTrend = this.toTrendLabel(trend);
        const htfBullish = htfTrend === "bull";
        const htfBearish = htfTrend === "bear";
        const rsiLongInRange = this.isValueInRange(rsiValue, this.config.rsiLongRange);
        const rsiShortInRange = this.isValueInRange(rsiValue, this.config.rsiShortRange);
        const rsiBearBiasPadding = this.config.rsiBearBiasPadding ?? 2;
        const longRsiBiasSatisfied = htfBearish
            ? Boolean(rsiValue !== null &&
                rsiValue >= this.config.rsiLongRange[0] + rsiBearBiasPadding &&
                rsiValue <= this.config.rsiLongRange[1])
            : rsiLongInRange;
        const longSetupActive = breakoutLong &&
            atrInBreakout &&
            volumeSpike &&
            macdBullish &&
            longRsiBiasSatisfied;
        const shortSetupActive = breakoutShort &&
            atrInBreakout &&
            volumeSpike &&
            macdBearish &&
            rsiShortInRange;
        this.logStrategyContext(latest, {
            htfTrend,
            rsi: rsiValue,
            atr: atrValue,
            atrEma: atrEmaValue,
            atrBreakout: atrInBreakout,
            volume: latest.volume,
            volumeSma,
            volumeSpike,
            macd1mHist: macdHist1m,
            breakoutLong,
            breakoutShort,
            confluenceChecks: {
                htfBullish,
                htfBearish,
                atrInBreakout,
                volumeInBreakout: volumeSpike,
                rsiLongInRange,
                rsiShortInRange,
                macdBullish,
                macdBearish,
                longSetupActive,
                shortSetupActive,
                positionFlat: position === "FLAT",
                positionLong: position === "LONG",
                positionShort: position === "SHORT",
            },
        });
        if (position === "LONG") {
            const closeReason = this.getCloseReason({
                shortSetupActive,
                macdBearish,
                atrInBreakout,
                volumeSpike,
                rsiValue,
            });
            if (closeReason) {
                return {
                    symbol: latest.symbol,
                    intent: "CLOSE_LONG",
                    reason: closeReason,
                };
            }
            return this.noAction(candles, "holding_long");
        }
        if (position === "FLAT" && longSetupActive) {
            return {
                symbol: latest.symbol,
                intent: "OPEN_LONG",
                reason: "momentum_long_confluence",
            };
        }
        return this.noAction(candles, "no_signal");
    }
    minimumCandlesRequired() {
        return Math.max(this.config.breakoutLookback + 1, this.config.atrPeriod + this.config.atrEmaPeriod, this.config.volumeSmaPeriod, this.config.rsiPeriod + 1);
    }
    calculateAtrEma(series) {
        if (series.length < this.config.atrEmaPeriod) {
            return null;
        }
        const window = series.slice(-this.config.atrEmaPeriod);
        return (0, indicators_1.ema)(window, this.config.atrEmaPeriod);
    }
    getBreakoutWindow(candles) {
        const lookback = this.config.breakoutLookback;
        const start = Math.max(0, candles.length - (lookback + 1));
        return candles.slice(start, candles.length - 1);
    }
    isBreakoutLong(price, window) {
        if (window.length < this.config.breakoutLookback) {
            return false;
        }
        const highestHigh = Math.max(...window.map((candle) => candle.high));
        return price > highestHigh;
    }
    isBreakoutShort(price, window) {
        if (window.length < this.config.breakoutLookback) {
            return false;
        }
        const lowestLow = Math.min(...window.map((candle) => candle.low));
        return price < lowestLow;
    }
    toTrendLabel(trend) {
        if (!trend) {
            return "chop";
        }
        if (trend.isBull) {
            return "bull";
        }
        if (trend.isBear) {
            return "bear";
        }
        return "chop";
    }
    isValueInRange(value, range) {
        if (value === null) {
            return false;
        }
        return value >= range[0] && value <= range[1];
    }
    getCloseReason(params) {
        if (params.shortSetupActive) {
            return "momentum_opposite_signal";
        }
        if (params.macdBearish) {
            return "momentum_macd_flip_down";
        }
        if (!params.atrInBreakout && !params.volumeSpike) {
            return "momentum_volatility_collapse";
        }
        const exitBuffer = this.config.rsiExitBuffer ?? 5;
        if (params.rsiValue !== null &&
            params.rsiValue < this.config.rsiLongRange[0] - exitBuffer) {
            return "momentum_rsi_exit";
        }
        return null;
    }
    logStrategyContext(latest, payload) {
        console.log(JSON.stringify({
            event: "strategy_context",
            symbol: latest.symbol,
            timeframe: latest.timeframe,
            timestamp: new Date(latest.timestamp).toISOString(),
            ...payload,
        }));
    }
    noAction(candles, reason) {
        const latestSymbol = candles.length > 0 ? candles[candles.length - 1].symbol : "UNKNOWN";
        return {
            symbol: latestSymbol,
            intent: "NO_ACTION",
            reason,
        };
    }
}
exports.MomentumV3Strategy = MomentumV3Strategy;
