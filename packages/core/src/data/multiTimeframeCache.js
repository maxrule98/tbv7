"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMTFCache = void 0;
const createMTFCache = (opts) => {
    const cache = new Map();
    const limit = Math.max(opts.limit ?? 300, 1);
    const timeframes = Array.from(new Set(opts.timeframes));
    const fetchWithCache = async (timeframe) => {
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
        getCandles: (timeframe) => fetchWithCache(timeframe),
        getLatestCandle: async (timeframe) => {
            const candles = await fetchWithCache(timeframe);
            return candles[candles.length - 1];
        },
        refreshAll: async () => {
            await Promise.all(timeframes.map((tf) => fetchWithCache(tf)));
        },
    };
};
exports.createMTFCache = createMTFCache;
