/**
 * Common position snapshot returned by exchange execution clients.
 */
export interface ExchangePositionSnapshot {
	side: "LONG" | "SHORT" | "FLAT";
	size: number;
	entryPrice: number | null;
	unrealizedPnl: number | null;
}

/**
 * Minimal order information returned by exchange execution clients.
 * This mirrors the CCXT Order type subset we actually use.
 */
export interface ExchangeOrder {
	id: string;
	symbol: string;
	type: string;
	side: "buy" | "sell";
	amount: number;
	price?: number;
	average?: number;
	raw?: Record<string, unknown>; // Optional raw CCXT fields
}

/**
 * Execution client interface for placing orders and managing positions.
 *
 * This interface is separate from MarketDataClient to enable:
 * - Different venues for signal vs execution (e.g., Binance signal, MEXC execution)
 * - Execution-only access with trading permissions
 * - Clear separation between read (market data) and write (execution) operations
 */
export interface ExecutionClient {
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
