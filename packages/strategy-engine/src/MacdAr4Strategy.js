"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MacdAr4Strategy = void 0;
const indicators_1 = require("@agenai/indicators");
const models_quant_1 = require("@agenai/models-quant");
class MacdAr4Strategy {
    constructor(config) {
        this.config = config;
    }
    decide(candles, position = "FLAT") {
        if (candles.length < Math.max(this.config.emaSlow, 6)) {
            return this.noAction(candles, "insufficient_candles");
        }
        const closes = candles.map((candle) => candle.close);
        const latest = candles[candles.length - 1];
        const macdResult = (0, indicators_1.macd)(closes, this.config.emaFast, this.config.emaSlow, this.config.signal);
        const { macd: macdValue, signal } = macdResult;
        if (macdValue === null || signal === null) {
            return this.noAction(candles, "macd_unavailable");
        }
        if (this.config.arWindow < 6) {
            return this.noAction(candles, "ar_window_too_small");
        }
        const histogramSeries = this.computeHistogramSeries(closes);
        const histogramWindow = histogramSeries.slice(-this.config.arWindow);
        const forecast = histogramWindow.length >= Math.max(6, this.config.arWindow)
            ? (0, models_quant_1.ar4Forecast)(histogramWindow)
            : null;
        const bearishForecast = forecast !== null && forecast < 0;
        if (position === "LONG" && (macdValue < signal || bearishForecast)) {
            return {
                symbol: latest.symbol,
                intent: "CLOSE_LONG",
                reason: "macd_down_or_forecast_negative",
            };
        }
        if (forecast === null || forecast <= this.config.minForecast) {
            return this.noAction(candles, "forecast_below_threshold");
        }
        if (position !== "LONG" &&
            macdValue > signal &&
            forecast > this.config.minForecast) {
            return {
                symbol: latest.symbol,
                intent: "OPEN_LONG",
                reason: "macd_up_and_forecast_positive",
            };
        }
        return this.noAction(candles, position === "LONG" ? "holding_long" : "no_signal");
    }
    noAction(candles, reason) {
        const latestSymbol = candles.length > 0 ? candles[candles.length - 1].symbol : "UNKNOWN";
        return {
            symbol: latestSymbol,
            intent: "NO_ACTION",
            reason,
        };
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
}
exports.MacdAr4Strategy = MacdAr4Strategy;
