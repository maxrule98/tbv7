/**
 * Pure time utilities for deterministic timestamp handling
 * All functions operate on UTC epoch milliseconds only (no timezone conversion)
 */

export interface ParsedTimeframe {
	unit: "m" | "h" | "d";
	n: number;
	ms: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Parse timeframe string to milliseconds
 * @param timeframe - Format: "1m", "5m", "15m", "1h", "4h", "1d"
 * @returns Milliseconds for the timeframe
 * @throws Error if timeframe format is invalid
 */
export const timeframeToMs = (timeframe: string): number => {
	if (!timeframe || typeof timeframe !== "string") {
		throw new Error(
			`Invalid timeframe: expected string, got ${typeof timeframe}`
		);
	}

	const trimmed = timeframe.trim().toLowerCase();
	const match = trimmed.match(/^(\d+)([mhd])$/);

	if (!match) {
		throw new Error(
			`Invalid timeframe format: "${timeframe}". Expected format like "1m", "5m", "1h", "1d"`
		);
	}

	const n = parseInt(match[1], 10);
	const unit = match[2];

	if (n <= 0) {
		throw new Error(
			`Invalid timeframe: period must be positive, got ${n} in "${timeframe}"`
		);
	}

	switch (unit) {
		case "m":
			return n * MINUTE_MS;
		case "h":
			return n * HOUR_MS;
		case "d":
			return n * DAY_MS;
		default:
			throw new Error(`Invalid timeframe unit: "${unit}" in "${timeframe}"`);
	}
};

/**
 * Parse timeframe string into structured format
 * @param timeframe - Format: "1m", "5m", "15m", "1h", "4h", "1d"
 * @returns Parsed timeframe with unit, count, and milliseconds
 * @throws Error if timeframe format is invalid
 */
export const parseTimeframe = (timeframe: string): ParsedTimeframe => {
	const trimmed = timeframe.trim().toLowerCase();
	const match = trimmed.match(/^(\d+)([mhd])$/);

	if (!match) {
		throw new Error(
			`Invalid timeframe format: "${timeframe}". Expected format like "1m", "5m", "1h", "1d"`
		);
	}

	const n = parseInt(match[1], 10);
	const unit = match[2] as "m" | "h" | "d";

	if (n <= 0) {
		throw new Error(
			`Invalid timeframe: period must be positive, got ${n} in "${timeframe}"`
		);
	}

	const ms = timeframeToMs(timeframe);

	return { unit, n, ms };
};

/**
 * Bucket a timestamp to the start of its timeframe period
 * @param ts - Timestamp in epoch milliseconds
 * @param tfMs - Timeframe period in milliseconds
 * @returns Bucketed timestamp (start of period)
 * @example bucketTimestamp(1735690261234, 60000) => 1735690260000
 */
export const bucketTimestamp = (ts: number, tfMs: number): number => {
	if (!Number.isFinite(ts) || ts < 0) {
		throw new Error(`Invalid timestamp: ${ts}`);
	}
	if (!Number.isFinite(tfMs) || tfMs <= 0) {
		throw new Error(`Invalid timeframe ms: ${tfMs}`);
	}
	return Math.floor(ts / tfMs) * tfMs;
};

/**
 * Check if timestamp is aligned to timeframe bucket boundary
 * @param ts - Timestamp in epoch milliseconds
 * @param tfMs - Timeframe period in milliseconds
 * @returns True if timestamp is at bucket boundary
 */
export const isBucketAligned = (ts: number, tfMs: number): boolean => {
	return ts === bucketTimestamp(ts, tfMs);
};

/**
 * Assert that timestamp is aligned to timeframe bucket boundary
 * @param ts - Timestamp in epoch milliseconds
 * @param tfMs - Timeframe period in milliseconds
 * @param context - Optional context for error message
 * @throws Error with detailed message if not aligned
 */
export const assertBucketAligned = (
	ts: number,
	tfMs: number,
	context?: string
): void => {
	const bucketed = bucketTimestamp(ts, tfMs);
	if (ts !== bucketed) {
		const contextStr = context ? ` (context: ${context})` : "";
		const offset = ts - bucketed;
		throw new Error(
			`Timestamp not aligned to timeframe bucket${contextStr}: ` +
				`ts=${ts}, tfMs=${tfMs}, bucketed=${bucketed}, offset=${offset}ms`
		);
	}
};
