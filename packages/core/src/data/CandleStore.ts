import type { Candle } from "../types";
import { timeframeToMs, bucketTimestamp } from "../time";

export interface CandleStoreOptions {
	/** Maximum candles per timeframe (can be overridden per TF) */
	maxCandlesByTimeframe?: Record<string, number>;
	/** Default maximum candles if not specified per timeframe */
	defaultMaxCandles: number;
}

/**
 * Centralized candle storage for both live and backtest modes
 *
 * Responsibilities:
 * - Store candles by timeframe in ascending timestamp order
 * - Enforce deterministic time alignment (bucket normalization)
 * - Deduplicate candles by timestamp (last-write wins)
 * - Window trimming per configured limits
 * - Provide MultiTimeframeCache-compatible interface for strategies in backtest mode
 *
 * NOT responsible for:
 * - Gap detection (handled by providers via repairCandleGap)
 * - Aggregation/resampling (future phase)
 * - Multi-exchange reconciliation (future phase)
 *
 * Usage:
 * - Runners (startTrader/backtestRunner) use: ingest(), ingestMany(), getSeries()
 * - Strategies in backtest mode use: getCandles(), refreshAll() (MultiTimeframeCache interface)
 */
export class CandleStore {
	private readonly series = new Map<string, Candle[]>();
	private readonly maxCandles: Map<string, number>;
	private readonly defaultMax: number;

	constructor(options: CandleStoreOptions) {
		this.defaultMax = Math.max(options.defaultMaxCandles, 1);
		this.maxCandles = new Map();
		if (options.maxCandlesByTimeframe) {
			for (const [tf, max] of Object.entries(options.maxCandlesByTimeframe)) {
				this.maxCandles.set(tf, Math.max(max, 1));
			}
		}
	}

	/**
	 * Ingest a single candle into the store
	 *
	 * - Normalizes timestamp to bucket boundary
	 * - Deduplicates by timestamp (replaces existing if same timestamp)
	 * - Maintains sorted ascending order
	 * - Trims to window limit
	 */
	ingest(timeframe: string, candle: Candle): void {
		const tfMs = timeframeToMs(timeframe);
		const normalized: Candle = {
			...candle,
			timestamp: bucketTimestamp(candle.timestamp, tfMs),
		};

		let candles = this.series.get(timeframe);
		if (!candles) {
			candles = [];
			this.series.set(timeframe, candles);
		}

		// Find insertion point or duplicate
		const ts = normalized.timestamp;
		let insertIdx = 0;
		let isDuplicate = false;

		for (let i = candles.length - 1; i >= 0; i--) {
			const existing = candles[i];
			if (!existing) continue;

			if (existing.timestamp === ts) {
				// Duplicate - replace in place (last write wins)
				candles[i] = normalized;
				isDuplicate = true;
				break;
			} else if (existing.timestamp < ts) {
				// Insert after this position
				insertIdx = i + 1;
				break;
			}
		}

		if (!isDuplicate) {
			candles.splice(insertIdx, 0, normalized);
			this.trimToLimit(timeframe, candles);
		}
	}

	/**
	 * Ingest multiple candles efficiently
	 *
	 * - Normalizes all timestamps
	 * - Sorts input before merging
	 * - Deduplicates during merge
	 * - Single trim at end
	 */
	ingestMany(timeframe: string, candles: Candle[]): void {
		if (!candles.length) return;

		const tfMs = timeframeToMs(timeframe);

		// Normalize and sort input
		const normalized = candles
			.map((c) => ({
				...c,
				timestamp: bucketTimestamp(c.timestamp, tfMs),
			}))
			.sort((a, b) => a.timestamp - b.timestamp);

		let existing = this.series.get(timeframe);
		if (!existing || existing.length === 0) {
			// Fast path: no existing candles
			existing = this.deduplicate(normalized);
			this.series.set(timeframe, existing);
			this.trimToLimit(timeframe, existing);
			return;
		}

		// Merge with existing
		const merged: Candle[] = [];
		let i = 0;
		let j = 0;

		while (i < existing.length && j < normalized.length) {
			const e = existing[i];
			const n = normalized[j];
			if (!e || !n) break;

			if (e.timestamp < n.timestamp) {
				merged.push(e);
				i++;
			} else if (e.timestamp > n.timestamp) {
				merged.push(n);
				j++;
			} else {
				// Duplicate: take new (last write wins)
				merged.push(n);
				i++;
				j++;
			}
		}

		// Append remaining
		while (i < existing.length) {
			const e = existing[i];
			if (e) merged.push(e);
			i++;
		}
		while (j < normalized.length) {
			const n = normalized[j];
			if (n) merged.push(n);
			j++;
		}

		this.series.set(timeframe, merged);
		this.trimToLimit(timeframe, merged);
	}

	/**
	 * Get candle series for a timeframe
	 * Returns a defensive copy
	 */
	getSeries(timeframe: string): Candle[] {
		return [...(this.series.get(timeframe) ?? [])];
	}

	/**
	 * Get the latest candle for a timeframe
	 */
	getLatestCandle(timeframe: string): Candle | undefined {
		const candles = this.series.get(timeframe);
		if (!candles || candles.length === 0) return undefined;
		return candles[candles.length - 1];
	}

	/**
	 * Get candles as Promise (MultiTimeframeCache interface compatibility)
	 * Strategies expect this async interface in both live and backtest modes
	 */
	async getCandles(timeframe: string): Promise<Candle[]> {
		return this.getSeries(timeframe);
	}

	/**
	 * No-op refresh (MultiTimeframeCache interface compatibility)
	 * Backtest mode uses ingest/ingestMany instead of fetching
	 */
	async refreshAll(): Promise<void> {
		// No-op: backtest mode populates candles via ingest/ingestMany
		return Promise.resolve();
	}

	/**
	 * Check if a timeframe has any candles
	 */
	hasCandles(timeframe: string): boolean {
		const candles = this.series.get(timeframe);
		return !!candles && candles.length > 0;
	}

	/**
	 * Get all tracked timeframes
	 */
	getTimeframes(): string[] {
		return Array.from(this.series.keys());
	}

	/**
	 * Clear all candles (useful for testing)
	 */
	clear(): void {
		this.series.clear();
	}

	/**
	 * Clear candles for a specific timeframe
	 */
	clearTimeframe(timeframe: string): void {
		this.series.delete(timeframe);
	}

	private trimToLimit(timeframe: string, candles: Candle[]): void {
		const limit = this.maxCandles.get(timeframe) ?? this.defaultMax;
		if (candles.length > limit) {
			const excess = candles.length - limit;
			candles.splice(0, excess);
		}
	}

	private deduplicate(candles: Candle[]): Candle[] {
		if (candles.length === 0) return [];

		const result: Candle[] = [];
		let lastTs: number | undefined;

		for (const candle of candles) {
			if (candle.timestamp !== lastTs) {
				result.push(candle);
				lastTs = candle.timestamp;
			} else {
				// Duplicate: replace last (last write wins)
				result[result.length - 1] = candle;
			}
		}

		return result;
	}
}
