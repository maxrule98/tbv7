import type { StrategyRegistryEntry } from "@agenai/core";
import {
	AccountConfig,
	AgenaiConfig,
	Candle,
	CandleStore,
	PositionSide,
	StrategyConfig,
	StrategyId,
	TradeIntent,
	getStrategyDefinition,
	timeframeToMs,
} from "@agenai/core";
import type { ExecutionClient } from "@agenai/core";
import {
	DefaultDataProvider,
	type DataProvider,
	type HistoricalSeriesRequest,
	type MarketDataClient,
	type TimeframeSeries,
} from "@agenai/data";
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
	StrategyRuntimeMode,
	logRiskConfig,
	logStrategyLoaded,
	logStrategyRuntimeMetadata,
	logTimeframeFingerprint,
	runtimeLogger,
	ExecutionHook,
} from "../runtimeShared";
import type { StrategyDecisionContext, TraderStrategy } from "../types";
import { WarmupMap } from "../runtimeFactory";
import type { LoadedRuntimeConfig, VenueSelection } from "../loadRuntimeConfig";
import {
	createRuntimeSnapshot,
	createRuntime,
	type RuntimeSnapshot,
} from "../runtimeSnapshot";
import {
	BacktestConfig,
	BacktestResolvedConfig,
	BacktestResult,
	BacktestTrade,
	EquitySnapshot,
} from "./backtestTypes";
import { buildRuntimeFingerprintLogPayload } from "../runtimeFingerprint";
import type { ExecutionProvider } from "../execution/executionProvider";
import { runTick } from "../loop/runTick";
import { buildTickSnapshot } from "../loop/buildTickSnapshot";
import { BacktestBaseCandleSource } from "../marketData/BacktestBaseCandleSource";
import { MarketDataPlant } from "../marketData/MarketDataPlant";
import type { ClosedCandleEvent } from "../marketData/types";

class BacktestExecutionProvider implements ExecutionProvider {
	readonly venue = "backtest";
	readonly mode: StrategyRuntimeMode = "backtest";

	constructor(private readonly engine: ExecutionEngine) {}

	getPosition(symbol: string): PaperPositionSnapshot {
		return this.engine.getPosition(symbol);
	}

	updatePosition(
		symbol: string,
		updates: Partial<PaperPositionSnapshot>
	): void {
		this.engine.updatePosition(symbol, updates);
	}

	snapshotAccount(unrealizedPnl: number): PaperAccountSnapshot | null {
		return this.engine.snapshotPaperAccount(unrealizedPnl);
	}

