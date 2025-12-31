import { timeframeToMs, bucketTimestamp } from "@agenai/core";
import type { Candle } from "@agenai/core";

export interface GapRepairInput {
	/** Timeframe string (e.g., "1m", "5m") */
	timeframe: string;

	/** Last processed timestamp (exclusive) */
	lastTs: number;

	/** Next candle timestamp (exclusive) */
	nextTs: number;

	/**
	 * Callback to fetch candles starting from a given timestamp
	 * @param since - Start timestamp for fetch
	 * @returns Array of candles (may be unordered, may contain duplicates)
	 */
	fetchCandles: (since: number) => Promise<Candle[]>;

	/**
	 * Optional logger callback for structured events
	 * @param event - Event name
	 * @param data - Event data
	 */
	log?: (event: string, data: Record<string, unknown>) => void;
}

export interface GapRepairResult {
	/** Missing candles (sorted, deduped, within range) */
	missing: Candle[];

	/** Number of missing buckets detected */
	gapSize: number;

	/** Start of gap (inclusive) */
	fromTs: number;

	/** End of gap (exclusive) */
	toTs: number;
}

/**
 * Repair gaps in candle data by fetching missing candles
 *
 * Detects missing candles between lastTs and nextTs, fetches them,
 * normalizes timestamps to bucket boundaries, and returns sorted/deduped results.
 *
 * @param input - Gap repair configuration
 * @returns Repair result with missing candles and gap statistics
 */
export async function repairCandleGap(
	input: GapRepairInput
): Promise<GapRepairResult> {
	const { timeframe, lastTs, nextTs, fetchCandles, log } = input;

	// Compute timeframe period in milliseconds
	const tfMs = timeframeToMs(timeframe);

	// Calculate gap size (number of missing buckets)
	const gapSize = Math.max(Math.floor((nextTs - lastTs) / tfMs) - 1, 0);

	// Start of gap (first missing timestamp)
	const fromTs = lastTs + tfMs;

	// End of gap (exclusive)
	const toTs = nextTs;

	// If no gap, return early
	if (gapSize === 0) {
		return {
			missing: [],
			gapSize: 0,
			fromTs,
			toTs,
		};
	}

	// Fetch missing candles (fetch slightly more to handle edge cases)
	const needed = Math.max(gapSize, 1);
	const fetchedCandles = await fetchCandles(fromTs);

	// Filter candles to only include those strictly within the gap range
	// Normalize timestamps to bucket boundaries and exclude out-of-range candles
	const validCandles = fetchedCandles
		.map((candle) => ({
			...candle,
			timestamp: bucketTimestamp(candle.timestamp, tfMs),
		}))
		.filter((candle) => candle.timestamp >= fromTs && candle.timestamp < toTs);

	// Sort by timestamp ascending
	validCandles.sort((a, b) => a.timestamp - b.timestamp);

	// Deduplicate by timestamp (keep first occurrence)
	const deduped: Candle[] = [];
	const seen = new Set<number>();

	for (const candle of validCandles) {
		if (!seen.has(candle.timestamp)) {
			seen.add(candle.timestamp);
			deduped.push(candle);
		}
	}

	// Optional logging
	if (log && deduped.length > 0) {
		log("gap_repair_fetched", {
			timeframe,
			gapSize,
			fromTs,
			toTs,
			fetched: fetchedCandles.length,
			valid: deduped.length,
		});
	}

	return {
		missing: deduped,
		gapSize,
		fromTs,
		toTs,
	};
}
