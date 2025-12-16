import type { StrategyRegistryEntry } from "@agenai/core";
import {
	AccountConfig,
	AgenaiConfig,
	Candle,
	PositionSide,
	StrategyConfig,
	StrategyId,
	TradeIntent,
	getStrategyDefinition,
} from "@agenai/core";
import {
	DefaultDataProvider,
	type DataProvider,
	type HistoricalSeriesRequest,
	type TimeframeSeries,
} from "@agenai/data";
import { MexcClient } from "@agenai/exchange-mexc";
import {
	ExecutionEngine,
	ExecutionResult,
	PaperAccount,
	PaperAccountSnapshot,
	PaperPositionSnapshot,
} from "@agenai/execution-engine";
import { RiskManager, TradePlan } from "@agenai/risk-engine";
import {
	StrategySource,
	calculateUnrealizedPnl,
	enrichIntentMetadata,
	getPreExecutionSkipReason,
	logAndSnapshotPosition,
	logExecutionError,
	logExecutionResult,
	logExecutionSkipped,
	logPaperPosition,
	logRiskConfig,
	logStrategyDecision,
	logStrategyLoaded,
	logStrategyRuntimeMetadata,
	logTimeframeFingerprint,
	logTradePlan,
	maybeHandleForcedExit,
	maybeHandleTrailingStop,
	runtimeLogger,
	snapshotPaperAccount,
	ExecutionHook,
	withRuntimeFingerprints,
} from "../runtimeShared";
import type { TraderStrategy } from "../types";
import { WarmupMap } from "../runtimeFactory";
import type { LoadedRuntimeConfig } from "../loadRuntimeConfig";
import {
	createRuntimeSnapshot,
	createRuntime,
	type RuntimeSnapshot,
} from "../runtimeSnapshot";
import { BacktestTimeframeCache } from "./BacktestTimeframeCache";
import {
	BacktestConfig,
	BacktestResolvedConfig,
	BacktestResult,
	BacktestTrade,
} from "./backtestTypes";
import { buildRuntimeFingerprintLogPayload } from "../runtimeFingerprint";

export interface RunBacktestOptions {
	runtimeSnapshot?: RuntimeSnapshot;
	runtimeConfig?: LoadedRuntimeConfig;
	agenaiConfig?: AgenaiConfig;
	accountConfig?: AccountConfig;
	accountProfile?: string;
	configDir?: string;
	envPath?: string;
	exchangeProfile?: string;
	strategyProfile?: string;
	riskProfile?: string;
	strategyOverride?: TraderStrategy;
	client?: MexcClient;
	dataProvider?: DataProvider;
	timeframeData?: Record<string, Candle[]>;
}

