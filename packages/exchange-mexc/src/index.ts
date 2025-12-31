import ccxt, { Balances, Exchange, OHLCV, Order, Position } from "ccxt";
import {
	Candle,
	PositionSide,
	createLogger,
	ExchangeAdapter,
	ExchangePositionSnapshot,
	ExchangeOrder,
} from "@agenai/core";
import { mapCcxtCandleToCandle } from "@agenai/data";

const mexcLogger = createLogger("exchange:mexc");

export interface MexcClientOptions {
	apiKey?: string;
	secret?: string;
	useFutures?: boolean;
}

export class MexcClient implements ExchangeAdapter {
	private readonly exchange: Exchange;
	private marketsLoaded = false;

	constructor(options: MexcClientOptions = {}) {
		this.exchange = new ccxt.mexc({
			apiKey: options.apiKey,
			secret: options.secret,
			enableRateLimit: true,
			options: {
				defaultType: options.useFutures === false ? "spot" : "swap",
				defaultSubType: "linear",
			},
		});
	}

	async fetchOHLCV(
		symbol: string,
		timeframe: string,
		limit = 500,
		since?: number
	): Promise<Candle[]> {
		const marketSymbol = await this.resolveMarketSymbol(symbol);
		const ohlcv = await this.exchange.fetchOHLCV(
			marketSymbol,
			timeframe,
			since,
			limit
		);

		return ohlcv.map((row: OHLCV) =>
			mapCcxtCandleToCandle(row, symbol, timeframe)
		);
	}

	async createMarketOrder(
		symbol: string,
		side: "buy" | "sell",
		amount: number
	): Promise<ExchangeOrder> {
		const marketSymbol = await this.resolveMarketSymbol(symbol);
		return this.exchange.createOrder(
			marketSymbol,
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
		const marketSymbol = await this.resolveMarketSymbol(symbol);
		try {
			const positions = (await this.exchange.fetchPositions([
				marketSymbol,
			])) as Position[];
			const match = positions.find(
				(position) => position.symbol === marketSymbol
			);

			if (!match) {
				return MexcClient.emptyPosition();
			}

			const contracts = Number(
				match.contracts ?? match.info?.vol ?? match.info?.availableVol ?? 0
			);

			if (!contracts) {
				return MexcClient.emptyPosition();
			}

			const side: PositionSide = contracts > 0 ? "LONG" : "SHORT";
			const normalizedEntry =
				match.entryPrice ??
				Number(match.info?.avgEntryPrice ?? match.info?.entryPrice ?? NaN);
			const normalizedPnl =
				match.unrealizedPnl ??
				Number(
					match.info?.unrealizedPnl ?? match.info?.unRealizedProfit ?? NaN
				);
			return {
				side,
				size: Math.abs(contracts),
				entryPrice: Number.isFinite(normalizedEntry ?? NaN)
					? (normalizedEntry as number)
					: null,
				unrealizedPnl: Number.isFinite(normalizedPnl ?? NaN)
					? (normalizedPnl as number)
					: null,
			};
		} catch (error) {
			mexcLogger.warn("get_position_failed", {
				symbol,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			return MexcClient.emptyPosition();
		}
	}

	private async resolveMarketSymbol(symbol: string): Promise<string> {
		await this.ensureMarketsLoaded();
		try {
			return this.exchange.market(symbol).symbol;
		} catch (error) {
			const linearSymbol = `${symbol}:USDT`;
			const market = this.exchange.markets?.[linearSymbol];
			if (market) {
				return market.symbol;
			}
			throw new Error(`Unknown MEXC market symbol for ${symbol}`);
		}
	}

	private async ensureMarketsLoaded(): Promise<void> {
		if (this.marketsLoaded) {
			return;
		}
		await this.exchange.loadMarkets();
		this.marketsLoaded = true;
	}

	private static emptyPosition(): ExchangePositionSnapshot {
		return {
			side: "FLAT",
			size: 0,
			entryPrice: null,
			unrealizedPnl: null,
		};
	}
}

export { mapCcxtCandleToCandle } from "./utils/ccxtMapper";
export type { ExchangePositionSnapshot, ExchangeOrder } from "@agenai/core";
