import crypto from "node:crypto";
import type { Candle } from "../types";

const stableStringifyInternal = (value: unknown): string => {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringifyInternal).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, val]) => typeof val !== "undefined")
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([key, val]) => `${JSON.stringify(key)}:${stableStringifyInternal(val)}`);
	return `{${entries.join(",")}}`;
};

export const stableStringify = (value: unknown): string => {
	return stableStringifyInternal(value);
};

export const hashJson = (value: unknown, length = 12): string => {
	const digest = crypto
		.createHash("sha1")
		.update(stableStringify(value))
		.digest("hex");
	return length > 0 ? digest.slice(0, length) : digest;
};

export interface CandleFingerprintSummary {
	count: number;
	firstTimestamp: number | null;
	lastTimestamp: number | null;
	headHash: string | null;
	tailHash: string | null;
}

export const summarizeCandles = (
	candles: Candle[],
	limit = 20
): CandleFingerprintSummary => {
	const normalizedLimit = Math.max(1, limit);
	const headSlice = candles.slice(0, Math.min(normalizedLimit, candles.length));
	const tailSlice = candles.slice(
		Math.max(0, candles.length - normalizedLimit)
	);
	const computeHash = (slice: Candle[]): string | null => {
		return slice.length ? hashJson(slice) : null;
	};
	return {
		count: candles.length,
		firstTimestamp: candles[0]?.timestamp ?? null,
		lastTimestamp: candles[candles.length - 1]?.timestamp ?? null,
		headHash: computeHash(headSlice),
		tailHash: computeHash(tailSlice),
	};
};
