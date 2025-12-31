import type { MarketDataClient } from "./MarketDataClient";
import type { ExecutionClient } from "./ExecutionClient";

// Re-export for backward compatibility
export type {
	ExchangePositionSnapshot,
	ExchangeOrder,
} from "./ExecutionClient";

/**
 * Unified exchange adapter that combines market data and execution capabilities.
 *
 * This is a compatibility type that combines both MarketDataClient and ExecutionClient.
 * Most code should prefer using the specific interfaces (MarketDataClient or ExecutionClient)
 * to enable venue split (e.g., Binance for signals, MEXC for execution).
 *
 * @deprecated Prefer using MarketDataClient and ExecutionClient separately
 */
export type ExchangeAdapter = MarketDataClient & ExecutionClient;
