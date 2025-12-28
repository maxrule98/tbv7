import { ExchangeAdapter } from "@agenai/core";
import { RuntimeSnapshot } from "@agenai/runtime";
import { MexcClient } from "@agenai/exchange-mexc";
import { BinanceUsdMClient } from "@agenai/exchange-binance";

const isBinance = (id?: string): boolean => {
	if (!id) return false;
	const value = id.toLowerCase();
	return value.includes("binance");
};

export const createExchangeAdapter = (
	runtimeSnapshot: RuntimeSnapshot
): ExchangeAdapter => {
	const exchange = runtimeSnapshot.config.agenaiConfig.exchange;
	const creds = exchange.credentials ?? { apiKey: "", apiSecret: "" };
	if (isBinance(exchange.id ?? exchange.exchange)) {
		return new BinanceUsdMClient({
			apiKey: creds.apiKey,
			secret: creds.apiSecret,
		});
	}
	return new MexcClient({
		apiKey: creds.apiKey,
		secret: creds.apiSecret,
		useFutures: exchange.market !== "spot",
	});
};
