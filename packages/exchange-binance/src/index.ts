import ccxt from "ccxt";
import type { Exchange, OHLCV, Order } from "ccxt";

export interface BinanceClientOptions {
	apiKey: string;
	apiSecret: string;
	useTestnet: boolean;
}

export interface FetchOHLCVParams {
	symbol: string;
	timeframe: string;
	since?: number;
	limit?: number;
}

export interface ExchangeCandle {
	timestamp: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export class BinanceClient {
	private readonly exchange: Exchange;

	constructor(options: BinanceClientOptions) {
		this.exchange = new ccxt.binanceusdm({
			apiKey: options.apiKey,
			secret: options.apiSecret,
			enableRateLimit: true,
			options: {
				defaultType: "future",
				defaultMarket: "future",
			},
		});

		if (options.useTestnet) {
			configureFuturesTestnet(this.exchange);
		}
	}

	async fetchOHLCV(params: FetchOHLCVParams): Promise<ExchangeCandle[]> {
		const candles = await this.exchange.fetchOHLCV(
			params.symbol,
			params.timeframe,
			params.since,
			params.limit
		);

		return candles.map(BinanceClient.mapCandle);
	}

	async createMarketOrder(
		symbol: string,
		side: "buy" | "sell",
		quantity: number
	): Promise<Order> {
		return this.exchange.createOrder(symbol, "market", side, quantity);
	}

	private static mapCandle(candle: OHLCV): ExchangeCandle {
		const [timestamp, open, high, low, close, volume] = candle;

		if (
			timestamp === undefined ||
			open === undefined ||
			high === undefined ||
			low === undefined ||
			close === undefined ||
			volume === undefined
		) {
			throw new Error("Received incomplete OHLCV data from Binance.");
		}

		return {
			timestamp: Number(timestamp),
			open: Number(open),
			high: Number(high),
			low: Number(low),
			close: Number(close),
			volume: Number(volume),
		};
	}
}

const configureFuturesTestnet = (exchange: Exchange): void => {
	const urls = (exchange.urls ?? {}) as Record<string, unknown> & {
		test?: Record<string, string>;
		api?: Record<string, string>;
	};
	const testUrls = urls.test as Record<string, string> | undefined;

	if (!testUrls) {
		console.warn(
			"BinanceClient: futures testnet endpoints are unavailable; falling back to production URLs."
		);
		return;
	}

	const copyKeys = [
		"fapiPublic",
		"fapiPublicV2",
		"fapiPublicV3",
		"fapiPrivate",
		"fapiPrivateV2",
		"fapiPrivateV3",
		"public",
		"private",
		"v1",
	];

	const overrides = copyKeys.reduce<Record<string, string>>((acc, key) => {
		const value = testUrls[key];
		if (value) {
			acc[key] = value;
		}
		return acc;
	}, {});

	urls.api = {
		...(urls.api ?? {}),
		...overrides,
	};

	copyKeys.forEach((key) => {
		if (overrides[key]) {
			urls[key] = overrides[key];
		}
	});

	exchange.urls = urls as typeof exchange.urls;
	exchange.options = {
		...(exchange.options ?? {}),
		sandboxMode: true,
	};
};
