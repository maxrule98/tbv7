import { Candle } from "../types";

export interface MultiTimeframeCacheOptions {
	symbol: string;
	timeframes: string[];
	maxAgeMs: number;
	fetcher: (
		symbol: string,
		timeframe: string,
		limit: number
	) => Promise<Candle[]>;
	limit?: number;
}

interface CachedFrame {
	candles: Candle[];
	fetchedAt: number;
}

export interface MultiTimeframeCache {
	getCandles: (timeframe: string) => Promise<Candle[]>;
	getLatestCandle: (timeframe: string) => Promise<Candle | undefined>;
	refreshAll: () => Promise<void>;
}

export const createMTFCache = (
	opts: MultiTimeframeCacheOptions
): MultiTimeframeCache => {
	const cache = new Map<string, CachedFrame>();
	const limit = Math.max(opts.limit ?? 300, 1);
	const timeframes = Array.from(new Set(opts.timeframes));

	const fetchWithCache = async (timeframe: string): Promise<Candle[]> => {
		if (!timeframes.includes(timeframe)) {
			throw new Error(`Timeframe ${timeframe} is not tracked in this cache`);
		}
		const existing = cache.get(timeframe);
		const now = Date.now();
		if (existing && now - existing.fetchedAt < opts.maxAgeMs) {
			return existing.candles;
		}

		const candles = await opts.fetcher(opts.symbol, timeframe, limit);
		cache.set(timeframe, { candles, fetchedAt: now });
		return candles;
	};

	return {
		getCandles: (timeframe: string) => fetchWithCache(timeframe),
		getLatestCandle: async (timeframe: string) => {
			const candles = await fetchWithCache(timeframe);
			return candles[candles.length - 1];
		},
		refreshAll: async () => {
			await Promise.all(timeframes.map((tf) => fetchWithCache(tf)));
		},
	};
};
