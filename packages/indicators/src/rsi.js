"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateRSI = calculateRSI;
function calculateRSI(values, period = 14) {
    if (period <= 0 || values.length < period + 1) {
        return null;
    }
    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= period; i += 1) {
        const change = values[i] - values[i - 1];
        if (change >= 0) {
            gainSum += change;
        }
        else {
            lossSum += Math.abs(change);
        }
    }
    let averageGain = gainSum / period;
    let averageLoss = lossSum / period;
    for (let i = period + 1; i < values.length; i += 1) {
        const change = values[i] - values[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        averageGain = (averageGain * (period - 1) + gain) / period;
        averageLoss = (averageLoss * (period - 1) + loss) / period;
    }
    if (averageLoss === 0) {
        return 100;
    }
    const rs = averageGain / averageLoss;
    const rsi = 100 - 100 / (1 + rs);
    return Number(rsi.toFixed(2));
}
