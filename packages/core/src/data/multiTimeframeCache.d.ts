import { Candle } from "../types";
export interface MultiTimeframeCacheOptions {
    symbol: string;
    timeframes: string[];
    maxAgeMs: number;
    fetcher: (symbol: string, timeframe: string, limit: number) => Promise<Candle[]>;
    limit?: number;
}
export interface MultiTimeframeCache {
    getCandles: (timeframe: string) => Promise<Candle[]>;
    getLatestCandle: (timeframe: string) => Promise<Candle | undefined>;
    refreshAll: () => Promise<void>;
}
export declare const createMTFCache: (opts: MultiTimeframeCacheOptions) => MultiTimeframeCache;
