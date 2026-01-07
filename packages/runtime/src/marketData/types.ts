import { Candle } from "@agenai/core";

/**
 * Phase F: Closed candle event
 *
 * Emitted when a candle period completes.
 * All Plant-driven runtime components work with this event type.
 */
export interface ClosedCandleEvent {
	venue: string;
	symbol: string;
	timeframe: string;
	candle: Candle;
	arrivalDelayMs: number;
	gapFilled?: boolean;
	source: "ws" | "rest" | "poll" | "backtest";
}

export type ClosedCandleHandler = (
	event: ClosedCandleEvent
) => void | Promise<void>;

/**
 * Phase F: Base candle source interface
 *
 * Providers implementing this interface emit ONLY base timeframe candles.
 * They do NOT handle aggregation, gap repair, or multi-timeframe logic.
 * MarketDataPlant orchestrates these concerns.
 */
export interface BaseCandleSource {
	readonly venue: string;

	/**
	 * Start emitting closed candles for a single timeframe
	 * @param args.symbol - Trading pair symbol
	 * @param args.timeframe - Single base timeframe to emit
	 * @param args.onCandle - Callback for each closed candle
	 */
	start(args: {
		symbol: string;
		timeframe: string;
		onCandle: (
			candle: Candle,
			meta: {
				receivedAt: number;
				source: "ws" | "poll" | "rest" | "backtest";
			}
		) => void;
	}): Promise<void>;

	/**
	 * Stop emitting candles and clean up resources
	 */
	stop(): Promise<void>;
}
