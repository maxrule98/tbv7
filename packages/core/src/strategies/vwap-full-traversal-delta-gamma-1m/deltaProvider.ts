/**
 * Delta and Gamma calculator from trade stream OR candle data
 *
 * Delta = aggressiveBuyVolume - aggressiveSellVolume per candle
 * Gamma = delta[t] - delta[t-1]
 *
 * Can aggregate trades OR estimate from candle data
 */

export interface Trade {
	timestamp: number;
	price: number;
	size: number;
	side: "buy" | "sell";
}

export interface Candle {
	timestamp: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface DeltaBucket {
	timestamp: number;
	buyVolume: number;
	sellVolume: number;
	delta: number;
	closed: boolean;
}

export class DeltaGammaProvider {
	private buckets = new Map<number, DeltaBucket>();
	private sortedTimestamps: number[] = [];
	private readonly bucketSizeMs = 60_000; // 1 minute

	/**
	 * Process a trade and add it to the appropriate candle bucket
	 */
	processTrade(trade: Trade): void {
		const bucketTimestamp = this.getBucketTimestamp(trade.timestamp);

		let bucket = this.buckets.get(bucketTimestamp);
		if (!bucket) {
			bucket = {
				timestamp: bucketTimestamp,
				buyVolume: 0,
				sellVolume: 0,
				delta: 0,
				closed: false,
			};
			this.buckets.set(bucketTimestamp, bucket);
			this.sortedTimestamps.push(bucketTimestamp);
			this.sortedTimestamps.sort((a, b) => a - b);
		}

		if (trade.side === "buy") {
			bucket.buyVolume += trade.size;
		} else {
			bucket.sellVolume += trade.size;
		}

		bucket.delta = bucket.buyVolume - bucket.sellVolume;
	}

	/**
	 * Process a candle and estimate delta from price action
	 * Used for backtesting when trade data isn't available
	 *
	 * Heuristic: If close > open, assume net buying pressure
	 * Delta = volume * (close - open) / (high - low)
	 * Normalized to [-volume, +volume] range
	 */
	processCandle(candle: Candle): void {
		const bucketTimestamp = this.getBucketTimestamp(candle.timestamp);

		let bucket = this.buckets.get(bucketTimestamp);
		if (!bucket) {
			bucket = {
				timestamp: bucketTimestamp,
				buyVolume: 0,
				sellVolume: 0,
				delta: 0,
				closed: false,
			};
			this.buckets.set(bucketTimestamp, bucket);
			this.sortedTimestamps.push(bucketTimestamp);
			this.sortedTimestamps.sort((a, b) => a - b);
		}

		// Estimate delta from candle structure
		const priceChange = candle.close - candle.open;
		const priceRange = candle.high - candle.low;

		if (priceRange === 0) {
			// Doji candle - neutral
			bucket.delta = 0;
			bucket.buyVolume = candle.volume / 2;
			bucket.sellVolume = candle.volume / 2;
		} else {
			// Normalize price change to [-1, 1] and apply to volume
			const deltaRatio = priceChange / priceRange;
			bucket.delta = candle.volume * deltaRatio;

			// Split volume based on delta
			if (bucket.delta > 0) {
				bucket.buyVolume = candle.volume * (0.5 + deltaRatio / 2);
				bucket.sellVolume = candle.volume * (0.5 - deltaRatio / 2);
			} else {
				bucket.buyVolume = candle.volume * (0.5 + deltaRatio / 2);
				bucket.sellVolume = candle.volume * (0.5 - deltaRatio / 2);
			}
		}
	}

	/**
	 * Close a candle bucket (called when candle closes)
	 */
	closeBucket(timestamp: number): void {
		const bucketTimestamp = this.getBucketTimestamp(timestamp);
		const bucket = this.buckets.get(bucketTimestamp);
		if (bucket) {
			bucket.closed = true;
		}
	}

	/**
	 * Get delta for a specific timestamp (closed candles only)
	 */
	getDelta(timestamp: number): number | null {
		const bucketTimestamp = this.getBucketTimestamp(timestamp);
		const bucket = this.buckets.get(bucketTimestamp);

		if (!bucket || !bucket.closed) {
			return null;
		}

		return bucket.delta;
	}

	/**
	 * Get gamma (delta change) for a specific timestamp
	 * gamma[t] = delta[t] - delta[t-1]
	 */
	getGamma(timestamp: number): number | null {
		const bucketTimestamp = this.getBucketTimestamp(timestamp);
		const prevBucketTimestamp = bucketTimestamp - this.bucketSizeMs;

		const currentDelta = this.getDelta(bucketTimestamp);
		const prevDelta = this.getDelta(prevBucketTimestamp);

		if (currentDelta === null || prevDelta === null) {
			return null;
		}

		return currentDelta - prevDelta;
	}

	/**
	 * Get all deltas in chronological order (for diagnostics)
	 */
	getAllDeltas(): Array<{
		timestamp: number;
		delta: number;
		gamma: number | null;
	}> {
		return this.sortedTimestamps
			.filter((ts) => {
				const bucket = this.buckets.get(ts);
				return bucket && bucket.closed;
			})
			.map((ts) => ({
				timestamp: ts,
				delta: this.getDelta(ts)!,
				gamma: this.getGamma(ts),
			}));
	}

	/**
	 * Clear old buckets to prevent memory growth
	 * Keep last 1000 buckets (~16 hours of 1m candles)
	 */
	cleanup(): void {
		const maxBuckets = 1000;
		if (this.sortedTimestamps.length > maxBuckets) {
			const toRemove = this.sortedTimestamps.length - maxBuckets;
			for (let i = 0; i < toRemove; i++) {
				const ts = this.sortedTimestamps[i];
				this.buckets.delete(ts);
			}
			this.sortedTimestamps = this.sortedTimestamps.slice(toRemove);
		}
	}

	/**
	 * Get the bucket timestamp (candle open time) for a given timestamp
	 */
	private getBucketTimestamp(timestamp: number): number {
		return Math.floor(timestamp / this.bucketSizeMs) * this.bucketSizeMs;
	}

	/**
	 * Reset all data (for testing)
	 */
	reset(): void {
		this.buckets.clear();
		this.sortedTimestamps = [];
	}
}
