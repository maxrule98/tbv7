import {
	AccountConfig,
	AgenaiConfig,
	Candle,
	ExecutionMode,
	PositionSide,
	StrategyConfig,
	RiskConfig,
	StrategyId,
	TradeIntent,
	createLogger,
	loadAccountConfig,
	loadAgenaiConfig,
} from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
import {
	ExecutionEngine,
	ExecutionResult,
	PaperAccount,
	PaperAccountSnapshot,
	PaperPositionSnapshot,
} from "@agenai/execution-engine";
import { RiskManager, TradePlan } from "@agenai/risk-engine";
import { resolveStrategyBuilder } from "./strategyBuilders";
import type { TraderStrategy } from "./types";
export type { TraderStrategy } from "./types";

const logger = createLogger("trader-runtime");

export const DEFAULT_POLL_INTERVAL_MS = 10_000;

export interface TraderConfig {
	symbol: string;
	timeframe: string;
	useTestnet: boolean;
	executionMode?: ExecutionMode;
	pollIntervalMs?: number;
	strategyId?: StrategyId;
}

export interface StartTraderOptions {
	agenaiConfig?: AgenaiConfig;
	accountConfig?: AccountConfig;
	accountProfile?: string;
	configDir?: string;
	envPath?: string;
	exchangeProfile?: string;
	strategyProfile?: string;
	riskProfile?: string;
	strategyOverride?: TraderStrategy;
	strategyBuilder?: (client: MexcClient) => Promise<TraderStrategy>;
}

type StrategySource = "override" | "builder";

interface StrategyLogContext {
	source: StrategySource;
	strategy: TraderStrategy;
	strategyConfig?: StrategyConfig;
	strategyId: StrategyId;
	traderConfig: TraderConfig;
	executionMode: ExecutionMode;
	builderName?: string;
	profiles?: {
		account?: string;
		strategy?: string;
		risk?: string;
		exchange?: string;
	};
}

export const startTrader = async (
	traderConfig: TraderConfig,
	options: StartTraderOptions = {}
): Promise<never> => {
	const agenaiConfig =
		options.agenaiConfig ??
		loadAgenaiConfig({
			envPath: options.envPath,
			configDir: options.configDir,
			exchangeProfile: options.exchangeProfile,
			strategyProfile: options.strategyProfile,
			riskProfile: options.riskProfile,
		});
	const accountConfig =
		options.accountConfig ??
		loadAccountConfig(options.configDir, options.accountProfile ?? "paper");

	const executionMode =
		traderConfig.executionMode ?? agenaiConfig.env.executionMode ?? "paper";
	const resolvedStrategyId =
		traderConfig.strategyId ?? agenaiConfig.strategy.id;

	const client = new MexcClient({
		apiKey: agenaiConfig.exchange.credentials.apiKey,
		secret: agenaiConfig.exchange.credentials.apiSecret,
		useFutures: true,
	});

	const effectiveBuilder =
		options.strategyBuilder ??
		resolveStrategyBuilder(resolvedStrategyId, {
			strategyConfig: agenaiConfig.strategy,
			symbol: traderConfig.symbol,
			timeframe: traderConfig.timeframe,
		});

	const strategySource: StrategySource = options.strategyOverride
		? "override"
		: "builder";
	const strategy = options.strategyOverride
		? options.strategyOverride
		: await effectiveBuilder(client);
	const riskManager = new RiskManager(agenaiConfig.risk);
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

	logger.info("trader_config", {
		symbol: traderConfig.symbol,
		timeframe: traderConfig.timeframe,
		useTestnet: traderConfig.useTestnet,
		executionMode,
		strategyId: resolvedStrategyId,
	});
	logStrategyLoaded({
		source: strategySource,
		strategy,
		strategyConfig: options.strategyOverride
			? undefined
			: agenaiConfig.strategy,
		strategyId: resolvedStrategyId,
		traderConfig,
		executionMode,
		builderName:
			strategySource === "builder"
				? options.strategyBuilder?.name ?? effectiveBuilder.name
				: undefined,
		profiles: {
			account: options.accountProfile,
			strategy: options.strategyProfile,
			risk: options.riskProfile,
			exchange: options.exchangeProfile,
		},
	});
	logRiskConfig(agenaiConfig.risk);

	const candlesBySymbol = new Map<string, Candle[]>();
	const lastTimestampBySymbol = new Map<string, number>();

	await bootstrapCandles(
		client,
		traderConfig.symbol,
		traderConfig.timeframe,
		candlesBySymbol,
		lastTimestampBySymbol
	);

	return startPolling(
		client,
		strategy,
		riskManager,
		agenaiConfig.risk,
		executionEngine,
		initialEquity,
		traderConfig.symbol,
		traderConfig.timeframe,
		candlesBySymbol,
		lastTimestampBySymbol,
		traderConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
	);
};