export const runBacktest = async (
	backtestConfig: BacktestConfig,
	options: RunBacktestOptions = {}
): Promise<BacktestResult> => {
	if (backtestConfig.startTimestamp >= backtestConfig.endTimestamp) {
		throw new Error("Backtest startTimestamp must be before endTimestamp");
	}

	const runtimeSnapshot =
		options.runtimeSnapshot ??
		createRuntimeSnapshot({
			runtimeConfig: options.runtimeConfig,
			agenaiConfig: options.agenaiConfig,
			accountConfig: options.accountConfig,
			accountProfile: options.accountProfile,
			configDir: options.configDir,
			envPath: options.envPath,
			exchangeProfile: options.exchangeProfile,
			strategyProfile: options.strategyProfile,
			riskProfile: options.riskProfile,
			requestedStrategyId: backtestConfig.strategyId,
			instrument: {
				symbol: backtestConfig.symbol,
				timeframe: backtestConfig.timeframe,
			},
			maxCandlesOverride: backtestConfig.maxCandles,
		});

	runtimeSnapshot.config.selection.invalidSources.forEach(({ source, value }) =>
		runtimeLogger.warn("backtest_strategy_invalid", { source, value })
	);

	const runtimeBootstrap = runtimeSnapshot.config;
	const runtimeFingerprints = {
		strategyConfigFingerprint: runtimeSnapshot.strategyConfigFingerprint,
		runtimeContextFingerprint: runtimeSnapshot.runtimeContextFingerprint,
	};

	const agenaiConfig = runtimeBootstrap.agenaiConfig;
	const resolvedStrategyId = runtimeBootstrap.strategyId;
	const runtimeMetadata = runtimeSnapshot.metadata;
	const { runtimeParams, trackedTimeframes, warmupByTimeframe, cacheLimit } =
		runtimeMetadata;
	const symbol = runtimeParams.symbol;
	const timeframe = runtimeParams.executionTimeframe;
	const effectiveConfig: BacktestResolvedConfig = {
		...backtestConfig,
		symbol,
		timeframe,
		strategyId: resolvedStrategyId,
	};
	const profileMetadata = runtimeBootstrap.profiles;

	const accountConfig = runtimeBootstrap.accountConfig;

	const client =
		options.client ??
		new MexcClient({
			apiKey: agenaiConfig.exchange.credentials.apiKey,
			secret: agenaiConfig.exchange.credentials.apiSecret,
			useFutures: true,
		});

	const dataProvider =
		options.dataProvider ?? new DefaultDataProvider({ client });

	const riskManager = new RiskManager(agenaiConfig.risk);
	const initialBalance =
		effectiveConfig.initialBalance ?? accountConfig.startingBalance ?? 1000;
	const paperAccount = new PaperAccount(initialBalance);
	const executionEngine = new ExecutionEngine({
		client,
		mode: "paper",
		paperAccount,
	});

	runtimeLogger.info("backtest_config", {
		symbol,
		timeframe,
		startTimestamp: new Date(effectiveConfig.startTimestamp).toISOString(),
		endTimestamp: new Date(effectiveConfig.endTimestamp).toISOString(),
		strategyId: resolvedStrategyId,
		maxCandles: effectiveConfig.maxCandles ?? null,
		initialBalance,
	});

	const timeframeSeries: TimeframeSeries[] = options.timeframeData
		? buildProvidedSeries(options.timeframeData, trackedTimeframes)
		: await loadTimeframeSeries(
				dataProvider,
				effectiveConfig,
				trackedTimeframes,
				warmupByTimeframe,
				symbol,
				timeframe
			);
	const timeframeLabel = options.timeframeData
		? "provided_series"
		: "historical_load";
	for (const series of timeframeSeries) {
		logTimeframeFingerprint({
			mode: "backtest",
			label: timeframeLabel,
			symbol,
			timeframe: series.timeframe,
			candles: series.candles,
			warmupCandles: warmupByTimeframe.get(series.timeframe) ?? 0,
		});
	}

	const cache = new BacktestTimeframeCache({
		timeframes: trackedTimeframes,
		limit: cacheLimit,
	});
	primeCacheWithWarmup(timeframeSeries, cache, effectiveConfig.startTimestamp);

	const executionSeries = timeframeSeries.find(
		(series) => series.timeframe === timeframe
	);
	if (!executionSeries || executionSeries.candles.length === 0) {
		throw new Error("No candles loaded for execution timeframe");
	}

	const runtime = await createRuntime(runtimeSnapshot, {
		strategyOverride: options.strategyOverride,
		builder: async () => createBacktestStrategy(agenaiConfig.strategy, cache),
		builderName: options.strategyOverride ? undefined : "backtest_strategy",
	});
	const { strategy, source: strategySource } = runtime;
	logStrategyRuntimeMetadata({
		mode: "backtest",
		strategyId: resolvedStrategyId,
		strategyConfig: agenaiConfig.strategy,
		fingerprints: runtimeFingerprints,
		metadata: runtimeMetadata,
		source: strategySource,
		builderName: runtime.builderName,
		profiles: profileMetadata,
		extra: {
			window: {
				startTimestamp: effectiveConfig.startTimestamp,
				endTimestamp: effectiveConfig.endTimestamp,
			},
			symbol,
			timeframe,
			maxCandles: effectiveConfig.maxCandles ?? null,
		},
	});
	runtimeLogger.info("runtime_fingerprints", {
		mode: "backtest",
		strategyId: resolvedStrategyId,
		...buildRuntimeFingerprintLogPayload(runtimeSnapshot),
	});

	logStrategyLoaded({
		source: strategySource,
		strategy,
		strategyConfig: options.strategyOverride
			? undefined
			: agenaiConfig.strategy,
		strategyId: resolvedStrategyId,
		traderConfig: {
			symbol,
			timeframe,
			useTestnet: effectiveConfig.useTestnet ?? false,
		},
		executionMode: "paper",
		builderName: runtime.builderName,
		profiles: profileMetadata,
		pollIntervalMs: 0,
	});
	logRiskConfig(agenaiConfig.risk);

	const indexByTimeframe = new Map<string, number>();
	for (const tf of trackedTimeframes) {
		indexByTimeframe.set(tf, 0);
	}

	const trades: BacktestTrade[] = [];
	const equitySnapshots: PaperAccountSnapshot[] = [];
	let fallbackEquity = initialBalance;

	for (const candle of executionSeries.candles) {
		updateCacheUntilTimestamp(
			timeframeSeries,
			cache,
			indexByTimeframe,
			candle.timestamp
		);

		const buffer = await cache.getCandles(timeframe);
		if (!buffer.length) {
			continue;
		}

		const positionState = executionEngine.getPosition(symbol);
		const unrealizedPnl = calculateUnrealizedPnl(positionState, candle.close);
		const prePlanSnapshot = executionEngine.snapshotPaperAccount(unrealizedPnl);
		const accountEquity = prePlanSnapshot?.equity ?? fallbackEquity;

		const recordHook = createExecutionRecorder(trades, candle, positionState);

		const forcedExitHandled = await maybeHandleForcedExit(
			positionState,
			candle,
			riskManager,
			executionEngine,
			accountEquity,
			recordHook,
			runtimeFingerprints
		);
		if (forcedExitHandled) {
			const accountSnapshot = logAndSnapshotPosition(
				executionEngine,
				symbol,
				candle.close,
				candle.timestamp
			);
			if (accountSnapshot) {
				fallbackEquity = accountSnapshot.equity;
				equitySnapshots.push(accountSnapshot);
			}
			continue;
		}

		const trailingExitHandled = await maybeHandleTrailingStop(
			symbol,
			positionState,
			candle,
			riskManager,
			executionEngine,
			accountEquity,
			agenaiConfig.risk,
			recordHook,
			runtimeFingerprints
		);
		if (trailingExitHandled) {
			const accountSnapshot = logAndSnapshotPosition(
				executionEngine,
				symbol,
				candle.close,
				candle.timestamp
			);
			if (accountSnapshot) {
				fallbackEquity = accountSnapshot.equity;
				equitySnapshots.push(accountSnapshot);
			}
			continue;
		}

		const intent = enrichIntentMetadata(
			await strategy.decide(buffer, positionState.side)
		);
		const fingerprintedIntent = withRuntimeFingerprints(
			intent,
			runtimeFingerprints
		);
		logStrategyDecision(candle, fingerprintedIntent, runtimeFingerprints);

		const plan = riskManager.plan(
			fingerprintedIntent,
			candle.close,
			accountEquity,
			positionState
		);

		if (!plan) {
			if (fingerprintedIntent.intent !== "NO_ACTION") {
				const reason =
					fingerprintedIntent.intent === "CLOSE_LONG" ||
					fingerprintedIntent.intent === "CLOSE_SHORT"
						? "no_position_to_close"
						: "risk_plan_rejected";
				logExecutionSkipped(fingerprintedIntent, positionState.side, reason);
			}
		} else {
			const skipReason = getPreExecutionSkipReason(plan, positionState);
			if (skipReason) {
				logExecutionSkipped(plan, positionState.side, skipReason);
			} else {
				logTradePlan(plan, candle, fingerprintedIntent);
				try {
					const result = await executionEngine.execute(plan, {
						price: candle.close,
					});
					if (result.status === "skipped") {
						logExecutionSkipped(
							plan,
							positionState.side,
							result.reason ?? "execution_engine_skip"
						);
					} else {
						logExecutionResult(result);
						recordTrade(trades, plan, result, candle, positionState);
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
			calculateUnrealizedPnl(latestPosition, candle.close),
			symbol,
			candle.timestamp
		);
		if (accountSnapshot) {
			fallbackEquity = accountSnapshot.equity;
			equitySnapshots.push(accountSnapshot);
		}
	}

	const completedTrades = trades.filter(
		(trade) => trade.action === "CLOSE"
	).length;
	runtimeLogger.info("backtest_summary", {
		symbol,
		timeframe,
		totalCandles: executionSeries.candles.length,
		totalTrades: completedTrades,
		totalExecutions: trades.length,
		finalEquity:
			equitySnapshots[equitySnapshots.length - 1]?.equity ?? fallbackEquity,
	});

	return {
		config: effectiveConfig,
		trades,
		equitySnapshots,
	};
};

const primeCacheWithWarmup = (
	series: TimeframeSeries[],
	cache: BacktestTimeframeCache,
	startTimestamp: number
): void => {
	for (const frame of series) {
		if (!frame.candles.length) {
			continue;
		}
		let partition = 0;
		while (
			partition < frame.candles.length &&
			frame.candles[partition].timestamp < startTimestamp
		) {
			partition += 1;
		}
		if (partition > 0) {
			cache.setCandles(frame.timeframe, frame.candles.slice(0, partition));
			frame.candles = frame.candles.slice(partition);
		}
	}
};

const loadTimeframeSeries = async (
	dataProvider: DataProvider,
	backtestConfig: BacktestConfig,
	timeframes: string[],
	warmupByTimeframe: WarmupMap,
	symbol: string,
	executionTimeframe: string
): Promise<TimeframeSeries[]> => {
	const request: HistoricalSeriesRequest = {
		symbol,
		startTimestamp: backtestConfig.startTimestamp,
		endTimestamp: backtestConfig.endTimestamp,
		requests: timeframes.map((timeframe) => ({
			timeframe,
			warmup: warmupByTimeframe.get(timeframe) ?? 0,
			limit:
				timeframe === executionTimeframe &&
				typeof backtestConfig.maxCandles === "number"
					? backtestConfig.maxCandles
					: undefined,
		})),
	};

	const series = await dataProvider.loadHistoricalSeries(request);
	for (const frame of series) {
		runtimeLogger.info("backtest_timeframe_loaded", {
			timeframe: frame.timeframe,
			candles: frame.candles.length,
			warmupCandles: warmupByTimeframe.get(frame.timeframe) ?? 0,
		});
	}
	return series;
};

const buildProvidedSeries = (
	data: Record<string, Candle[]>,
	timeframes: string[]
): TimeframeSeries[] => {
	return timeframes.map((timeframe) => {
		const candles = data[timeframe] ?? [];
		runtimeLogger.info("backtest_timeframe_loaded", {
			timeframe,
			candles: candles.length,
			source: "provided",
		});
		return { timeframe, candles: [...candles] };
	});
};

const updateCacheUntilTimestamp = (
	series: TimeframeSeries[],
	cache: BacktestTimeframeCache,
	indices: Map<string, number>,
	timestamp: number
): void => {
	for (const frame of series) {
		let pointer = indices.get(frame.timeframe) ?? 0;
		const pending: Candle[] = [];
		while (
			pointer < frame.candles.length &&
			frame.candles[pointer].timestamp <= timestamp
		) {
			pending.push(frame.candles[pointer]);
			pointer += 1;
		}
		if (pending.length) {
			cache.appendCandles(frame.timeframe, pending);
		}
		indices.set(frame.timeframe, pointer);
	}
};

const createBacktestStrategy = async (
	strategyConfig: StrategyConfig,
	cache: BacktestTimeframeCache
): Promise<TraderStrategy> => {
	const entry = getStrategyDefinition(strategyConfig.id);
	const dependencies = buildBacktestDependencies(entry, strategyConfig, cache);
	const strategyInstance = entry.createStrategy(
		strategyConfig as unknown,
		dependencies
	) as CacheDrivenStrategy;
	if (entry.dependencies?.warmup) {
		await entry.dependencies.warmup(strategyConfig as unknown, dependencies);
	}
	return createCacheDrivenAdapter(strategyInstance);
};

const buildBacktestDependencies = <TConfig, TDeps, TStrategy>(
	entry: StrategyRegistryEntry<TConfig, TDeps, TStrategy>,
	strategyConfig: StrategyConfig,
	cache: BacktestTimeframeCache
): TDeps => {
	const maybeBacktestDeps = (
		entry.dependencies as {
			buildBacktestDeps?: (
				config: TConfig,
				options: { cache: BacktestTimeframeCache }
			) => TDeps;
		}
	)?.buildBacktestDeps;
	if (maybeBacktestDeps) {
		return maybeBacktestDeps(strategyConfig as TConfig, { cache });
	}
	if (entry.dependencies?.createCache) {
		return { cache } as TDeps;
	}
	return {} as TDeps;
};

type CacheDrivenStrategy = {
	decide: (position: PositionSide) => Promise<TradeIntent>;
};

const createCacheDrivenAdapter = (
	strategy: CacheDrivenStrategy
): TraderStrategy => {
	return {
		decide: (_candles: Candle[], position: PositionSide) =>
			strategy.decide(position),
	};
};

const createExecutionRecorder = (
	trades: BacktestTrade[],
	candle: Candle,
	priorPosition: PaperPositionSnapshot
): ExecutionHook => {
	return (plan, result) => {
		if (result.status === "skipped") {
			return;
		}
		recordTrade(trades, plan, result, candle, priorPosition);
	};
};

const recordTrade = (
	trades: BacktestTrade[],
	plan: TradePlan,
	result: ExecutionResult,
	candle: Candle,
	priorPosition: PaperPositionSnapshot
): void => {
	const trade: BacktestTrade = {
		symbol: plan.symbol,
		action: plan.action,
		side: plan.positionSide,
		quantity: result.quantity,
		entryPrice:
			plan.action === "OPEN"
				? (result.price ?? candle.close)
				: (priorPosition.avgEntryPrice ?? result.price ?? candle.close),
		exitPrice:
			plan.action === "CLOSE" ? (result.price ?? candle.close) : undefined,
		realizedPnl: plan.action === "CLOSE" ? result.realizedPnl : undefined,
		timestamp: candle.timestamp,
	};
	trades.push(trade);
};
