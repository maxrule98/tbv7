import ccxt, { Exchange, OHLCV } from "ccxt";
import { Candle } from "@agenai/core";

const mapCcxtCandle = (
	row: OHLCV,
	symbol: string,
	timeframe: string
): Candle => {
	const [timestamp, open, high, low, close, volume] = row;
	return {
		symbol,
		timeframe,
		timestamp: Number(timestamp ?? 0),
		open: Number(open ?? 0),
		high: Number(high ?? 0),
		low: Number(low ?? 0),
		close: Number(close ?? 0),
		volume: Number(volume ?? 0),
	};
};

export interface BinanceSpotClientOptions {
	apiKey?: string;
	secret?: string;
}

export class BinanceSpotClient {
	private readonly exchange: Exchange;

	constructor(options: BinanceSpotClientOptions = {}) {
		this.exchange = new ccxt.binance({
			apiKey: options.apiKey,
			secret: options.secret,
			enableRateLimit: true,
			options: {
				defaultType: "spot",
			},
		});
	}

	async fetchOHLCV(
		symbol: string,
		timeframe: string,
		limit = 500,
		since?: number
	): Promise<Candle[]> {
		const rows = await this.exchange.fetchOHLCV(
			symbol,
			timeframe,
			since,
			limit
		);
		return rows.map((row: any) => mapCcxtCandle(row, symbol, timeframe));
	}
}

export interface BinanceUsdMClientOptions extends BinanceSpotClientOptions {}

export class BinanceUsdMClient {
	private readonly exchange: Exchange;

	constructor(options: BinanceUsdMClientOptions = {}) {
		this.exchange = new ccxt.binanceusdm({
			apiKey: options.apiKey,
			secret: options.secret,
			enableRateLimit: true,
			options: {
				defaultType: "future",
			},
		});
	}

	async fetchOHLCV(
		symbol: string,
		timeframe: string,
		limit = 500,
		since?: number
	): Promise<Candle[]> {
		const rows = await this.exchange.fetchOHLCV(
			symbol,
			timeframe,
			since,
			limit
		);
		return rows.map((row: any) => mapCcxtCandle(row, symbol, timeframe));
	}
}