const getStrategyName = (strategy: TraderStrategy): string => {
	const ctorName =
		(strategy as { constructor?: { name?: string } })?.constructor?.name ??
		"AnonymousStrategy";
	return ctorName === "Object" ? "AnonymousStrategy" : ctorName;
};

const logStrategyLoaded = ({
	source,
	strategy,
	strategyConfig,
	strategyId,
	traderConfig,
	executionMode,
	builderName,
	profiles,
}: StrategyLogContext): void => {
	const pollInterval = traderConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	logger.info("strategy_loaded", {
		source,
		strategyId,
		strategyClass: getStrategyName(strategy),
		symbol: traderConfig.symbol,
		timeframe: traderConfig.timeframe,
		executionMode,
		useTestnet: traderConfig.useTestnet,
		pollIntervalMs: pollInterval,
		builder: builderName ?? null,
		profiles: profiles ?? null,
		configId: strategyConfig?.id ?? null,
	});
};

const logRiskConfig = (risk: RiskConfig): void => {
	logger.info("risk_config", {
		riskPerTradePercent: risk.riskPerTradePercent,
		minPositionSize: risk.minPositionSize,
		maxPositionSize: risk.maxPositionSize,
		slPct: risk.slPct,
		tpPct: risk.tpPct,
		trailingActivationPct: risk.trailingActivationPct,
		trailingTrailPct: risk.trailingTrailPct,
	});
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
			logger.warn("bootstrap_no_candles", { symbol, timeframe });
			return;
		}

		candlesBySymbol.set(symbol, candles);
		lastTimestampBySymbol.set(
			symbol,
			candles[candles.length - 1]?.timestamp ?? 0
		);
		logger.info("bootstrap_candles_loaded", {
			symbol,
			timeframe,
			count: candles.length,
		});
	} catch (error) {
		logMarketDataError(error);
	}
};