	execute(
		plan: TradePlan,
		context: { price: number }
	): Promise<ExecutionResult> {
		return this.engine.execute(plan, context);
	}
}

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
	executionClient?: ExecutionClient;
	dataProvider?: DataProvider;
	marketDataClient?: MarketDataClient;
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
	const venues = runtimeBootstrap.venues;

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

	const executionClient = options.executionClient;
	const marketDataClient: MarketDataClient | undefined =
		options.marketDataClient;

	const dataProvider =
		options.dataProvider ??
		(marketDataClient
			? new DefaultDataProvider({ client: marketDataClient })
			: undefined);

	if (!executionClient) {
		throw new Error(
			"runBacktest requires executionClient (ExecutionClient interface) to be provided."
		);
	}

	if (!dataProvider && !options.timeframeData) {
		throw new Error(
			"runBacktest requires a dataProvider or timeframeData when no marketDataClient is supplied."
		);
	}

	const riskManager = new RiskManager(agenaiConfig.risk);
	const initialBalance =
		effectiveConfig.initialBalance ?? accountConfig.startingBalance ?? 1000;
	const paperAccount = new PaperAccount(initialBalance);
	const executionEngine = new ExecutionEngine({
		client: executionClient,
		mode: "paper",
		paperAccount,
	});
	const executionProvider = new BacktestExecutionProvider(executionEngine);

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
				dataProvider as DataProvider,
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

	// Calculate max candles per timeframe
	const maxCandlesByTimeframe: Record<string, number> = {};
	for (const tf of trackedTimeframes) {
		maxCandlesByTimeframe[tf] = cacheLimit;
	}

	const candleStore = new CandleStore({
		defaultMaxCandles: cacheLimit,
		maxCandlesByTimeframe,
	});
	primeCacheWithWarmup(
		timeframeSeries,
		candleStore,
		effectiveConfig.startTimestamp
	);

	const runtime = await createRuntime(runtimeSnapshot, {
		strategyOverride: options.strategyOverride,
		builder: async () =>
			createBacktestStrategy(agenaiConfig.strategy, candleStore),
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
	});
	logRiskConfig(agenaiConfig.risk);

	// Phase G: Plant-driven backtest architecture
	// Select base timeframe intelligently:
	// - If execution timeframe data is provided, use it (no unwanted aggregation)
	// - Otherwise, fallback to smallest interval among signal timeframes
	const executionSeries = timeframeSeries.find(
		(series) => series.timeframe === timeframe
	);
	const hasExecutionSeries =
		executionSeries && executionSeries.candles.length > 0;

	let baseTimeframe: string;
	let baseCandles: Candle[];
	let baseTimeframeReason: string;

	if (hasExecutionSeries) {
		// Use execution timeframe as base - ensures we tick on every execution candle
		baseTimeframe = timeframe;
		baseCandles = executionSeries.candles;
		baseTimeframeReason = "execution_timeframe_provided";
	} else {
		// Fallback to smallest timeframe (original logic)
		baseTimeframe = selectBaseTimeframe(trackedTimeframes);
		baseCandles =
			timeframeSeries.find((s) => s.timeframe === baseTimeframe)?.candles ?? [];
		baseTimeframeReason = "fallback_smallest_timeframe";
	}

	const baseTfMs = timeframeToMs(baseTimeframe);

	if (baseCandles.length === 0) {
		throw new Error(
			`No candles loaded for base timeframe ${baseTimeframe}. Cannot run backtest.`
		);
	}

	runtimeLogger.info("backtest_base_timeframe_selected", {
		baseTimeframe,
		executionTimeframe: timeframe,
		reason: baseTimeframeReason,
		baseCandleCount: baseCandles.length,
	});

	// Filter base candles to window - include candles UP TO endTimestamp
	const windowedBaseCandles = baseCandles.filter(
		(c) => c.timestamp <= effectiveConfig.endTimestamp
	);

	// Pre-populate store with HIGHER timeframe data (not base TF) for warmup/history
	// Base timeframe will be populated incrementally by Plant to maintain runtime parity
	runtimeLogger.info("backtest_prepopulating_store", {
		timeframes: timeframeSeries
			.filter((s) => s.timeframe !== baseTimeframe)
			.map((s) => ({ tf: s.timeframe, count: s.candles.length })),
	});
	for (const { timeframe: tf, candles } of timeframeSeries) {
		// Skip base timeframe - will be populated incrementally by Plant
		if (tf === baseTimeframe) {
			continue;
		}

		for (const candle of candles) {
			// Only add candles at or before the last base candle timestamp
			if (
				candle.timestamp <=
				windowedBaseCandles[windowedBaseCandles.length - 1]?.timestamp
			) {
				candleStore.ingest(tf, candle);
			}
		}
	}

	runtimeLogger.info("backtest_plant_config", {
		baseTimeframe,
		baseTimeframeMs: baseTfMs,
		totalBaseCandles: baseCandles.length,
		windowedBaseCandles: windowedBaseCandles.length,
		signalTimeframes: trackedTimeframes,
		executionTimeframe: timeframe,
	});

	// Create dummy marketDataClient for backtest (should not be called)
	const dummyMarketDataClient: MarketDataClient = {
		fetchOHLCV: async () => {
			throw new Error(
				"BacktestBaseCandleSource does not support fetchOHLCV - all data pre-loaded"
			);
		},
	};

	// Create BacktestBaseCandleSource with base candles
	const backtestSource = new BacktestBaseCandleSource({
		venue: "backtest",
		symbol,
		timeframe: baseTimeframe,
		candles: windowedBaseCandles,
		logger: runtimeLogger,
	});

	// Create MarketDataPlant with gap repair disabled
	const plant = new MarketDataPlant({
		venue: "backtest",
		symbol,
		marketDataClient: options.marketDataClient ?? dummyMarketDataClient,
		candleStore,
		source: backtestSource,
		enableGapRepair: false, // Backtest data is contiguous
		logger: runtimeLogger,
	});

	const trades: BacktestTrade[] = [];
	const equitySnapshots: EquitySnapshot[] = [];
	const decisionContext = createDecisionContext(venues, timeframe);
	let fallbackEquity = initialBalance;
	let lastExecutionTimestamp = 0;

	// Subscribe to plant candle events
	const unsubscribe = plant.onCandle(async (event: ClosedCandleEvent) => {
		// Only process execution timeframe events
		if (event.timeframe !== timeframe) {
			return;
		}

		// Skip warmup candles (before startTimestamp) - they build history but don't execute strategy
		if (event.candle.timestamp < effectiveConfig.startTimestamp) {
			return;
		}

		// Track last execution timestamp for final snapshot
		lastExecutionTimestamp = event.candle.timestamp;

		// Build multi-timeframe series from CandleStore
		const series: Record<string, Candle[]> = {};
		for (const tf of trackedTimeframes) {
			const tfCandles = candleStore.getSeries(tf);
			if (tfCandles.length > 0) {
				series[tf] = tfCandles;
			}
		}

		// Skip if no series data available
		if (Object.keys(series).length === 0) {
			return;
		}

		// Build snapshot
		const snapshot = buildTickSnapshot({
			symbol,
			signalVenue: venues.signalVenue,
			executionTimeframe: timeframe,
			executionCandle: event.candle,
			series,
		});

		const recordHook = createExecutionRecorder(
			trades,
			event.candle,
			executionProvider.getPosition(symbol)
		);

		const tickResult = await runTick({
			snapshot,
			strategy,
			riskManager,
			riskConfig: agenaiConfig.risk,
			executionProvider,
			symbol,
			accountEquityFallback: fallbackEquity,
			decisionContext,
			fingerprints: runtimeFingerprints,
			recordHook,
		});

		fallbackEquity = tickResult.updatedEquity;

		// Record equity snapshot after each execution tick
		equitySnapshots.push({
			timestamp: event.candle.timestamp,
			equity: fallbackEquity,
		});
	});

	// Start plant - handlers are awaited by Plant.emitEvent() sequentially
	await plant.start({
		timeframes: trackedTimeframes,
		executionTimeframe: timeframe,
		historyLimit: 0, // No bootstrap needed - data already in CandleStore
	});

	// Cleanup
	unsubscribe();
	await plant.stop();

	// Add final equity snapshot if we executed any ticks
	if (lastExecutionTimestamp > 0 && equitySnapshots.length > 0) {
		// Final snapshot already added after last tick, no need to duplicate
	} else if (lastExecutionTimestamp > 0) {
		// No snapshots were added (shouldn't happen), add final one
		equitySnapshots.push({
			timestamp: lastExecutionTimestamp,
			equity: fallbackEquity,
		});
	}

	const completedTrades = trades.filter(
		(trade) => trade.action === "CLOSE"
	).length;
	runtimeLogger.info("backtest_summary", {
		symbol,
		timeframe,
		totalCandles: windowedBaseCandles.length,
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
	store: CandleStore,
	startTimestamp: number
): number => {
	let warmupCandleCount = 0;
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
			store.ingestMany(frame.timeframe, frame.candles.slice(0, partition));
			warmupCandleCount += partition;
		}
	}
	return warmupCandleCount;
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

