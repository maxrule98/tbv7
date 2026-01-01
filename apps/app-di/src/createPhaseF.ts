import { MarketDataClient } from "@agenai/core";
import {
	BinanceBaseCandleSource,
	PollingBaseCandleSource,
	type BaseCandleSource,
	type RuntimeSnapshot,
} from "@agenai/runtime";

const isBinanceVenue = (venue: string): boolean =>
	venue.toLowerCase().includes("binance");

/**
 * Phase F: Create BaseCandleSource for Plant-driven runtime
 */
export const createBaseCandleSource = (
	runtimeSnapshot: RuntimeSnapshot,
	marketDataClient: MarketDataClient,
	pollIntervalMs: number
): BaseCandleSource => {
	const venue = runtimeSnapshot.config.venues.signalVenue;

	if (isBinanceVenue(venue)) {
		return new BinanceBaseCandleSource();
	}

	return new PollingBaseCandleSource(marketDataClient, {
		pollIntervalMs,
		venue,
	});
};

/**
 * Phase F: Simply return the MarketDataClient (typically an ExchangeAdapter)
 */
export const createMarketDataClient = (
	marketDataClient: MarketDataClient
): MarketDataClient => {
	return marketDataClient;
};
