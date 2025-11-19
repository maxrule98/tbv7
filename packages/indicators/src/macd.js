"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.macd = macd;
const ema_1 = require("./ema");
function macd(closes, fast, slow, signalLength) {
    if (closes.length === 0 || slow <= 0 || fast <= 0 || signalLength <= 0) {
        return { macd: null, signal: null, histogram: null };
    }
    const fastSeries = calculateEmaSeries(closes, fast);
    const slowSeries = calculateEmaSeries(closes, slow);
    const macdSeries = fastSeries.map((fastValue, index) => {
        const slowValue = slowSeries[index];
        if (fastValue === null || slowValue === null) {
            return null;
        }
        return fastValue - slowValue;
    });
    const latestMacd = lastDefined(macdSeries);
    const macdValues = macdSeries.filter((value) => value !== null);
    const signalValue = macdValues.length >= signalLength ? (0, ema_1.ema)(macdValues, signalLength) : null;
    const histogram = latestMacd !== null && signalValue !== null ? latestMacd - signalValue : null;
    return {
        macd: latestMacd,
        signal: signalValue,
        histogram
    };
}
const calculateEmaSeries = (values, length) => {
    const series = new Array(values.length).fill(null);
    if (length <= 0 || values.length < length) {
        return series;
    }
    const multiplier = 2 / (length + 1);
    let emaValue = average(values.slice(0, length));
    series[length - 1] = emaValue;
    for (let i = length; i < values.length; i += 1) {
        emaValue = (values[i] - emaValue) * multiplier + emaValue;
        series[i] = emaValue;
    }
    return series;
};
const average = (nums) => {
    const sum = nums.reduce((acc, value) => acc + value, 0);
    return sum / nums.length;
};
const lastDefined = (values) => {
    for (let i = values.length - 1; i >= 0; i -= 1) {
        const value = values[i];
        if (value !== null) {
            return value;
        }
    }
    return null;
};
