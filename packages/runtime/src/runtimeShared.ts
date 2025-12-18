import {
	Candle,
	PositionSide,
	RiskConfig,
	StrategyConfig,
	StrategyId,
	TradeIntent,
	createLogger,
	summarizeCandles,
} from "@agenai/core";
import {
	ExecutionResult,
	PaperAccountSnapshot,
	PaperPositionSnapshot,
} from "@agenai/execution-engine";
import { RiskManager, TradePlan } from "@agenai/risk-engine";
import type { TraderStrategy } from "./types";
import type { StrategyRuntimeMetadata } from "./runtimeFactory";
import type { StrategyRuntimeFingerprints } from "./fingerprints";
import type { ExecutionProvider } from "./execution/executionProvider";

export const runtimeLogger = createLogger("trader-runtime");

export type ExecutionHook = (
	plan: TradePlan,
	result: ExecutionResult,
	candle: Candle
) => void;

export type StrategySource = "override" | "builder";

export interface StrategyLogContext {
	source: StrategySource;
	strategy: TraderStrategy;
	strategyConfig?: StrategyConfig;
	strategyId: StrategyId;
	traderConfig: {
		symbol: string;
		timeframe: string;
		useTestnet: boolean;
	};
	executionMode: string;
	pollIntervalMs: number;
	builderName?: string;
	profiles?: {
		account?: string;
		strategy?: string;
		risk?: string;
		exchange?: string;
	};
}

export type StrategyRuntimeMode = "backtest" | "paper" | "live";

export interface StrategyRuntimeLogContext {
	mode: StrategyRuntimeMode;
	strategyId: StrategyId;
	strategyConfig: StrategyConfig;
	fingerprints: StrategyRuntimeFingerprints;
	metadata: StrategyRuntimeMetadata;
	source: StrategySource;
	builderName?: string;
	profiles?: StrategyLogContext["profiles"];
	extra?: Record<string, unknown>;
}

export const logStrategyRuntimeMetadata = (
	context: StrategyRuntimeLogContext
): void => {
	const warmupEntries = Array.from(
		context.metadata.warmupByTimeframe.entries()
	).map(([timeframe, candles]) => ({ timeframe, candles }));
	runtimeLogger.info("strategy_runtime_metadata", {
		mode: context.mode,
		strategyId: context.strategyId,
		strategyConfigFingerprint: context.fingerprints.strategyConfigFingerprint,
		runtimeContextFingerprint: context.fingerprints.runtimeContextFingerprint,
		execution: context.metadata.runtimeParams,
		trackedTimeframes: context.metadata.trackedTimeframes,
		warmupByTimeframe: warmupEntries,
		cacheLimit: context.metadata.cacheLimit,
		source: context.source,
		builderName: context.builderName ?? null,
		profiles: context.profiles ?? null,
		extra: context.extra ?? null,
	});
};

export interface TimeframeFingerprintContext {
	mode: StrategyRuntimeMode;
	label: string;
	symbol: string;
	timeframe: string;
	candles: Candle[];
	warmupCandles?: number;
	windowMs?: number;
}

export const logTimeframeFingerprint = (
	context: TimeframeFingerprintContext
): void => {
	const summary = summarizeCandles(context.candles, 20);
	runtimeLogger.info("timeframe_fingerprint", {
		mode: context.mode,
		label: context.label,
		symbol: context.symbol,
		timeframe: context.timeframe,
		warmupCandles: context.warmupCandles ?? null,
		windowMs: context.windowMs ?? null,
		candleCount: summary.count,
		firstTimestamp: summary.firstTimestamp
			? new Date(summary.firstTimestamp).toISOString()
			: null,
		lastTimestamp: summary.lastTimestamp
			? new Date(summary.lastTimestamp).toISOString()
			: null,
		headHash: summary.headHash,
		tailHash: summary.tailHash,
	});
};

export const logStrategyLoaded = ({
	source,
	strategy,
	strategyConfig,
	strategyId,
	traderConfig,
	executionMode,
	builderName,
	profiles,
	pollIntervalMs,
}: StrategyLogContext): void => {
	runtimeLogger.info("strategy_loaded", {
		source,
		strategyId,
		strategyClass: getStrategyName(strategy),
		symbol: traderConfig.symbol,
		timeframe: traderConfig.timeframe,
		executionMode,
		useTestnet: traderConfig.useTestnet,
		pollIntervalMs,
		builder: builderName ?? null,
		profiles: profiles ?? null,
		configId: strategyConfig?.id ?? null,
	});
};

