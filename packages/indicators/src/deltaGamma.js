"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDeltaGamma = void 0;
const classifySign = (value) => {
    if (value === null || value === 0) {
        return "neutral";
    }
    return value > 0 ? "positive" : "negative";
};
const computeDeltaGamma = (currentPrice, vwap, prevDelta = null) => {
    if (currentPrice === null || vwap === null) {
        return {
            delta: null,
            deltaMagnitude: null,
            deltaSign: "neutral",
            gamma: null,
            gammaMagnitude: null,
            gammaSign: "neutral",
            gammaFlipped: false,
            gammaFlipDirection: null,
        };
    }
    const delta = currentPrice - vwap;
    const gamma = prevDelta === null ? null : delta - prevDelta;
    const deltaSign = classifySign(delta);
    const gammaSign = classifySign(gamma);
    const deltaMagnitude = Math.abs(delta);
    const gammaMagnitude = gamma === null ? null : Math.abs(gamma);
    const prevDeltaSign = classifySign(prevDelta);
    const gammaFlipped = prevDelta !== null &&
        delta !== null &&
        prevDeltaSign !== deltaSign &&
        deltaSign !== "neutral" &&
        prevDeltaSign !== "neutral";
    const gammaFlipDirection = gammaFlipped
        ? deltaSign === "positive"
            ? "bullish"
            : "bearish"
        : null;
    return {
        delta,
        deltaMagnitude,
        deltaSign,
        gamma,
        gammaMagnitude,
        gammaSign,
        gammaFlipped,
        gammaFlipDirection,
    };
};
exports.computeDeltaGamma = computeDeltaGamma;
