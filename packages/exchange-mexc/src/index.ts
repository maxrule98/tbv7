import ccxt, { Balances, Exchange, OHLCV, Order, Position } from "ccxt";
import { Candle, PositionSide } from "@agenai/core";

export interface MexcClientOptions {
	apiKey?: string;
	secret?: string;
	useFutures?: boolean;
}

export interface ExchangePositionSnapshot {
	side: PositionSide;
	size: number;
	entryPrice: number | null;
	unrealizedPnl: number | null;
}

export class MexcClient {
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
		limit = 500
	): Promise<Candle[]> {
		const marketSymbol = await this.resolveMarketSymbol(symbol);
		const ohlcv = await this.exchange.fetchOHLCV(
			marketSymbol,
			timeframe,
			undefined,
			limit
		);

		return ohlcv.map((row: OHLCV) =>
			MexcClient.mapCandle(row, symbol, timeframe)
		);
	}

	async createMarketOrder(
		symbol: string,
		side: "buy" | "sell",
		amount: number
	): Promise<Order> {
		const marketSymbol = await this.resolveMarketSymbol(symbol);
		return this.exchange.createOrder(marketSymbol, "market", side, amount);
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
			console.warn("MexcClient.getPosition failed", error);
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

	private static mapCandle(
		row: OHLCV,
		symbol: string,
		timeframe: string
	): Candle {
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