const getStrategyName = (strategy: TraderStrategy): string => {
	const ctorName =
		(strategy as { constructor?: { name?: string } })?.constructor?.name ??
		"AnonymousStrategy";
	return ctorName === "Object" ? "AnonymousStrategy" : ctorName;
};

export const logRiskConfig = (risk: RiskConfig): void => {
	runtimeLogger.info("risk_config", {
		riskPerTradePercent: risk.riskPerTradePercent,
		minPositionSize: risk.minPositionSize,
		maxPositionSize: risk.maxPositionSize,
		slPct: risk.slPct,
		tpPct: risk.tpPct,
		trailingActivationPct: risk.trailingActivationPct,
		trailingTrailPct: risk.trailingTrailPct,
	});
};

export const withRuntimeFingerprints = (
	intent: TradeIntent,
	fingerprints?: StrategyRuntimeFingerprints
): TradeIntent => {
	if (!fingerprints) {
		return intent;
	}
	return {
		...intent,
		metadata: {
			...(intent.metadata ?? {}),
			strategyConfigFingerprint: fingerprints.strategyConfigFingerprint,
			runtimeContextFingerprint: fingerprints.runtimeContextFingerprint,
		},
	};
};

export const logStrategyDecision = (
	candle: Candle,
	intent: TradeIntent,
	fingerprints?: StrategyRuntimeFingerprints
): void => {
	const payload: Record<string, unknown> = {
		symbol: candle.symbol,
		timeframe: candle.timeframe,
		timestamp: new Date(candle.timestamp).toISOString(),
		close: candle.close,
		intent: intent.intent,
		reason: intent.reason,
	};
	const fingerprintContext = fingerprints ?? readDecisionFingerprints(intent);
	if (fingerprintContext) {
		payload.strategyConfigFingerprint =
			fingerprintContext.strategyConfigFingerprint ?? null;
		payload.runtimeContextFingerprint =
			fingerprintContext.runtimeContextFingerprint ?? null;
	}
	const decisionContext = extractDecisionContext(intent);
	if (decisionContext) {
		payload.decisionContext = decisionContext;
	}
	runtimeLogger.info("strategy_decision", payload);
};

const readDecisionFingerprints = (
	intent: TradeIntent
): StrategyRuntimeFingerprints | null => {
	const configValue = readIntentFingerprint(
		intent,
		"strategyConfigFingerprint"
	);
	const runtimeValue = readIntentFingerprint(
		intent,
		"runtimeContextFingerprint"
	);
	if (!configValue || !runtimeValue) {
		return null;
	}
	return {
		strategyConfigFingerprint: configValue,
		runtimeContextFingerprint: runtimeValue,
	};
};

const readIntentFingerprint = (
	intent: TradeIntent,
	key: string
): string | null => {
	const metadata = intent.metadata as Record<string, unknown> | undefined;
	const value = metadata?.[key];
	return typeof value === "string" && value.length ? value : null;
};

const extractDecisionContext = (
	intent: TradeIntent
): Record<string, unknown> | null => {
	if (intent.intent !== "NO_ACTION") {
		return null;
	}
	const context = intent.metadata?.decisionContext as unknown;
	if (!context || typeof context !== "object") {
		return null;
	}
	return context as Record<string, unknown>;
};

