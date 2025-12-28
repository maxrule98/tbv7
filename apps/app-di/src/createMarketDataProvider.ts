import { ExchangeAdapter } from "@agenai/core";
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
	exchangeAdapter: ExchangeAdapter,
	pollIntervalMs: number
): MarketDataProvider => {
	const venue = runtimeSnapshot.config.venues.signalVenue;
	if (isBinanceVenue(venue)) {
		return new BinanceUsdMMarketDataProvider(exchangeAdapter);
	}
	return new PollingMarketDataProvider(exchangeAdapter, {
		pollIntervalMs,
		venue,
	});
};

export const createMarketDataClient = (
	exchangeAdapter: ExchangeAdapter
): ExchangeAdapter => exchangeAdapter;

export const createDataProvider = (
	runtimeSnapshot: RuntimeSnapshot,
	exchangeAdapter: ExchangeAdapter
): DefaultDataProvider => {
	return new DefaultDataProvider({ client: exchangeAdapter });
};
