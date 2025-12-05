import { Candle } from "@agenai/core";
import { timeframeToMs } from "./utils/timeframe";
import {
	DataProviderLogger,
	HistoricalSeriesRequest,
	MarketDataClient,
	TimeframeSeries,
	TimeframeRequest,
} from "./types";

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_ITERATIONS = 10_000;

interface HistoricalFetchOptions {
	client: MarketDataClient;
	request: TimeframeRequest;
	symbol: string;
	startTimestamp: number;
	endTimestamp: number;
	batchSize?: number;
	maxIterations?: number;
	logger?: DataProviderLogger;
}

export const fetchHistoricalCandles = async (
	options: HistoricalFetchOptions
): Promise<Candle[]> => {
	const batchSize = Math.max(options.batchSize ?? DEFAULT_BATCH_SIZE, 1);
	const maxIterations = Math.max(
		options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
		1
	);
	const timeframeMs = timeframeToMs(options.request.timeframe);
	const warmupCandles = Math.max(options.request.warmup ?? 0, 0);
	const warmupMs = timeframeMs * warmupCandles;
	const limit =
		typeof options.request.limit === "number" && options.request.limit > 0
			? options.request.limit
			: undefined;

	const result: Candle[] = [];
	const seenTimestamps = new Set<number>();
	let since = Math.max(0, options.startTimestamp - warmupMs);
	let iterations = 0;
	let inRangeCount = 0;

	while (since <= options.endTimestamp && iterations < maxIterations) {
		const remaining =
			typeof limit === "number" ? Math.max(limit - inRangeCount, 0) : batchSize;
		if (remaining <= 0) {
			break;
		}

		const fetchLimit = Math.min(batchSize, remaining);
		const batch = await options.client.fetchOHLCV(
			options.symbol,
			options.request.timeframe,
			fetchLimit,
			since
		);

		if (!batch.length) {
			break;
		}

		for (const candle of batch) {
			if (candle.timestamp > options.endTimestamp) {
				return result;
			}

			if (!seenTimestamps.has(candle.timestamp)) {
				result.push(candle);
				seenTimestamps.add(candle.timestamp);
				if (candle.timestamp >= options.startTimestamp) {
					inRangeCount += 1;
					if (typeof limit === "number" && inRangeCount >= limit) {
						return result;
					}
				}
			}
		}

		const last = batch[batch.length - 1];
		if (!last) {
			break;
		}
		since = Math.max(last.timestamp + timeframeMs, since + timeframeMs);
		iterations += 1;
	}

	if (iterations >= maxIterations) {
		options.logger?.warn?.("historical_fetch_iterations_exceeded", {
			timeframe: options.request.timeframe,
			startTimestamp: options.startTimestamp,
			endTimestamp: options.endTimestamp,
			iterations,
			maxIterations,
		});
	}

	return result;
};

export const loadHistoricalSeries = async (
	client: MarketDataClient,
	request: HistoricalSeriesRequest,
	logger?: DataProviderLogger,
	batchSize?: number,
	maxIterations?: number
): Promise<TimeframeSeries[]> => {
	if (!request.requests.length) {
		throw new Error("Historical request requires at least one timeframe");
	}

	const promises = request.requests.map(async (frame) => {
		const candles = await fetchHistoricalCandles({
			client,
			request: frame,
			symbol: request.symbol,
			startTimestamp: request.startTimestamp,
			endTimestamp: request.endTimestamp,
			batchSize,
			maxIterations,
			logger,
		});
		logger?.info?.("historical_timeframe_loaded", {
			timeframe: frame.timeframe,
			candles: candles.length,
			warmup: frame.warmup ?? 0,
			limit: frame.limit ?? null,
		});
		return { timeframe: frame.timeframe, candles } satisfies TimeframeSeries;
	});

	return Promise.all(promises);
};
