import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import type { Candle } from "../types";

export interface CanonicalizeOptions {
	stripKeys?: Iterable<string>;
}

interface CanonicalizeContext {
	stripKeys: Set<string>;
}

const canonicalizePrimitive = (value: unknown): unknown => {
	if (value === null) {
		return null;
	}
	const type = typeof value;
	if (type === "undefined") {
		return undefined;
	}
	if (type === "number") {
		if (!Number.isFinite(value as number)) {
			return String(value);
		}
		return Object.is(value, -0) ? 0 : (value as number);
	}
	if (type === "string") {
		try {
			return (value as string).normalize();
		} catch {
			return value;
		}
	}
	if (type === "boolean") {
		return value;
	}
	if (type === "bigint") {
		return (value as bigint).toString();
	}
	return undefined;
};

const canonicalizeInternal = (
	value: unknown,
	context: CanonicalizeContext
): unknown => {
	const primitive = canonicalizePrimitive(value);
	if (primitive !== undefined) {
		return primitive;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (Array.isArray(value)) {
		const next: unknown[] = [];
		for (const entry of value) {
			const canonicalEntry = canonicalizeInternal(entry, context);
			if (typeof canonicalEntry !== "undefined") {
				next.push(canonicalEntry);
			}
		}
		return next;
	}
	if (value instanceof Map) {
		const next: Record<string, unknown> = {};
		const entries = Array.from(value.entries()).sort(([a], [b]) =>
			String(a).localeCompare(String(b))
		);
		for (const [key, entryValue] of entries) {
			const canonicalEntry = canonicalizeInternal(entryValue, context);
			if (typeof canonicalEntry !== "undefined") {
				next[String(key)] = canonicalEntry;
			}
		}
		return next;
	}
	if (value instanceof Set) {
		const entries = Array.from(value.values())
			.map((entry) => canonicalizeInternal(entry, context))
			.filter((entry): entry is unknown => typeof entry !== "undefined")
			.map((entry) => ({
				key: JSON.stringify(entry),
				value: entry,
			}))
			.sort((a, b) => a.key.localeCompare(b.key))
			.map((entry) => entry.value);
		return entries;
	}
	if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
		return value.toString("hex");
	}
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj).sort();
		const next: Record<string, unknown> = {};
		for (const key of keys) {
			if (context.stripKeys.has(key)) {
				continue;
			}
			const canonicalEntry = canonicalizeInternal(obj[key], context);
			if (typeof canonicalEntry !== "undefined") {
				next[key] = canonicalEntry;
			}
		}
		return next;
	}
	return String(value);
};

export const canonicalize = (
	value: unknown,
	options: CanonicalizeOptions = {}
): unknown => {
	const stripKeys = new Set<string>();
	if (options.stripKeys) {
		for (const key of options.stripKeys) {
			if (typeof key === "string" && key.length) {
				stripKeys.add(key);
			}
		}
	}
	return canonicalizeInternal(value, { stripKeys });
};

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
		.map(
			([key, val]) => `${JSON.stringify(key)}:${stableStringifyInternal(val)}`
		);
	return `{${entries.join(",")}}`;
};

export const stableStringify = (value: unknown): string => {
	return stableStringifyInternal(value);
};

export const stableCanonicalStringify = (
	value: unknown,
	options?: CanonicalizeOptions
): string => {
	return stableStringifyInternal(canonicalize(value, options));
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
