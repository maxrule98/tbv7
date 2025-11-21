"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MacdAr4Strategy = void 0;
const indicators_1 = require("@agenai/indicators");
const models_quant_1 = require("@agenai/models-quant");
class MacdAr4Strategy {
    constructor(config, deps) {
        this.config = config;
        this.deps = deps;
        if (!deps?.getHTFTrend) {
            throw new Error("MacdAr4Strategy requires a higher timeframe trend fetcher");
        }
    }
    async decide(candles, position = "FLAT") {
        const minCandlesNeeded = Math.max(this.config.emaSlow + this.config.signal, this.config.pullbackSlow + 2, this.config.atrPeriod + 1, this.config.rsiPeriod + 1, this.config.arWindow);
        if (candles.length < minCandlesNeeded) {
            return this.noAction(candles, "insufficient_candles");
        }
        const latest = candles[candles.length - 1];
        const closes = candles.map((candle) => candle.close);
        const macdNow = (0, indicators_1.macd)(closes, this.config.emaFast, this.config.emaSlow, this.config.signal);
        const histogramNow = macdNow.histogram;
        if (histogramNow === null) {
            return this.noAction(candles, "macd_unavailable");
        }
        const macdPrevious = (0, indicators_1.macd)(closes.slice(0, closes.length - 1), this.config.emaFast, this.config.emaSlow, this.config.signal);
        const histogramPrev = macdPrevious.histogram;
        const histogramSeries = this.computeHistogramSeries(closes);
        const histogramWindow = histogramSeries.slice(-this.config.arWindow);
        const forecast = histogramWindow.length >= this.config.arWindow
            ? (0, models_quant_1.ar4Forecast)(histogramWindow)
            : null;
        const atrValue = (0, indicators_1.calculateATR)(candles.map((candle) => ({
            high: candle.high,
            low: candle.low,
            close: candle.close,
        })), this.config.atrPeriod);
        const rsiValue = (0, indicators_1.calculateRSI)(closes, this.config.rsiPeriod);
        const pullbackFast = (0, indicators_1.ema)(closes, this.config.pullbackFast);
        const pullbackSlow = (0, indicators_1.ema)(closes, this.config.pullbackSlow);
        const pullbackZoneActive = this.isWithinPullbackZone(latest, pullbackFast, pullbackSlow);
        const trend = await this.deps.getHTFTrend(latest.symbol, this.config.higherTimeframe);
        const htfTrend = this.normalizeTrend(trend);
        const atrInRange = this.isAtrInRange(atrValue);
        const rsiLongInRange = this.isValueBetween(rsiValue, this.config.rsiLongRange);
        const rsiShortInRange = this.isValueBetween(rsiValue, this.config.rsiShortRange);
        const forecastPositive = forecast !== null && forecast > this.config.minForecast;
        const forecastNegative = forecast !== null && forecast < -this.config.minForecast;
        const macdBullish = this.isMacdBullish(histogramNow, histogramPrev);
        const macdBearish = this.isMacdBearish(histogramNow, histogramPrev);
        const longSetupActive = htfTrend.isBull &&
            macdBullish &&
            forecastPositive &&
            rsiLongInRange &&
            atrInRange &&
            pullbackZoneActive;
        const shortSetupActive = htfTrend.isBear &&
            macdBearish &&
            forecastNegative &&
            rsiShortInRange &&
            atrInRange &&
            pullbackZoneActive;
        const longConfluence = longSetupActive && position === "FLAT";
        const shortConfluence = shortSetupActive && position === "FLAT";
        this.logStrategyContext(latest, {
            htfTrend: htfTrend.label,
            rsi: rsiValue,
            atr: atrValue,
            macd1mHist: histogramNow,
            forecast,
            checks: {
                htfBullish: htfTrend.isBull,
                htfBearish: htfTrend.isBear,
                atrInRange,
                rsiLongInRange,
                rsiShortInRange,
                macdBullish,
                macdBearish,
                forecastPositive,
                forecastNegative,
                pullbackZoneActive,
                positionFlat: position === "FLAT",
                longSetupActive,
                shortSetupActive,
            },
        });
        if (position === "LONG") {
            if (shortSetupActive) {
                return {
                    symbol: latest.symbol,
                    intent: "CLOSE_LONG",
                    reason: "opposite_confluence",
                };
            }
            if (forecastNegative) {
                return {
                    symbol: latest.symbol,
                    intent: "CLOSE_LONG",
                    reason: "forecast_flip",
                };
            }
            if (!rsiLongInRange && rsiValue !== null) {
                return {
                    symbol: latest.symbol,
                    intent: "CLOSE_LONG",
                    reason: "rsi_regime_break",
                };
            }
            return this.noAction(candles, "holding_long");
        }
        if (longConfluence) {
            return {
                symbol: latest.symbol,
                intent: "OPEN_LONG",
                reason: "long_confluence_met",
            };
        }
        if (shortConfluence) {
            return this.noAction(candles, "short_signal_unavailable");
        }
        return this.noAction(candles, "no_signal");
    }
    isAtrInRange(atrValue) {
        if (atrValue === null) {
            return false;
        }
        return atrValue >= this.config.minAtr && atrValue <= this.config.maxAtr;
    }
    isValueBetween(value, range) {
        if (value === null) {
            return false;
        }
        return value >= range[0] && value <= range[1];
    }
    isMacdBullish(histogramNow, histogramPrev) {
        if (histogramNow === null || histogramPrev === null) {
            return false;
        }
        return (histogramNow > histogramPrev || (histogramPrev <= 0 && histogramNow > 0));
    }
    isMacdBearish(histogramNow, histogramPrev) {
        if (histogramNow === null || histogramPrev === null) {
            return false;
        }
        return (histogramNow < histogramPrev || (histogramPrev >= 0 && histogramNow < 0));
    }
    isWithinPullbackZone(latest, pullbackFast, pullbackSlow) {
        if (pullbackFast === null || pullbackSlow === null) {
            return false;
        }
        const upper = Math.max(pullbackFast, pullbackSlow);
        const lower = Math.min(pullbackFast, pullbackSlow);
        return latest.low <= upper && latest.high >= lower;
    }
    normalizeTrend(trend) {
        if (!trend) {
            return {
                macdHist: null,
                isBull: false,
                isBear: false,
                isNeutral: true,
                label: "neutral",
            };
        }
        const label = trend.isBull
            ? "bull"
            : trend.isBear
                ? "bear"
                : "neutral";
        return { ...trend, label };
    }
    logStrategyContext(latest, context) {
        console.log(JSON.stringify({
            event: "strategy_context",
            symbol: latest.symbol,
            timeframe: latest.timeframe,
            timestamp: new Date(latest.timestamp).toISOString(),
            htfTrend: context.htfTrend,
            rsi: context.rsi,
            atr: context.atr,
            macd1mHist: context.macd1mHist,
            forecast: context.forecast,
            confluenceChecks: context.checks,
        }));
    }
    computeHistogramSeries(closes) {
        if (closes.length === 0) {
            return [];
        }
        const fastSeries = this.calculateEmaSeries(closes, this.config.emaFast);
        const slowSeries = this.calculateEmaSeries(closes, this.config.emaSlow);
        const macdSeries = fastSeries.map((fastValue, index) => {
            const slowValue = slowSeries[index];
            if (fastValue === null || slowValue === null) {
                return null;
            }
            return fastValue - slowValue;
        });
        const signalSeries = this.calculateSignalSeries(macdSeries, this.config.signal);
        const histogramSeries = macdSeries.map((macdValue, index) => {
            const signalValue = signalSeries[index];
            if (macdValue === null || signalValue === null) {
                return null;
            }
            return macdValue - signalValue;
        });
        return histogramSeries.filter((value) => value !== null);
    }
    calculateEmaSeries(values, length) {
        const series = new Array(values.length).fill(null);
        if (length <= 0 || values.length < length) {
            return series;
        }
        const multiplier = 2 / (length + 1);
        let emaValue = this.average(values.slice(0, length));
        series[length - 1] = emaValue;
        for (let i = length; i < values.length; i += 1) {
            emaValue = (values[i] - emaValue) * multiplier + emaValue;
            series[i] = emaValue;
        }
        return series;
    }
    calculateSignalSeries(values, length) {
        const series = new Array(values.length).fill(null);
        if (length <= 0) {
            return series;
        }
        const multiplier = 2 / (length + 1);
        const seed = [];
        let emaValue = null;
        for (let i = 0; i < values.length; i += 1) {
            const value = values[i];
            if (value === null) {
                continue;
            }
            if (emaValue === null) {
                seed.push(value);
                if (seed.length === length) {
                    emaValue = this.average(seed);
                    series[i] = emaValue;
                }
                continue;
            }
            emaValue = (value - emaValue) * multiplier + emaValue;
            series[i] = emaValue;
        }
        return series;
    }
    average(values) {
        const sum = values.reduce((acc, value) => acc + value, 0);
        return sum / values.length;
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
exports.MacdAr4Strategy = MacdAr4Strategy;