export const logTradePlan = (
	plan: TradePlan,
	candle: Candle,
	intent: TradeIntent
): void => {
	runtimeLogger.info("trade_plan", {
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

export const logExecutionResult = (result: ExecutionResult): void => {
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

	runtimeLogger.info(eventName, payload);
};

export const logExecutionError = (error: unknown, plan: TradePlan): void => {
	runtimeLogger.error("execution_error", {
		symbol: plan.symbol,
		side: plan.side,
		action: plan.action,
		positionSide: plan.positionSide,
		quantity: plan.quantity,
		message: error instanceof Error ? error.message : String(error),
	});
};

export const logMarketDataError = (error: unknown): void => {
	runtimeLogger.error("market_data_error", {
		message: error instanceof Error ? error.message : String(error),
	});
};

export const logExecutionSkipped = (
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
	runtimeLogger.info("execution_skipped", payload);
};

export const getPreExecutionSkipReason = (
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

export const logPaperPosition = (
	symbol: string,
	position: PaperPositionSnapshot
): void => {
	runtimeLogger.info("paper_position", {
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

export const logPaperAccountSnapshot = (
	symbol: string,
	timestamp: number,
	snapshot: PaperAccountSnapshot
): void => {
	runtimeLogger.info("paper_account_snapshot", {
		symbol,
		timestamp: new Date(timestamp).toISOString(),
		snapshot,
	});
};

export const snapshotPaperAccount = (
	executionProvider: ExecutionProvider,
	unrealizedPnl: number,
	symbol: string,
	timestamp: number
): PaperAccountSnapshot | null => {
	const snapshot = executionProvider.snapshotAccount(unrealizedPnl);
	if (!snapshot) {
		return null;
	}

	logPaperAccountSnapshot(symbol, timestamp, snapshot);
	return snapshot;
};

export const logAndSnapshotPosition = (
	executionProvider: ExecutionProvider,
	symbol: string,
	price: number,
	timestamp: number
): PaperAccountSnapshot | null => {
	const latestPosition = executionProvider.getPosition(symbol);
	logPaperPosition(symbol, latestPosition);
	return snapshotPaperAccount(
		executionProvider,
		calculateUnrealizedPnl(latestPosition, price),
		symbol,
		timestamp
	);
};

export const calculateUnrealizedPnl = (
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

export const enrichIntentMetadata = (intent: TradeIntent): TradeIntent => {
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

export const maybeHandleForcedExit = async (
	positionState: PaperPositionSnapshot,
	lastCandle: Candle,
	riskManager: RiskManager,
	executionProvider: ExecutionProvider,
	accountEquity: number,
	onExecuted?: ExecutionHook,
	fingerprints?: StrategyRuntimeFingerprints
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
	const fingerprintedIntent = withRuntimeFingerprints(
		forcedIntent,
		fingerprints
	);

	logStrategyDecision(lastCandle, fingerprintedIntent, fingerprints);

	const plan = riskManager.plan(
		fingerprintedIntent,
		lastCandle.close,
		accountEquity,
		positionState
	);
	if (!plan) {
		logExecutionSkipped(
			fingerprintedIntent,
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

	logTradePlan(plan, lastCandle, fingerprintedIntent);
	try {
		const result = await executionProvider.execute(plan, {
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
			onExecuted?.(plan, result, lastCandle);
		}
	} catch (error) {
		logExecutionError(error, plan);
	}

	return true;
};

export const maybeHandleTrailingStop = async (
	symbol: string,
	positionState: PaperPositionSnapshot,
	lastCandle: Candle,
	riskManager: RiskManager,
	executionProvider: ExecutionProvider,
	accountEquity: number,
	riskConfig: RiskConfig,
	onExecuted?: ExecutionHook,
	fingerprints?: StrategyRuntimeFingerprints
): Promise<boolean> => {
	if (positionState.side === "FLAT" || positionState.size <= 0) {
		return false;
	}

	const entryPrice =
		positionState.entryPrice > 0
			? positionState.entryPrice
			: (positionState.avgEntryPrice ?? 0);
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
			: (positionState.stopLossPrice ?? 0);
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
			executionProvider.updatePosition(symbol, updates);
		}
		return false;
	}

	let proposedTrailing = trailingStopPrice;
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
		executionProvider.updatePosition(symbol, updates);
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
	const fingerprintedIntent = withRuntimeFingerprints(
		forcedIntent,
		fingerprints
	);

	logStrategyDecision(lastCandle, fingerprintedIntent, fingerprints);

	const plan = riskManager.plan(
		fingerprintedIntent,
		lastCandle.close,
		accountEquity,
		positionState
	);
	if (!plan) {
		logExecutionSkipped(
			fingerprintedIntent,
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

	logTradePlan(plan, lastCandle, fingerprintedIntent);
	try {
		const result = await executionProvider.execute(plan, {
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
			onExecuted?.(plan, result, lastCandle);
		}
	} catch (error) {
		logExecutionError(error, plan);
	}

	return true;
};
