import type { Candle } from "../types";

/**
 * Market data client interface for fetching historical and real-time candle data.
 *
 * This interface is separate from ExecutionClient to enable:
 * - Different venues for signal vs execution (e.g., Binance signal, MEXC execution)
 * - Market data only access without trading permissions
 * - Read-only data providers
 */
export interface MarketDataClient {
	/**
	 * Fetch OHLCV candle data for a symbol and timeframe.
	 * @param symbol - Trading pair symbol (e.g., "BTC/USDT")
	 * @param timeframe - Timeframe string (e.g., "1m", "5m", "1h")
	 * @param limit - Maximum number of candles to fetch (default: 500)
	 * @param since - Optional timestamp to fetch candles from
	 * @returns Array of candles in chronological order
	 */
	fetchOHLCV(
		symbol: string,
		timeframe: string,
		limit?: number,
		since?: number
	): Promise<Candle[]>;
}
