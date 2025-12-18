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
