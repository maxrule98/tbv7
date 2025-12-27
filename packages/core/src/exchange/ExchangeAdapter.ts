import type { Candle } from "../types";

/**
 * Common position snapshot returned by exchange adapters.
 */
export interface ExchangePositionSnapshot {
	side: "LONG" | "SHORT" | "FLAT";
	size: number;
	entryPrice: number | null;
	unrealizedPnl: number | null;
}

/**
 * Minimal order information returned by exchange adapters.
 * This mirrors the CCXT Order type subset we actually use.
 */
export interface ExchangeOrder {
	id: string;
	symbol: string;
	type: string;
	side: "buy" | "sell";
	amount: number;
	price?: number;
	[key: string]: any; // Allow additional CCXT fields
}

/**
 * Standard interface for exchange adapters.
 * All exchange clients (Binance, MEXC, etc.) should implement this interface
 * to ensure consistent behavior across different exchanges.
 */
export interface ExchangeAdapter {
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

	/**
	 * Create a market order (immediate execution at current market price).
	 * @param symbol - Trading pair symbol
	 * @param side - Order side ("buy" or "sell")
	 * @param amount - Order size/quantity
	 * @returns Order information
	 */
	createMarketOrder(
		symbol: string,
		side: "buy" | "sell",
		amount: number
	): Promise<ExchangeOrder>;

	/**
	 * Get current USDT balance.
	 * @returns Available USDT balance
	 */
	getBalanceUSDT(): Promise<number>;

	/**
	 * Get current position for a symbol.
	 * @param symbol - Trading pair symbol
	 * @returns Position snapshot (FLAT if no position)
	 */
	getPosition(symbol: string): Promise<ExchangePositionSnapshot>;
}
