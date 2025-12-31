import ccxt, { Balances, Exchange, OHLCV, Order } from "ccxt";
import {
	Candle,
	ExchangeAdapter,
	ExchangePositionSnapshot,
	ExchangeOrder,
} from "@agenai/core";
import { mapCcxtCandleToCandle } from "@agenai/data";

export interface BinanceSpotClientOptions {
	apiKey?: string;
	secret?: string;
}

export class BinanceSpotClient implements ExchangeAdapter {
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
		return rows.map((row: OHLCV) =>
			mapCcxtCandleToCandle(row, symbol, timeframe)
		);
	}

	async createMarketOrder(
		symbol: string,
		side: "buy" | "sell",
		amount: number
	): Promise<ExchangeOrder> {
		return this.exchange.createOrder(
			symbol,
			"market",
			side,
			amount
		) as Promise<ExchangeOrder>;
	}

	async getBalanceUSDT(): Promise<number> {
		const rawBalance = (await this.exchange.fetchBalance()) as Balances;
		const total = (rawBalance.total ?? {}) as unknown as Record<string, number>;
		const free = (rawBalance.free ?? {}) as unknown as Record<string, number>;
		return Number(total.USDT ?? free.USDT ?? 0);
	}

	async getPosition(symbol: string): Promise<ExchangePositionSnapshot> {
		// Spot markets don't have positions
		return {
			side: "FLAT",
			size: 0,
			entryPrice: null,
			unrealizedPnl: null,
		};
	}
}

export interface BinanceUsdMClientOptions extends BinanceSpotClientOptions {}

export class BinanceUsdMClient implements ExchangeAdapter {
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
		return rows.map((row: OHLCV) =>
			mapCcxtCandleToCandle(row, symbol, timeframe)
		);
	}

	async createMarketOrder(
		symbol: string,
		side: "buy" | "sell",
		amount: number
	): Promise<ExchangeOrder> {
		return this.exchange.createOrder(
			symbol,
			"market",
			side,
			amount
		) as Promise<ExchangeOrder>;
	}

	async getBalanceUSDT(): Promise<number> {
		const rawBalance = (await this.exchange.fetchBalance()) as Balances;
		const total = (rawBalance.total ?? {}) as unknown as Record<string, number>;
		const free = (rawBalance.free ?? {}) as unknown as Record<string, number>;
		return Number(total.USDT ?? free.USDT ?? 0);
	}

	async getPosition(symbol: string): Promise<ExchangePositionSnapshot> {
		// USD-M futures support positions - would need to implement fetchPositions
		// For now, return FLAT (placeholder implementation)
		return {
			side: "FLAT",
			size: 0,
			entryPrice: null,
			unrealizedPnl: null,
		};
	}
}
