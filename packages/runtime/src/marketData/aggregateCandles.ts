import type { Candle } from "@agenai/core";
import { timeframeToMs, bucketTimestamp } from "@agenai/core";

/**
 * Aggregate base timeframe candles into a higher timeframe candle
 *
 * Pure aggregation function that composes OHLCV data from base candles
 * that fall within a target timeframe bucket.
 *
 * @param baseCandles - Sorted array of base timeframe candles
 * @param targetTimeframe - Target timeframe to aggregate to (e.g., "5m", "15m")
 * @param targetBucketTimestamp - The bucket timestamp for the target candle
 * @param symbol - Symbol for the aggregated candle
 * @returns Aggregated candle or null if insufficient data
 */
export function aggregateCandle(
	baseCandles: Candle[],
	targetTimeframe: string,
	targetBucketTimestamp: number,
	symbol: string
): Candle | null {
	const targetMs = timeframeToMs(targetTimeframe);
	const bucketStart = targetBucketTimestamp;
	const bucketEnd = bucketStart + targetMs;

	// Filter base candles that fall within this target bucket
	const candlesInBucket = baseCandles.filter(
		(c) => c.timestamp >= bucketStart && c.timestamp < bucketEnd
	);

	if (candlesInBucket.length === 0) {
		return null;
	}

	// Aggregate OHLCV
	const open = candlesInBucket[0].open;
	const close = candlesInBucket[candlesInBucket.length - 1].close;
	const high = Math.max(...candlesInBucket.map((c) => c.high));
	const low = Math.min(...candlesInBucket.map((c) => c.low));
	const volume = candlesInBucket.reduce((sum, c) => sum + c.volume, 0);

	return {
		symbol,
		timeframe: targetTimeframe,
		timestamp: targetBucketTimestamp,
		open,
		high,
		low,
		close,
		volume,
	};
}

/**
 * Detect which target timeframes have newly closed buckets
 * based on the latest base candle timestamp
 *
 * @param previousBaseTsMs - Previous base candle timestamp (or 0 if first)
 * @param currentBaseTsMs - Current base candle timestamp
 * @param targetTimeframes - Array of target timeframes to check
 * @returns Array of { timeframe, bucketTimestamp } for newly closed buckets
 */
export function detectClosedBuckets(
	previousBaseTsMs: number,
	currentBaseTsMs: number,
	targetTimeframes: string[]
): Array<{ timeframe: string; bucketTimestamp: number }> {
	const closed: Array<{ timeframe: string; bucketTimestamp: number }> = [];

	for (const tf of targetTimeframes) {
		const tfMs = timeframeToMs(tf);

		// Bucket boundaries for previous and current timestamps
		const prevBucket = bucketTimestamp(previousBaseTsMs, tfMs);
		const currBucket = bucketTimestamp(currentBaseTsMs, tfMs);

		// If bucket advanced, the previous bucket is now closed
		if (currBucket > prevBucket) {
			closed.push({ timeframe: tf, bucketTimestamp: prevBucket });
		}
	}

	return closed;
}

/**
 * Aggregate all requested timeframes from base candles in CandleStore
 * and emit only those that are newly closed
 *
 * @param baseCandles - Base timeframe candles from store
 * @param targetTimeframes - Timeframes to aggregate (excluding base)
 * @param lastBaseTsMs - Last processed base candle timestamp
 * @param currentBaseTsMs - Current base candle timestamp
 * @param symbol - Symbol for aggregated candles
 * @returns Array of newly closed aggregated candles with their timeframes
 */
export function aggregateNewlyClosed(
	baseCandles: Candle[],
	targetTimeframes: string[],
	lastBaseTsMs: number,
	currentBaseTsMs: number,
	symbol: string
): Array<{ timeframe: string; candle: Candle }> {
	const closedBuckets = detectClosedBuckets(
		lastBaseTsMs,
		currentBaseTsMs,
		targetTimeframes
	);
	const results: Array<{ timeframe: string; candle: Candle }> = [];

	for (const { timeframe, bucketTimestamp: bucketTs } of closedBuckets) {
		const aggregated = aggregateCandle(
			baseCandles,
			timeframe,
			bucketTs,
			symbol
		);
		if (aggregated) {
			results.push({ timeframe, candle: aggregated });
		}
	}

	return results;
}