/**
 * Select base timeframe (smallest interval among requested timeframes)
 */
const selectBaseTimeframe = (timeframes: string[]): string => {
	if (timeframes.length === 0) {
		throw new Error("At least one timeframe must be requested");
	}

	let baseTf = timeframes[0];
	let baseMs = timeframeToMs(baseTf);

	for (const tf of timeframes) {
		const ms = timeframeToMs(tf);
		if (ms < baseMs) {
			baseMs = ms;
			baseTf = tf;
		}
	}

	return baseTf;
};

const createBacktestStrategy = async (
	strategyConfig: StrategyConfig,
	store: CandleStore
): Promise<TraderStrategy> => {
	const entry = getStrategyDefinition(strategyConfig.id);
	const dependencies = buildBacktestDependencies(entry, strategyConfig, store);
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
	store: CandleStore
): TDeps => {
	const maybeBacktestDeps = (
		entry.dependencies as {
			buildBacktestDeps?: (
				config: TConfig,
				options: { cache: CandleStore }
			) => TDeps;
		}
	)?.buildBacktestDeps;
	if (maybeBacktestDeps) {
		return maybeBacktestDeps(strategyConfig as TConfig, { cache: store });
	}
	if (entry.dependencies?.createCache) {
		return { cache: store } as TDeps;
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
		decide: (
			_candles: Candle[],
			position: PositionSide,
			_context: StrategyDecisionContext
		) => strategy.decide(position),
	};
};

const createExecutionRecorder = (
	trades: BacktestTrade[],
	candle: Candle,
	priorPosition: PaperPositionSnapshot
): ExecutionHook => {
	return (plan, result, _candle) => {
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

const createDecisionContext = (
	venues: VenueSelection,
	timeframe: string
): StrategyDecisionContext => ({
	signalVenue: venues.signalVenue,
	executionVenue: venues.executionVenue,
	timeframe,
	isClosed: true,
});
