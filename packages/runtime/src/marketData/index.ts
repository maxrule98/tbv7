// Phase F exports only
export type {
	ClosedCandleEvent,
	ClosedCandleHandler,
	BaseCandleSource,
} from "./types";

export { BinanceBaseCandleSource } from "./BinanceBaseCandleSource";
export { PollingBaseCandleSource } from "./PollingBaseCandleSource";
export { BacktestBaseCandleSource } from "./BacktestBaseCandleSource";
export { MarketDataPlant } from "./MarketDataPlant";

// Aggregation utilities (used by Plant and tests)
export { aggregateCandle, aggregateNewlyClosed } from "./aggregateCandles";
