import {
	Candle,
	PositionSide,
	TradeIntent,
	loadAgenaiConfig,
} from "@agenai/core";
import { BinanceClient } from "@agenai/exchange-binance";
import { ExecutionEngine, ExecutionResult } from "@agenai/execution-engine";
import { RiskManager, TradePlan } from "@agenai/risk-engine";
import { MacdAr4Strategy } from "@agenai/strategy-engine";

const POLL_INTERVAL_MS = 10_000;

const main = async (): Promise<void> => {
	const config = loadAgenaiConfig();
	const exchange = config.exchange;

	const client = new BinanceClient({
		apiKey: exchange.credentials.apiKey,
		apiSecret: exchange.credentials.apiSecret,
		useTestnet: exchange.testnet,
	});

	const symbol =
		config.env.defaultSymbol ||
		exchange.defaultSymbol ||
		config.strategy.symbol;
	const timeframe = config.env.defaultTimeframe || config.strategy.timeframe;

	const strategy = new MacdAr4Strategy({
		emaFast: 12,
		emaSlow: 26,
		signal: 9,
		arWindow: 20,
		minForecast: 0,
	});
	const riskManager = new RiskManager({
		riskPerTradePct: config.risk.riskPerTradePct,
		slPct: config.risk.slPct,
		tpPct: config.risk.tpPct,
	});
	const executionEngine = new ExecutionEngine(client);
	const simulatedEquity = 100;

	console.info("AgenAI Trader CLI started");
	console.info(
		JSON.stringify({ symbol, timeframe, useTestnet: exchange.testnet })
	);

	const candlesBySymbol = new Map<string, Candle[]>();
	const lastTimestampBySymbol = new Map<string, number>();
	const positionBySymbol = new Map<string, PositionState>();
	positionBySymbol.set(symbol, { side: "FLAT", quantity: 0 });

	await bootstrapCandles(
		client,
		symbol,
		timeframe,
		candlesBySymbol,
		lastTimestampBySymbol
	);

	await startPolling(
		client,
		strategy,
		riskManager,
		executionEngine,
		simulatedEquity,
		positionBySymbol,
		symbol,
		timeframe,
		candlesBySymbol,
		lastTimestampBySymbol
	);
};

const bootstrapCandles = async (
	client: BinanceClient,
	symbol: string,
	timeframe: string,
	candlesBySymbol: Map<string, Candle[]>,
	lastTimestampBySymbol: Map<string, number>
): Promise<void> => {
	try {
		const candles = await client.fetchOHLCV({ symbol, timeframe, limit: 300 });
		if (!candles.length) {
			console.warn("Bootstrap fetch returned no candles for", symbol);
			return;
		}

		const normalized: Candle[] = candles.map((raw) => ({
			symbol,
			timeframe,
			timestamp: raw.timestamp,
			open: raw.open,
			high: raw.high,
			low: raw.low,
			close: raw.close,
			volume: raw.volume,
		}));

		candlesBySymbol.set(symbol, normalized);
		lastTimestampBySymbol.set(
			symbol,
			normalized[normalized.length - 1]?.timestamp ?? 0
		);
		console.info(`Bootstrapped ${normalized.length} candles for ${symbol}`);
	} catch (error) {
		logMarketDataError(error);
	}
};

const startPolling = async (
	client: BinanceClient,
	strategy: MacdAr4Strategy,
	riskManager: RiskManager,
	executionEngine: ExecutionEngine,
	equity: number,
	positionBySymbol: Map<string, PositionState>,
	symbol: string,
	timeframe: string,
	candlesBySymbol: Map<string, Candle[]>,
	lastTimestampBySymbol: Map<string, number>
): Promise<never> => {
	while (true) {
		let latest: Candle | undefined;
		try {
			const candles = await client.fetchOHLCV({ symbol, timeframe, limit: 1 });
			const latestRaw = candles[candles.length - 1];

			if (!latestRaw) {
				console.warn("No candle data returned for", symbol);
			} else {
				latest = {
					symbol,
					timeframe,
					timestamp: latestRaw.timestamp,
					open: latestRaw.open,
					high: latestRaw.high,
					low: latestRaw.low,
					close: latestRaw.close,
					volume: latestRaw.volume,
				};
			}
		} catch (error) {
			logMarketDataError(error);
		}

		if (latest) {
			const lastTimestamp = lastTimestampBySymbol.get(symbol);

			if (lastTimestamp !== latest.timestamp) {
				lastTimestampBySymbol.set(symbol, latest.timestamp);
				const buffer = appendCandle(candlesBySymbol, latest);
				logCandle(latest);

				const positionState = getPositionState(positionBySymbol, symbol);
				const intent = strategy.decide(buffer, positionState.side);
				logStrategyDecision(latest, intent);

				if (intent.intent === "OPEN_LONG" || intent.intent === "CLOSE_LONG") {
					const plan = riskManager.plan(
						intent,
						latest.close,
						equity,
						positionState.quantity
					);
					if (!plan) {
						continue;
					}

					if (shouldSkipExecution(plan, positionState)) {
						logExecutionSkipped(plan, positionState);
					} else {
						logTradePlan(plan, latest);
						try {
							const result = await executionEngine.execute(plan);
							logExecutionResult(result);
							updatePositionState(positionBySymbol, plan);
						} catch (error) {
							logExecutionError(error, plan);
						}
					}
				}
			} else {
				console.info("No new candle yet for", symbol);
			}
		}

		await delay(POLL_INTERVAL_MS);
	}
};

