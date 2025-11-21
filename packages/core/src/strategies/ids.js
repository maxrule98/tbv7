"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStrategyId = exports.STRATEGY_IDS = void 0;
exports.STRATEGY_IDS = [
    "macd_ar4_v2",
    "momentum_v3",
    "vwap_delta_gamma",
];
const isStrategyId = (value) => {
    return (typeof value === "string" &&
        exports.STRATEGY_IDS.includes(value));
};
exports.isStrategyId = isStrategyId;