const startPolling = async (
	client: MexcClient,
	strategy: TraderStrategy,
	riskManager: RiskManager,
	riskConfig: RiskConfig,
	executionEngine: ExecutionEngine,
	defaultEquity: number,
	symbol: string,
	timeframe: string,
	candlesBySymbol: Map<string, Candle[]>,
	lastTimestampBySymbol: Map<string, number>,
	pollIntervalMs: number
): Promise<never> => {
	let fallbackEquity = defaultEquity;
	while (true) {
		let latest: Candle | undefined;
		try {
			const candles = await client.fetchOHLCV(symbol, timeframe, 1);
			const latestRaw = candles[candles.length - 1];

			if (!latestRaw) {
				logger.warn("poll_no_candle", { symbol, timeframe });
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

				const positionState = executionEngine.getPosition(symbol);
				const unrealizedPnl = calculateUnrealizedPnl(
					positionState,
					latest.close
				);
				const prePlanSnapshot =
					executionEngine.snapshotPaperAccount(unrealizedPnl);
				const accountEquity = prePlanSnapshot?.equity ?? fallbackEquity;

				const forcedExitHandled = await maybeHandleForcedExit(
					positionState,
					latest,
					riskManager,
					executionEngine,
					accountEquity
				);
				if (forcedExitHandled) {
					const accountSnapshot = logAndSnapshotPosition(
						executionEngine,
						symbol,
						latest.close,
						latest.timestamp
					);
					if (accountSnapshot) {
						fallbackEquity = accountSnapshot.equity;
					}
					await delay(pollIntervalMs);
					continue;
				}

				const trailingExitHandled = await maybeHandleTrailingStop(
					symbol,
					positionState,
					latest,
					riskManager,
					executionEngine,
					accountEquity,
					riskConfig
				);
				if (trailingExitHandled) {
					const accountSnapshot = logAndSnapshotPosition(
						executionEngine,
						symbol,
						latest.close,
						latest.timestamp
					);
					if (accountSnapshot) {
						fallbackEquity = accountSnapshot.equity;
					}
					await delay(pollIntervalMs);
					continue;
				}

				const intent = enrichIntentMetadata(
					await strategy.decide(buffer, positionState.side)
				);
				logStrategyDecision(latest, intent);

				const plan = riskManager.plan(
					intent,
					latest.close,
					accountEquity,
					positionState
				);
				if (!plan) {
					if (intent.intent !== "NO_ACTION") {
						const reason =
							intent.intent === "CLOSE_LONG" || intent.intent === "CLOSE_SHORT"
								? "no_position_to_close"
								: "risk_plan_rejected";
						logExecutionSkipped(intent, positionState.side, reason);
					}
				} else {
					const skipReason = getPreExecutionSkipReason(plan, positionState);
					if (skipReason) {
						logExecutionSkipped(plan, positionState.side, skipReason);
					} else {
						logTradePlan(plan, latest, intent);
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

				const latestPosition = executionEngine.getPosition(symbol);
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
				logger.debug("poll_no_update", {
					symbol,
					timeframe,
					lastTimestamp,
				});
			}
		}

		await delay(pollIntervalMs);
	}
};

const maybeHandleForcedExit = async (
	positionState: PaperPositionSnapshot,
	lastCandle: Candle,
	riskManager: RiskManager,
	executionEngine: ExecutionEngine,
	accountEquity: number
): Promise<boolean> => {
	if (positionState.side === "FLAT" || positionState.size <= 0) {
		return false;
	}

	const stopLossPrice = positionState.stopLossPrice;
	const takeProfitPrice = positionState.takeProfitPrice;
	const isLong = positionState.side === "LONG";
	const hitSL =
		typeof stopLossPrice === "number" &&
		(isLong
			? lastCandle.low <= stopLossPrice
			: lastCandle.high >= stopLossPrice);
	const hitTP =
		typeof takeProfitPrice === "number" &&
		(isLong
			? lastCandle.high >= takeProfitPrice
			: lastCandle.low <= takeProfitPrice);

	if (!hitSL && !hitTP) {
		return false;
	}

	// Mirror SL/TP triggers for both directions so shorts respect the same safety rails.
	const reasonBase = hitSL ? "stop_loss_hit" : "take_profit_hit";
	const reason = isLong ? reasonBase : `short_${reasonBase}`;
	const intentType = isLong ? "CLOSE_LONG" : "CLOSE_SHORT";
	const orderSide = isLong ? "sell" : "buy";
	const forcedIntent: TradeIntent = {
		symbol: lastCandle.symbol,
		intent: intentType,
		reason,
		timestamp: lastCandle.timestamp,
		positionSide: isLong ? "LONG" : "SHORT",
		action: "CLOSE",
		side: orderSide,
	};

	logStrategyDecision(lastCandle, forcedIntent);

	const plan = riskManager.plan(
		forcedIntent,
		lastCandle.close,
		accountEquity,
		positionState
	);
	if (!plan) {
		logExecutionSkipped(
			forcedIntent,
			positionState.side,
			"forced_exit_plan_rejected"
		);
		return true;
	}

	const skipReason = getPreExecutionSkipReason(plan, positionState);
	if (skipReason) {
		logExecutionSkipped(plan, positionState.side, skipReason);
		return true;
	}

	logTradePlan(plan, lastCandle, forcedIntent);
	try {
		const result = await executionEngine.execute(plan, {
			price: lastCandle.close,
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

	return true;
};

const maybeHandleTrailingStop = async (
	symbol: string,
	positionState: PaperPositionSnapshot,
	lastCandle: Candle,
	riskManager: RiskManager,
	executionEngine: ExecutionEngine,
	accountEquity: number,
	riskConfig: RiskConfig
): Promise<boolean> => {
	if (positionState.side === "FLAT" || positionState.size <= 0) {
		return false;
	}

	const entryPrice =
		positionState.entryPrice > 0
			? positionState.entryPrice
			: positionState.avgEntryPrice ?? 0;
	if (entryPrice <= 0) {
		return false;
	}

	const activationPct = Math.max(riskConfig.trailingActivationPct ?? 0, 0);
	const trailPct = Math.max(riskConfig.trailingTrailPct ?? 0, 0);
	if (trailPct <= 0) {
		return false;
	}
	const isLong = positionState.side === "LONG";

	let isTrailingActive = positionState.isTrailingActive;
	let peakPrice =
		positionState.peakPrice > 0 ? positionState.peakPrice : entryPrice;
	let troughPrice =
		positionState.troughPrice > 0 ? positionState.troughPrice : entryPrice;
	let trailingStopPrice =
		positionState.trailingStopPrice > 0
			? positionState.trailingStopPrice
			: positionState.stopLossPrice ?? 0;
	const updates: Partial<PaperPositionSnapshot> = {};

	const activationBarrier = isLong
		? entryPrice * (1 + activationPct)
		: entryPrice * (1 - activationPct);
	const activationTriggered = isLong
		? lastCandle.close >= activationBarrier
		: lastCandle.close <= activationBarrier;

	if (!isTrailingActive && activationTriggered) {
		isTrailingActive = true;
		updates.isTrailingActive = true;
	}

	if (!isTrailingActive) {
		if (Object.keys(updates).length) {
			executionEngine.updatePosition(symbol, updates);
		}
		return false;
	}

	let proposedTrailing = trailingStopPrice;
	// Track favorable extremes separately so both long and short trails ratchet toward price.
	if (isLong) {
		peakPrice = Math.max(peakPrice, lastCandle.high);
		proposedTrailing = peakPrice * (1 - trailPct);
		if (peakPrice !== positionState.peakPrice) {
			updates.peakPrice = peakPrice;
		}
		if (proposedTrailing > trailingStopPrice) {
			trailingStopPrice = proposedTrailing;
			updates.trailingStopPrice = trailingStopPrice;
		}
	} else {
		troughPrice = Math.min(troughPrice, lastCandle.low);
		proposedTrailing = troughPrice * (1 + trailPct);
		if (troughPrice !== positionState.troughPrice) {
			updates.troughPrice = troughPrice;
		}
		if (trailingStopPrice === 0 || proposedTrailing < trailingStopPrice) {
			trailingStopPrice = proposedTrailing;
			updates.trailingStopPrice = trailingStopPrice;
		}
	}

	if (Object.keys(updates).length) {
		executionEngine.updatePosition(symbol, updates);
	}

	const stopStillValid = trailingStopPrice > 0;
	const stopTriggered = isLong
		? lastCandle.low <= trailingStopPrice
		: lastCandle.high >= trailingStopPrice;
	if (!stopStillValid || !stopTriggered) {
		return false;
	}

	const reason = isLong ? "trailing_stop_hit" : "short_trailing_stop_hit";
	const intentType = isLong ? "CLOSE_LONG" : "CLOSE_SHORT";
	const orderSide = isLong ? "sell" : "buy";
	const forcedIntent: TradeIntent = {
		symbol,
		intent: intentType,
		reason: reason,
		timestamp: lastCandle.timestamp,
		positionSide: isLong ? "LONG" : "SHORT",
		action: "CLOSE",
		side: orderSide,
	};

	logStrategyDecision(lastCandle, forcedIntent);

	const plan = riskManager.plan(
		forcedIntent,
		lastCandle.close,
		accountEquity,
		positionState
	);
	if (!plan) {
		logExecutionSkipped(
			forcedIntent,
			positionState.side,
			"trailing_exit_plan_rejected"
		);
		return true;
	}

	const skipReason = getPreExecutionSkipReason(plan, positionState);
	if (skipReason) {
		logExecutionSkipped(plan, positionState.side, skipReason);
		return true;
	}

	logTradePlan(plan, lastCandle, forcedIntent);
	try {
		const result = await executionEngine.execute(plan, {
			price: lastCandle.close,
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

	return true;
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
	logger.debug("latest_candle", payload);
};

const logStrategyDecision = (candle: Candle, intent: TradeIntent): void => {
	logger.info("strategy_decision", {
		symbol: candle.symbol,
		timeframe: candle.timeframe,
		timestamp: new Date(candle.timestamp).toISOString(),
		close: candle.close,
		intent: intent.intent,
		reason: intent.reason,
	});
};

const logTradePlan = (
	plan: TradePlan,
	candle: Candle,
	intent: TradeIntent
): void => {
	logger.info("trade_plan", {
		symbol: plan.symbol,
		timeframe: candle.timeframe,
		timestamp: new Date(candle.timestamp).toISOString(),
		intent: intent.intent,
		action: plan.action,
		positionSide: plan.positionSide,
		side: plan.side,
		quantity: plan.quantity,
		stopLossPrice: plan.stopLossPrice,
		takeProfitPrice: plan.takeProfitPrice,
		recommendations: intent.metadata?.recommendations ?? null,
	});
};

const logExecutionResult = (result: ExecutionResult): void => {
	const eventName =
		result.mode === "paper" ? "paper_execution_result" : "execution_result";
	const payload: Record<string, unknown> = {
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

	logger.info(eventName, payload);
};

const logExecutionError = (error: unknown, plan: TradePlan): void => {
	logger.error("execution_error", {
		symbol: plan.symbol,
		side: plan.side,
		action: plan.action,
		positionSide: plan.positionSide,
		quantity: plan.quantity,
		message: error instanceof Error ? error.message : String(error),
	});
};

const logMarketDataError = (error: unknown): void => {
	logger.error("market_data_error", {
		message: error instanceof Error ? error.message : String(error),
	});
};

const logExecutionSkipped = (
	planOrIntent: TradePlan | TradeIntent,
	positionSide: PositionSide,
	reason: string
): void => {
	const payload: Record<string, unknown> = {
		symbol: planOrIntent.symbol,
		positionSide,
		reason,
	};
	if ("type" in planOrIntent) {
		payload.action = planOrIntent.action;
		payload.side = planOrIntent.side;
		payload.planPositionSide = planOrIntent.positionSide;
	} else {
		payload.intent = planOrIntent.intent;
		payload.side = planOrIntent.side ?? planOrIntent.intent;
	}
	logger.info("execution_skipped", payload);
};

const getPreExecutionSkipReason = (
	plan: TradePlan,
	positionState: PaperPositionSnapshot
): string | null => {
	if (plan.action === "OPEN") {
		if (positionState.side === plan.positionSide) {
			return "already_in_position";
		}
		if (
			positionState.side !== "FLAT" &&
			positionState.side !== plan.positionSide
		) {
			return "opposite_position_open";
		}
	}
	if (plan.action === "CLOSE") {
		if (positionState.side !== plan.positionSide || positionState.size <= 0) {
			return "no_position_to_close";
		}
	}
	if (plan.quantity <= 0) {
		return "invalid_quantity";
	}
	return null;
};

const logPaperPosition = (
	symbol: string,
	position: PaperPositionSnapshot
): void => {
	logger.info("paper_position", {
		symbol,
		side: position.side,
		size: position.size,
		avgEntryPrice: position.avgEntryPrice,
		realizedPnl: position.realizedPnl,
		stopLossPrice: position.stopLossPrice,
		takeProfitPrice: position.takeProfitPrice,
		entryPrice: position.entryPrice,
		peakPrice: position.peakPrice,
		troughPrice: position.troughPrice,
		trailingStopPrice: position.trailingStopPrice,
		isTrailingActive: position.isTrailingActive,
	});
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

const logAndSnapshotPosition = (
	executionEngine: ExecutionEngine,
	symbol: string,
	price: number,
	timestamp: number
): PaperAccountSnapshot | null => {
	const latestPosition = executionEngine.getPosition(symbol);
	logPaperPosition(symbol, latestPosition);
	return snapshotPaperAccount(
		executionEngine,
		calculateUnrealizedPnl(latestPosition, price),
		symbol,
		timestamp
	);
};

const logPaperAccountSnapshot = (
	symbol: string,
	timestamp: number,
	snapshot: PaperAccountSnapshot
): void => {
	logger.info("paper_account_snapshot", {
		symbol,
		timestamp: new Date(timestamp).toISOString(),
		snapshot,
	});
};

const calculateUnrealizedPnl = (
	position: PaperPositionSnapshot,
	price: number
): number => {
	if (position.avgEntryPrice === null || position.size <= 0) {
		return 0;
	}
	if (position.side === "LONG") {
		return (price - position.avgEntryPrice) * position.size;
	}
	if (position.side === "SHORT") {
		return (position.avgEntryPrice - price) * position.size;
	}
	return 0;
};

const enrichIntentMetadata = (intent: TradeIntent): TradeIntent => {
	if (intent.action && intent.positionSide && intent.side) {
		return intent;
	}
	switch (intent.intent) {
		case "OPEN_LONG":
			return {
				...intent,
				action: intent.action ?? "OPEN",
				positionSide: intent.positionSide ?? "LONG",
				side: intent.side ?? "buy",
			};
		case "CLOSE_LONG":
			return {
				...intent,
				action: intent.action ?? "CLOSE",
				positionSide: intent.positionSide ?? "LONG",
				side: intent.side ?? "sell",
			};
		case "OPEN_SHORT":
			return {
				...intent,
				action: intent.action ?? "OPEN",
				positionSide: intent.positionSide ?? "SHORT",
				side: intent.side ?? "sell",
			};
		case "CLOSE_SHORT":
			return {
				...intent,
				action: intent.action ?? "CLOSE",
				positionSide: intent.positionSide ?? "SHORT",
				side: intent.side ?? "buy",
			};
		default:
			return intent;
	}
};

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
