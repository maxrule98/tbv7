import {
	timeframeToMs,
	bucketTimestamp,
	assertBucketAligned,
} from "@agenai/core";
import type { Candle } from "@agenai/core";
import type {
	TickSnapshot,
	TickSeries,
	ClosedCandleSource,
} from "../types/tickSnapshot";

export interface BuildTickSnapshotInput {
	/** Trading symbol */
	symbol: string;

	/** Signal/market data venue */
	signalVenue: string;

	/** Execution timeframe */
	executionTimeframe: string;

	/** Execution candle triggering this tick */
	executionCandle: Candle;

	/** Multi-timeframe candle series */
	series: Record<string, Candle[]>;

	/** Arrival delay in milliseconds (optional) */
	arrivalDelayMs?: number;

	/** Data source by timeframe (optional) */
	sourceByTf?: Record<string, ClosedCandleSource>;

	/** Gap filled status by timeframe (optional) */
	gapFilledByTf?: Record<string, boolean>;
}

/**
 * Build a rich TickSnapshot from candle data
 * Validates timestamp alignment and computes metadata
 *
 * @param input - Snapshot input data
 * @returns Validated TickSnapshot with computed metadata
 * @throws Error if executionCandle timestamp is not aligned to timeframe boundary
 */
export function buildTickSnapshot(input: BuildTickSnapshotInput): TickSnapshot {
	const {
		symbol,
		signalVenue,
		executionTimeframe,
		executionCandle,
		series,
		arrivalDelayMs,
		sourceByTf,
		gapFilledByTf,
	} = input;

	// Compute tfMs for all timeframes
	const tfMs: Record<string, number> = {};
	const allTimeframes = new Set<string>([
		executionTimeframe,
		...Object.keys(series),
	]);

	for (const tf of allTimeframes) {
		tfMs[tf] = timeframeToMs(tf);
	}

	// Validate execution candle timestamp alignment
	const executionTfMs = tfMs[executionTimeframe];
	assertBucketAligned(
		executionCandle.timestamp,
		executionTfMs,
		"executionCandle"
	);

	// Compute bucketed timestamp (should equal executionCandle.timestamp after validation)
	const asOfTs = bucketTimestamp(executionCandle.timestamp, executionTfMs);

	return {
		symbol,
		signalVenue,
		executionTimeframe,
		executionCandle,
		series,
		meta: {
			asOfTs,
			tfMs,
			sourceByTf,
			gapFilledByTf,
			arrivalDelayMs,
		},
	};
}
