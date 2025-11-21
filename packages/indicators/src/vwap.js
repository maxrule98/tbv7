"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateRollingVWAP = exports.calculateMonthlyVWAP = exports.calculateWeeklyVWAP = exports.calculateDailyVWAP = void 0;
const typicalPrice = (candle) => (candle.high + candle.low + candle.close) / 3;
const computeVwap = (candles) => {
    if (!candles.length) {
        return null;
    }
    let pvSum = 0;
    let volumeSum = 0;
    for (const candle of candles) {
        if (candle.volume <= 0) {
            continue;
        }
        pvSum += typicalPrice(candle) * candle.volume;
        volumeSum += candle.volume;
    }
    if (volumeSum <= 0) {
        return null;
    }
    return pvSum / volumeSum;
};
const startOfUtcDay = (timestamp) => {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};
const startOfUtcWeek = (timestamp) => {
    const date = new Date(timestamp);
    const day = date.getUTCDay();
    const daysSinceMonday = (day + 6) % 7; // Monday = 0
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
};
const startOfUtcMonth = (timestamp) => {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};
const filterByStart = (candles, startTimestamp) => candles.filter((candle) => candle.timestamp >= startTimestamp);
const calculateDailyVWAP = (candles) => {
    if (!candles.length) {
        return null;
    }
    const start = startOfUtcDay(candles[candles.length - 1].timestamp);
    return computeVwap(filterByStart(candles, start));
};
exports.calculateDailyVWAP = calculateDailyVWAP;
const calculateWeeklyVWAP = (candles) => {
    if (!candles.length) {
        return null;
    }
    const start = startOfUtcWeek(candles[candles.length - 1].timestamp);
    return computeVwap(filterByStart(candles, start));
};
exports.calculateWeeklyVWAP = calculateWeeklyVWAP;
const calculateMonthlyVWAP = (candles) => {
    if (!candles.length) {
        return null;
    }
    const start = startOfUtcMonth(candles[candles.length - 1].timestamp);
    return computeVwap(filterByStart(candles, start));
};
exports.calculateMonthlyVWAP = calculateMonthlyVWAP;
const calculateRollingVWAP = (candles, period) => {
    if (period <= 0 || candles.length < period) {
        return null;
    }
    const window = candles.slice(-period);
    return computeVwap(window);
};
exports.calculateRollingVWAP = calculateRollingVWAP;
