"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sma = sma;
function sma(values, period) {
    if (period <= 0 || values.length < period) {
        return null;
    }
    const window = values.slice(values.length - period);
    const sum = window.reduce((acc, value) => acc + value, 0);
    return Number((sum / period).toFixed(6));
}
