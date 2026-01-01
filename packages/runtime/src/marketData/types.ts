import { Candle } from "@agenai/core";

export interface MarketDataBootstrapRequest {
	symbol: string;
	timeframes: string[];
	limit: number;
}

export interface MarketDataBootstrapResult {
	candlesByTimeframe: Map<string, Candle[]>;
}

export interface ClosedCandleEvent {
	venue: string;
	symbol: string;
	timeframe: string;
	candle: Candle;
	arrivalDelayMs: number;
	gapFilled?: boolean;
	source: "ws" | "rest" | "poll";
}

export type ClosedCandleHandler = (
	event: ClosedCandleEvent
) => void | Promise<void>;

export interface MarketDataFeedOptions {
	symbol: string;
	timeframes: string[];
	executionTimeframe: string;
	fallbackOffsetMs?: number;
	pollIntervalMs?: number;
}

export interface MarketDataFeed {
	start(): void;
	stop(): void;
	onCandle(handler: ClosedCandleHandler): () => void;
}

export interface MarketDataProvider {
	readonly venue: string;
	bootstrap(
		request: MarketDataBootstrapRequest
	): Promise<MarketDataBootstrapResult>;
	createFeed(options: MarketDataFeedOptions): MarketDataFeed;
	fetchCandles(
		symbol: string,
		timeframe: string,
		limit: number,
		since?: number
	): Promise<Candle[]>;
}

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
			meta: { receivedAt: number; source: "ws" | "poll" | "rest" }
		) => void;
	}): Promise<void>;

	/**
	 * Stop emitting candles and clean up resources
	 */
	stop(): Promise<void>;
}
