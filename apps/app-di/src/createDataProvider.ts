import { MarketDataClient } from "@agenai/core";
import { DefaultDataProvider } from "@agenai/data";

/**
 * Phase F: Create data provider for historical candle fetching
 * Used by backtest to load historical data
 */
export const createDataProvider = (
	marketDataClient: MarketDataClient
): DefaultDataProvider => {
	return new DefaultDataProvider({ client: marketDataClient });
};
