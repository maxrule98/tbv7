import { Candle, RiskConfig, TradeIntent } from "@agenai/core";
import {
	ExecutionResult,
	PaperAccountSnapshot,
} from "@agenai/execution-engine";
import { RiskManager, TradePlan } from "@agenai/risk-engine";
import {
	ExecutionHook,
	GuardedExitResult,
	calculateUnrealizedPnl,
	enrichIntentMetadata,
	getPreExecutionSkipReason,
	logAndSnapshotPosition,
	logExecutionError,
	logExecutionResult,
	logExecutionSkipped,
	logPaperPosition,
	logStrategyDecision,
	logTradePlan,
	maybeHandleForcedExit,
	maybeHandleTrailingStop,
	snapshotPaperAccount,
	withRuntimeFingerprints,
} from "../runtimeShared";
import type { StrategyRuntimeFingerprints } from "../fingerprints";
import type { StrategyDecisionContext, TraderStrategy } from "../types";
import type { ExecutionProvider } from "../execution/executionProvider";

export interface TickInput {
	candle: Candle;
	buffer: Candle[];
	strategy: TraderStrategy;
	riskManager: RiskManager;
	riskConfig: RiskConfig;
	executionProvider: ExecutionProvider;
	decisionContext: StrategyDecisionContext;
	symbol: string;
	accountEquityFallback: number;
	fingerprints: StrategyRuntimeFingerprints;
	recordHook?: ExecutionHook;
}

export interface TickResult {
	intent: TradeIntent;
	plan?: TradePlan | null;
	executionResult?: ExecutionResult | null;
	skipReason?: string;
	updatedEquity: number;
	accountSnapshot?: PaperAccountSnapshot | null;
	diagnostics: {
		forcedExit?: boolean;
		trailingStop?: boolean;
		planRejected?: boolean;
		preExecutionSkip?: boolean;
		executed?: boolean;
	};
}

const finalizeGuardedExit = (
	result: GuardedExitResult,
	context: {
		symbol: string;
		candle: Candle;
		executionProvider: ExecutionProvider;
		fallbackEquity: number;
		kind: "forced" | "trailing";
	}
): TickResult => {
	const accountSnapshot = logAndSnapshotPosition(
		context.executionProvider,
		context.symbol,
		context.candle.close,
		context.candle.timestamp
	);
	const updatedEquity = accountSnapshot?.equity ?? context.fallbackEquity;
	return {
		intent:
			result.intent ??
			({ intent: "NO_ACTION", reason: "guard_exit" } as TradeIntent),
		plan: result.plan ?? null,
		executionResult: result.executionResult ?? null,
		skipReason: result.skipReason,
		updatedEquity,
		accountSnapshot,
		diagnostics: {
			forcedExit: context.kind === "forced",
			trailingStop: context.kind === "trailing",
			planRejected: result.plan === null,
			preExecutionSkip: Boolean(result.skipReason),
			executed:
				Boolean(result.executionResult) &&
				result.executionResult?.status !== "skipped",
		},
	};
};

export const runTick = async (input: TickInput): Promise<TickResult> => {
	const positionState = input.executionProvider.getPosition(input.symbol);
	const unrealizedPnl = calculateUnrealizedPnl(
		positionState,
		input.candle.close
	);
	const prePlanSnapshot =
		input.executionProvider.snapshotAccount(unrealizedPnl);
	let fallbackEquity = prePlanSnapshot?.equity ?? input.accountEquityFallback;

	const forcedExit = await maybeHandleForcedExit(
		positionState,
		input.candle,
		input.riskManager,
		input.executionProvider,
		fallbackEquity,
		input.recordHook,
		input.fingerprints
	);
	if (forcedExit.handled) {
		return finalizeGuardedExit(forcedExit, {
			symbol: input.symbol,
			candle: input.candle,
			executionProvider: input.executionProvider,
			fallbackEquity,
			kind: "forced",
		});
	}

	const trailingExit = await maybeHandleTrailingStop(
		input.symbol,
		positionState,
		input.candle,
		input.riskManager,
		input.executionProvider,
		fallbackEquity,
		input.riskConfig,
		input.recordHook,
		input.fingerprints
	);
	if (trailingExit.handled) {
		return finalizeGuardedExit(trailingExit, {
			symbol: input.symbol,
			candle: input.candle,
			executionProvider: input.executionProvider,
			fallbackEquity,
			kind: "trailing",
		});
	}

	const intent = withRuntimeFingerprints(
		enrichIntentMetadata(
			await input.strategy.decide(
				input.buffer,
				positionState.side,
				input.decisionContext
			)
		),
		input.fingerprints
	);
	logStrategyDecision(input.candle, intent, input.fingerprints);

	const plan = input.riskManager.plan(
		intent,
		input.candle.close,
		fallbackEquity,
		positionState
	);
	if (!plan) {
		let skipReason: string | undefined;
		if (intent.intent !== "NO_ACTION") {
			skipReason =
				intent.intent === "CLOSE_LONG" || intent.intent === "CLOSE_SHORT"
					? "no_position_to_close"
					: "risk_plan_rejected";
			logExecutionSkipped(intent, positionState.side, skipReason);
		}
		return {
			intent,
			plan: null,
			updatedEquity: fallbackEquity,
			skipReason,
			accountSnapshot: prePlanSnapshot ?? null,
			diagnostics: {
				planRejected: true,
				preExecutionSkip: Boolean(skipReason),
			},
		};
	}

	const skipReason = getPreExecutionSkipReason(plan, positionState);
	if (skipReason) {
		logExecutionSkipped(plan, positionState.side, skipReason);
		return {
			intent,
			plan,
			skipReason,
			updatedEquity: fallbackEquity,
			accountSnapshot: prePlanSnapshot ?? null,
			diagnostics: {
				preExecutionSkip: true,
			},
		};
	}

	logTradePlan(plan, input.candle, intent);
	let executionResult: ExecutionResult | null = null;
	try {
		executionResult = await input.executionProvider.execute(plan, {
			price: input.candle.close,
		});
		if (executionResult.status === "skipped") {
			logExecutionSkipped(
				plan,
				positionState.side,
				executionResult.reason ?? "execution_engine_skip"
			);
		} else {
			logExecutionResult(executionResult);
			input.recordHook?.(plan, executionResult, input.candle);
		}
	} catch (error) {
		logExecutionError(error, plan);
	}

	const latestPosition = input.executionProvider.getPosition(input.symbol);
	logPaperPosition(input.symbol, latestPosition);
	const accountSnapshot = snapshotPaperAccount(
		input.executionProvider,
		calculateUnrealizedPnl(latestPosition, input.candle.close),
		input.symbol,
		input.candle.timestamp
	);
	if (accountSnapshot) {
		fallbackEquity = accountSnapshot.equity;
	}

	return {
		intent,
		plan,
		executionResult,
		updatedEquity: fallbackEquity,
		accountSnapshot: accountSnapshot ?? null,
		diagnostics: {
			executed:
				Boolean(executionResult) && executionResult?.status !== "skipped",
		},
	};
};
