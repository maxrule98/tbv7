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
	loadAccountConfig,
	loadAgenaiConfig,
	loadStrategyConfig,
	resolveStrategyProfileName,
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
	logTradePlan,
	maybeHandleForcedExit,
	maybeHandleTrailingStop,
	runtimeLogger,
	snapshotPaperAccount,
	ExecutionHook,
} from "../runtimeShared";
import type { TraderStrategy } from "../types";
import {
	WarmupMap,
	createStrategyRuntime,
	resolveStrategyRuntimeMetadata,
} from "../runtimeFactory";
import { BacktestTimeframeCache } from "./BacktestTimeframeCache";
import {
	BacktestConfig,
	BacktestResolvedConfig,
	BacktestResult,
	BacktestTrade,
} from "./backtestTypes";

export interface RunBacktestOptions {
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

	const agenaiConfig =
		options.agenaiConfig ??
		loadAgenaiConfig({
			envPath: options.envPath,
			configDir: options.configDir,
			exchangeProfile: options.exchangeProfile,
			strategyProfile: options.strategyProfile,
			riskProfile: options.riskProfile,
		});

	const resolvedStrategyId =
		backtestConfig.strategyId ?? agenaiConfig.strategy.id;
	const strategyProfileForLoad = resolveStrategyProfileName(
		resolvedStrategyId,
		options.strategyProfile
	);

	if (agenaiConfig.strategy.id !== resolvedStrategyId) {
		runtimeLogger.warn("backtest_strategy_mismatch", {
			requestedStrategy: resolvedStrategyId,
			loadedStrategy: agenaiConfig.strategy.id,
		});
		const fallbackProfile = strategyProfileForLoad;
		try {
			const reloadedStrategy = loadStrategyConfig(
				options.configDir,
				fallbackProfile
			);
			if (reloadedStrategy.id !== resolvedStrategyId) {
				throw new Error(
					`profile ${fallbackProfile} resolved to ${reloadedStrategy.id}`
				);
			}
			agenaiConfig.strategy = reloadedStrategy;
			runtimeLogger.info("backtest_strategy_config_reloaded", {
				requestedStrategy: resolvedStrategyId,
				reloadedProfile: fallbackProfile,
				configDir: options.configDir ?? null,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "unknown_error";
			throw new Error(
				`Failed to load config for strategy ${resolvedStrategyId}. ` +
					`Provide a matching --strategyProfile or ensure config exists. (${message})`
			);
		}
	}

	const runtimeMetadata = resolveStrategyRuntimeMetadata(
		agenaiConfig.strategy,
		{
			instrument: {
				symbol: backtestConfig.symbol,
				timeframe: backtestConfig.timeframe,
			},
			maxCandlesOverride: backtestConfig.maxCandles,
		}
	);
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

	const accountConfig =
		options.accountConfig ??
		loadAccountConfig(options.configDir, options.accountProfile ?? "paper");

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

	const runtime = await createStrategyRuntime({
		strategyConfig: agenaiConfig.strategy,
		strategyOverride: options.strategyOverride,
		builder: async () => createBacktestStrategy(agenaiConfig.strategy, cache),
		metadata: runtimeMetadata,
		builderName: options.strategyOverride ? undefined : "backtest_strategy",
	});
	const { strategy, source: strategySource } = runtime;

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
		profiles: {
			account: options.accountProfile,
			strategy: strategyProfileForLoad,
			risk: options.riskProfile,
			exchange: options.exchangeProfile,
		},
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
			recordHook
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
			recordHook
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
		logStrategyDecision(candle, intent);

		const plan = riskManager.plan(
			intent,
			candle.close,
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
				logTradePlan(plan, candle, intent);
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

	runtimeLogger.info("backtest_summary", {
		symbol,
		timeframe,
		totalCandles: executionSeries.candles.length,
		totalTrades: trades.length,
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