const appendCandle = (
	candlesBySymbol: Map<string, Candle[]>,
	candle: Candle
): Candle[] => {
	const buffer = candlesBySymbol.get(candle.symbol) ?? [];
	buffer.push(candle);
	if (buffer.length > 500) {
		buffer.splice(0, buffer.length - 500);
	}
	candlesBySymbol.set(candle.symbol, buffer);
	return buffer;
};

const logCandle = (candle: Candle): void => {
	const payload = {
		symbol: candle.symbol,
		timeframe: candle.timeframe,
		timestamp: new Date(candle.timestamp).toISOString(),
		open: candle.open,
		high: candle.high,
		low: candle.low,
		close: candle.close,
		volume: candle.volume,
	};
	console.info("Latest candle:", payload);
};

const logStrategyDecision = (candle: Candle, intent: TradeIntent): void => {
	console.log(
		JSON.stringify({
			event: "strategy_decision",
			symbol: candle.symbol,
			timestamp: new Date(candle.timestamp).toISOString(),
			close: candle.close,
			intent: intent.intent,
			reason: intent.reason,
		})
	);
};

const logTradePlan = (plan: TradePlan, candle: Candle): void => {
	console.log(
		JSON.stringify({
			event: "trade_plan",
			symbol: plan.symbol,
			timestamp: new Date(candle.timestamp).toISOString(),
			intent: plan.reason,
			side: plan.side,
			quantity: plan.quantity,
			stopLossPrice: plan.stopLossPrice,
			takeProfitPrice: plan.takeProfitPrice,
		})
	);
};

const logExecutionResult = (result: ExecutionResult): void => {
	console.log(
		JSON.stringify({
			event: "execution_result",
			symbol: result.symbol,
			side: result.side,
			quantity: result.quantity,
			price: result.price,
			status: result.status,
		})
	);
};

const logExecutionError = (error: unknown, plan: TradePlan): void => {
	console.error(
		JSON.stringify({
			event: "execution_error",
			symbol: plan.symbol,
			side: plan.side,
			quantity: plan.quantity,
			message: error instanceof Error ? error.message : String(error),
		})
	);
};

const logMarketDataError = (error: unknown): void => {
	console.error(
		JSON.stringify({
			event: "market_data_error",
			message: error instanceof Error ? error.message : String(error),
		})
	);
};

const logExecutionSkipped = (
	plan: TradePlan,
	positionState: PositionState
): void => {
	console.log(
		JSON.stringify({
			event: "execution_skipped",
			symbol: plan.symbol,
			side: plan.side,
			reason:
				plan.side === "buy" && positionState.side === "LONG"
					? "already_long"
					: "already_flat",
		})
	);
};

const getPositionState = (
	positionBySymbol: Map<string, PositionState>,
	symbol: string
): PositionState =>
	positionBySymbol.get(symbol) ?? { side: "FLAT", quantity: 0 };

const updatePositionState = (
	positionBySymbol: Map<string, PositionState>,
	plan: TradePlan
): void => {
	if (plan.side === "buy") {
		positionBySymbol.set(plan.symbol, {
			side: "LONG",
			quantity: plan.quantity,
		});
		return;
	}

	positionBySymbol.set(plan.symbol, { side: "FLAT", quantity: 0 });
};

const shouldSkipExecution = (
	plan: TradePlan,
	positionState: PositionState
): boolean => {
	if (plan.side === "buy" && positionState.side === "LONG") {
		return true;
	}
	if (plan.side === "sell" && positionState.side === "FLAT") {
		return true;
	}
	return false;
};

interface PositionState {
	side: PositionSide;
	quantity: number;
}

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

main().catch((error) => {
	console.error("Trader CLI failed:", error);
	process.exit(1);
});
