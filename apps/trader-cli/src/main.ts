import {
	Candle,
	PositionSide,
	TradeIntent,
	loadAccountConfig,
	loadAgenaiConfig,
} from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
import {
	ExecutionEngine,
	ExecutionResult,
	PaperPositionSnapshot,
	PaperAccount,
	PaperAccountSnapshot,
} from "@agenai/execution-engine";
import { RiskManager, TradePlan } from "@agenai/risk-engine";
import { MacdAr4Strategy } from "@agenai/strategy-engine";

const POLL_INTERVAL_MS = 10_000;

const main = async (): Promise<void> => {
	const config = loadAgenaiConfig();
	const exchange = config.exchange;

	const client = new MexcClient({
		apiKey: exchange.credentials.apiKey,
		secret: exchange.credentials.apiSecret,
		useFutures: true,
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
	const riskManager = new RiskManager(config.risk);
	const accountConfig = loadAccountConfig();
	const executionMode = config.env.executionMode;
	const paperAccount =
		executionMode === "paper"
			? new PaperAccount(accountConfig.startingBalance)
			: undefined;
	const executionEngine = new ExecutionEngine({
		client,
		mode: executionMode,
		paperAccount,
	});
	const initialEquity = paperAccount
		? paperAccount.snapshot(0).equity
		: accountConfig.startingBalance || 100;

	console.info("AgenAI Trader CLI started");
	console.info(
		JSON.stringify({ symbol, timeframe, useTestnet: exchange.testnet })
	);
	console.log(
		JSON.stringify({
			event: "risk_config",
			riskPerTradePercent: config.risk.riskPerTradePercent,
			minPositionSize: config.risk.minPositionSize,
			maxPositionSize: config.risk.maxPositionSize,
			slPct: config.risk.slPct,
			tpPct: config.risk.tpPct,
		})
	);

	const candlesBySymbol = new Map<string, Candle[]>();
	const lastTimestampBySymbol = new Map<string, number>();

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
		initialEquity,
		symbol,
		timeframe,
		candlesBySymbol,
		lastTimestampBySymbol
	);
};

const bootstrapCandles = async (
	client: MexcClient,
	symbol: string,
	timeframe: string,
	candlesBySymbol: Map<string, Candle[]>,
	lastTimestampBySymbol: Map<string, number>
): Promise<void> => {
	try {
		const candles = await client.fetchOHLCV(symbol, timeframe, 300);
		if (!candles.length) {
			console.warn("Bootstrap fetch returned no candles for", symbol);
			return;
		}

		candlesBySymbol.set(symbol, candles);
		lastTimestampBySymbol.set(
			symbol,
			candles[candles.length - 1]?.timestamp ?? 0
		);
		console.info(`Bootstrapped ${candles.length} candles for ${symbol}`);
	} catch (error) {
		logMarketDataError(error);
	}
};

const startPolling = async (
	client: MexcClient,
	strategy: MacdAr4Strategy,
	riskManager: RiskManager,
	executionEngine: ExecutionEngine,
	defaultEquity: number,
	symbol: string,
	timeframe: string,
	candlesBySymbol: Map<string, Candle[]>,
	lastTimestampBySymbol: Map<string, number>
): Promise<never> => {
	let fallbackEquity = defaultEquity;
	while (true) {
		let latest: Candle | undefined;
		try {
			const candles = await client.fetchOHLCV(symbol, timeframe, 1);
			const latestRaw = candles[candles.length - 1];

			if (!latestRaw) {
				console.warn("No candle data returned for", symbol);
			} else {
				latest = latestRaw;
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

				const positionState = executionEngine.getPaperPosition(symbol);
				const unrealizedPnl = calculateUnrealizedPnl(
					positionState,
					latest.close
				);
				const prePlanSnapshot =
					executionEngine.snapshotPaperAccount(unrealizedPnl);
				const accountEquity = prePlanSnapshot?.equity ?? fallbackEquity;
				const intent = strategy.decide(buffer, positionState.side);
				logStrategyDecision(latest, intent);

				if (intent.intent === "OPEN_LONG" || intent.intent === "CLOSE_LONG") {
					const plan = riskManager.plan(
						intent,
						latest.close,
						accountEquity,
						positionState.size
					);
					if (!plan) {
						logExecutionSkipped(
							intent,
							positionState.side,
							intent.intent === "CLOSE_LONG"
								? "no_position_to_close"
								: "risk_plan_rejected"
						);
					} else {
						const skipReason = getPreExecutionSkipReason(plan, positionState);
						if (skipReason) {
							logExecutionSkipped(plan, positionState.side, skipReason);
						} else {
							logTradePlan(plan, latest);
							try {
								const result = await executionEngine.execute(plan, {
									price: latest.close,
								});
								if (result.status === "skipped") {
									logExecutionSkipped(
										plan,
										positionState.side,
										result.reason ?? "execution_engine_skip"
									);
								} else {
									logExecutionResult(result);
								}
							} catch (error) {
								logExecutionError(error, plan);
							}
						}
					}
				}

				const latestPosition = executionEngine.getPaperPosition(symbol);
				logPaperPosition(symbol, latestPosition);

				const accountSnapshot = snapshotPaperAccount(
					executionEngine,
					calculateUnrealizedPnl(latestPosition, latest.close),
					symbol,
					latest.timestamp
				);
				if (accountSnapshot) {
					fallbackEquity = accountSnapshot.equity;
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
	const payload: Record<string, unknown> = {
		event:
			result.mode === "paper" ? "paper_execution_result" : "execution_result",
		symbol: result.symbol,
		side: result.side,
		quantity: result.quantity,
		price: result.price,
		status: result.status,
	};

	if (typeof result.realizedPnl === "number") {
		payload.realizedPnl = result.realizedPnl;
	}
	if (typeof result.totalRealizedPnl === "number") {
		payload.totalRealizedPnl = result.totalRealizedPnl;
	}

	console.log(JSON.stringify(payload));
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
	planOrIntent: TradePlan | TradeIntent,
	positionSide: PositionSide,
	reason: string
): void => {
	console.log(
		JSON.stringify({
			event: "execution_skipped",
			symbol: planOrIntent.symbol,
			side: "side" in planOrIntent ? planOrIntent.side : planOrIntent.intent,
			positionSide,
			reason,
		})
	);
};

const getPreExecutionSkipReason = (
	plan: TradePlan,
	positionState: PaperPositionSnapshot
): string | null => {
	if (plan.side === "buy" && positionState.side === "LONG") {
		return "already_long";
	}
	if (plan.side === "sell" && positionState.side === "FLAT") {
		return "already_flat";
	}
	return null;
};

const logPaperPosition = (
	symbol: string,
	position: PaperPositionSnapshot
): void => {
	console.log(
		JSON.stringify({
			event: "paper_position",
			symbol,
			side: position.side,
			size: position.size,
			avgEntryPrice: position.avgEntryPrice,
			realizedPnl: position.realizedPnl,
		})
	);
};

const snapshotPaperAccount = (
	executionEngine: ExecutionEngine,
	unrealizedPnl: number,
	symbol: string,
	timestamp: number
): PaperAccountSnapshot | null => {
	const snapshot = executionEngine.snapshotPaperAccount(unrealizedPnl);
	if (!snapshot) {
		return null;
	}

	logPaperAccountSnapshot(symbol, timestamp, snapshot);
	return snapshot;
};

const logPaperAccountSnapshot = (
	symbol: string,
	timestamp: number,
	snapshot: PaperAccountSnapshot
): void => {
	console.log(
		JSON.stringify({
			event: "paper_account_snapshot",
			symbol,
			timestamp: new Date(timestamp).toISOString(),
			snapshot,
		})
	);
};

const calculateUnrealizedPnl = (
	position: PaperPositionSnapshot,
	price: number
): number => {
	if (position.side !== "LONG" || position.avgEntryPrice === null) {
		return 0;
	}

	return (price - position.avgEntryPrice) * position.size;
};

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

main().catch((error) => {
	console.error("Trader CLI failed:", error);
	process.exit(1);
});
