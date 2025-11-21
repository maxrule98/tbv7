"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateAtr5m = exports.calculateAtr1m = void 0;
exports.calculateATR = calculateATR;
exports.calculateATRSeries = calculateATRSeries;
function calculateATR(candles, period = 14) {
    const series = calculateATRSeries(candles, period);
    if (!series.length) {
        return null;
    }
    return series[series.length - 1] ?? null;
}
function calculateATRSeries(candles, period = 14) {
    if (period <= 0 || candles.length < period + 1) {
        return [];
    }
    const trueRanges = computeTrueRanges(candles);
    if (trueRanges.length < period) {
        return [];
    }
    let atr = trueRanges.slice(0, period).reduce((acc, value) => acc + value, 0) / period;
    const series = [Number(atr.toFixed(6))];
    for (let i = period; i < trueRanges.length; i += 1) {
        atr = (atr * (period - 1) + trueRanges[i]) / period;
        series.push(Number(atr.toFixed(6)));
    }
    return series;
}
const computeTrueRanges = (candles) => {
    const trueRanges = [];
    for (let i = 1; i < candles.length; i += 1) {
        const current = candles[i];
        const previousClose = candles[i - 1].close;
        const highLow = current.high - current.low;
        const highClose = Math.abs(current.high - previousClose);
        const lowClose = Math.abs(current.low - previousClose);
        trueRanges.push(Math.max(highLow, highClose, lowClose));
    }
    return trueRanges;
};
const calculateAtr1m = (candles, period = 14) => calculateATR(candles, period);
exports.calculateAtr1m = calculateAtr1m;
const calculateAtr5m = (candles, period = 14) => calculateATR(candles, period);
exports.calculateAtr5m = calculateAtr5m;
