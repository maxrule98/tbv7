import type { Candle, MarketDataClient } from "@agenai/core";

// Note: MarketDataClient is now imported from @agenai/core
// The interface here was previously duplicated but is now unified
export type { MarketDataClient };

export interface DataProviderLogger {
	info?: (event: string, payload?: Record<string, unknown>) => void;
	warn?: (event: string, payload?: Record<string, unknown>) => void;
	error?: (event: string, payload?: Record<string, unknown>) => void;
}

export interface TimeframeRequest {
	timeframe: string;
	limit?: number;
	warmup?: number;
}

export interface HistoricalSeriesRequest {
	symbol: string;
	startTimestamp: number;
	endTimestamp: number;
	requests: TimeframeRequest[];
}

export interface TimeframeSeries {
	timeframe: string;
	candles: Candle[];
}

export type CandleHandler = (candle: Candle) => void | Promise<void>;

export interface LiveSubscriptionOptions {
	symbol: string;
	timeframes: string[];
	pollIntervalMs?: number;
	bufferSize?: number;
}

export interface LiveSubscription {
	start(): void;
	stop(): void;
	onCandle(handler: CandleHandler): () => void;
	getCandles(timeframe: string): Candle[];
}

export interface DataProvider {
	loadHistoricalSeries(
		options: HistoricalSeriesRequest
	): Promise<TimeframeSeries[]>;
	createLiveSubscription(options: LiveSubscriptionOptions): LiveSubscription;
}

export interface DataProviderConfig {
	client: MarketDataClient;
	defaultBatchSize?: number;
	maxIterations?: number;
	logger?: DataProviderLogger;
}
