import ccxt from "ccxt";
import type { Order, OHLCV, Position as CcxtPosition, binance } from "ccxt";
import {
	AccountState,
	BinanceExchangeConfig,
	Candle,
	Config,
	OrderRequest,
	Position,
	PositionSide,
} from "@agenai/core";

export interface FetchOHLCVParams {
	symbol: string;
	timeframe: string;
	limit?: number;
	since?: number;
}

export class BinanceExchangeClient {
	private constructor(
		private readonly client: binance,
		private readonly config: BinanceExchangeConfig,
		private readonly hasAuth: boolean
	) {}

	static async create(configName = "binance"): Promise<BinanceExchangeClient> {
		const config = await Config.exchange(configName);
		const apiKey = resolveCredential(config.apiKey);
		const secret = resolveCredential(config.secret);
		const hasAuth = Boolean(apiKey && secret);
		const client = new ccxt.binance({
			apiKey: apiKey || undefined,
			secret: secret || undefined,
			password: config.password ?? undefined,
			enableRateLimit: true,
			options: {
				defaultType: "spot",
				...(config.options ?? {}),
			},
		});

		if (config.testnet) {
			client.setSandboxMode(true);
		}

		return new BinanceExchangeClient(client, config, hasAuth);
	}

	async fetchOHLCV(params: FetchOHLCVParams): Promise<Candle[]> {
		const { symbol, timeframe, limit = 200, since } = params;
		const ohlcv = (await this.client.fetchOHLCV(
			symbol,
			timeframe,
			since,
			limit
		)) as OHLCV[];
		return ohlcv.map(([timestamp, open, high, low, close, volume]) => ({
			timestamp: Number(timestamp ?? 0),
			open: Number(open ?? 0),
			high: Number(high ?? 0),
			low: Number(low ?? 0),
			close: Number(close ?? 0),
			volume: Number(volume ?? 0),
		}));
	}

	async fetchBalance(): Promise<AccountState> {
		if (!this.hasAuth) {
			return {
				balanceUSDT: 0,
				positions: [],
			};
		}

		const balance = await this.client.fetchBalance();
		const total = (balance.total ?? {}) as unknown as Record<string, number>;
		const free = (balance.free ?? {}) as unknown as Record<string, number>;
		const usdt = Number(total["USDT"] ?? free["USDT"] ?? 0);
		const positions = await this.fetchPositions();
		return {
			balanceUSDT: usdt,
			positions,
		};
	}

	async fetchPositions(symbol?: string): Promise<Position[]> {
		if (!this.hasAuth) {
			return [];
		}

		// For spot trading, we simulate positions from balance
		const balance = await this.client.fetchBalance();
		const positions: Position[] = [];

		if (symbol) {
			const [base] = symbol.split("/");
			const free = (balance.free ?? {}) as unknown as Record<string, number>;
			const baseBalance = free[base] ?? 0;

			if (baseBalance > 0) {
				// Get current price to calculate entry value
				const ticker = await this.client.fetchTicker(symbol);
				positions.push({
					symbol,
					side: "long",
					contracts: Number(baseBalance),
					entryPrice: Number(ticker.last ?? 0),
					unrealizedPnl: 0,
					leverage: 1,
				});
			}
		}

		return positions;
	}

	async createOrder(request: OrderRequest): Promise<Order> {
		const type = this.mapOrderType(request.type);
		const params = {
			reduceOnly: request.reduceOnly,
			...(request.params ?? {}),
		};
		return this.client.createOrder(
			request.symbol,
			type,
			request.side,
			request.amount,
			request.price,
			params
		);
	}

	private mapOrderType(type: OrderRequest["type"]): string {
		switch (type) {
			case "limit":
				return "LIMIT";
			case "stop":
				return "STOP_MARKET";
			case "take-profit":
				return "TAKE_PROFIT_MARKET";
			default:
				return "MARKET";
		}
	}

	hasCredentials(): boolean {
		return this.hasAuth;
	}
}

function resolveCredential(value?: string | null): string | undefined {
	if (!value) {
		return undefined;
	}
	const trimmed = value.trim();
	const envMatch = trimmed.match(/^\$\{([^}]+)\}$/);
	if (envMatch) {
		return process.env[envMatch[1]]?.trim() || undefined;
	}
	return trimmed || undefined;
}
