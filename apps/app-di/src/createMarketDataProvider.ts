import { MarketDataClient } from "@agenai/core";
import {
	BinanceUsdMMarketDataProvider,
	PollingMarketDataProvider,
	MarketDataProvider,
	RuntimeSnapshot,
} from "@agenai/runtime";
import { DefaultDataProvider } from "@agenai/data";

const isBinanceVenue = (venue: string): boolean =>
	venue.toLowerCase().includes("binance");

export const createMarketDataProvider = (
	runtimeSnapshot: RuntimeSnapshot,
	marketDataClient: MarketDataClient,
	pollIntervalMs: number
): MarketDataProvider => {
	const venue = runtimeSnapshot.config.venues.signalVenue;
	if (isBinanceVenue(venue)) {
		return new BinanceUsdMMarketDataProvider(marketDataClient);
	}
	return new PollingMarketDataProvider(marketDataClient, {
		pollIntervalMs,
		venue,
	});
};

export const createDataProvider = (
	marketDataClient: MarketDataClient
): DefaultDataProvider => {
	return new DefaultDataProvider({ client: marketDataClient });
};
