export declare const STRATEGY_IDS: readonly ["macd_ar4_v2", "momentum_v3", "vwap_delta_gamma"];
export type StrategyId = (typeof STRATEGY_IDS)[number];
export declare const isStrategyId: (value: unknown) => value is StrategyId;
