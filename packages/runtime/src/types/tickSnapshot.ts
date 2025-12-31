import type { Candle } from "@agenai/core";

/**
 * Candle series indexed by timeframe
 */
export type TickSeries = Record<string, Candle[]>;

/**
 * Source of candle data
 */
export type ClosedCandleSource = "ws" | "rest" | "poll";

/**
 * Rich snapshot of market data at a specific tick
 * Contains execution candle, multi-timeframe series, and metadata
 */
export interface TickSnapshot {
	/** Trading symbol (e.g., "BTC/USDT") */
	symbol: string;

	/** Venue providing signal/market data (e.g., "binance", "mexc") */
	signalVenue: string;

	/** Execution timeframe (e.g., "1m", "5m") */
	executionTimeframe: string;

	/** The candle triggering this tick */
	executionCandle: Candle;

	/** Multi-timeframe candle series */
	series: TickSeries;

	/** Metadata about this snapshot */
	meta: {
		/** Bucketed timestamp of execution candle (aligned to timeframe boundary) */
		asOfTs: number;

		/** Timeframe period in milliseconds for each series */
		tfMs: Record<string, number>;

		/** Data source by timeframe (optional) */
		sourceByTf?: Record<string, ClosedCandleSource>;

		/** Whether gaps were filled for each timeframe (optional) */
		gapFilledByTf?: Record<string, boolean>;

		/** Delay between candle close and arrival (optional, milliseconds) */
		arrivalDelayMs?: number;
	};
}
