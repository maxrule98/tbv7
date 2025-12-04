import {
	AccountConfig,
	AgenaiConfig,
	Candle,
	PositionSide,
	StrategyConfig,
	StrategyId,
	TradeIntent,
	UltraAggressiveBtcUsdtConfig,
	UltraAggressiveBtcUsdtStrategy,
	VWAPDeltaGammaConfig,
	VWAPDeltaGammaStrategy,
	loadAccountConfig,
	loadAgenaiConfig,
	loadStrategyConfig,
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
import { BacktestTimeframeCache } from "./BacktestTimeframeCache";
import { BacktestConfig, BacktestResult, BacktestTrade } from "./backtestTypes";

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
	timeframeData?: Record<string, Candle[]>;
}

interface TimeframeSeries {
	timeframe: string;
	candles: Candle[];
}

type WarmupMap = Map<string, number>;

const DEFAULT_STRATEGY_PROFILES: Record<StrategyId, string> = {
	vwap_delta_gamma: "vwap-delta-gamma",
	ultra_aggressive_btc_usdt: "ultra-aggressive-btc-usdt",
};

const resolveStrategyProfileName = (
	strategyId: StrategyId,
	overrideProfile?: string
): string => {
	if (overrideProfile) {
		return overrideProfile;
	}
	const profile = DEFAULT_STRATEGY_PROFILES[strategyId];
	if (!profile) {
		throw new Error(`No default strategy profile mapped for ${strategyId}`);
	}
	return profile;
};

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

	if (agenaiConfig.strategy.id !== backtestConfig.strategyId) {
		runtimeLogger.warn("backtest_strategy_mismatch", {
			requestedStrategy: backtestConfig.strategyId,
			loadedStrategy: agenaiConfig.strategy.id,
		});
		const fallbackProfile = resolveStrategyProfileName(
			backtestConfig.strategyId,
			options.strategyProfile
		);
		try {
			const reloadedStrategy = loadStrategyConfig(
				options.configDir,
				fallbackProfile
			);
			if (reloadedStrategy.id !== backtestConfig.strategyId) {
				throw new Error(
					`profile ${fallbackProfile} resolved to ${reloadedStrategy.id}`
				);
			}
			agenaiConfig.strategy = reloadedStrategy;
			runtimeLogger.info("backtest_strategy_config_reloaded", {
				requestedStrategy: backtestConfig.strategyId,
				reloadedProfile: fallbackProfile,
				configDir: options.configDir ?? null,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "unknown_error";
			throw new Error(
				`Failed to load config for strategy ${backtestConfig.strategyId}. ` +
					`Provide a matching --strategyProfile or ensure config exists. (${message})`
			);
		}
	}

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

	const riskManager = new RiskManager(agenaiConfig.risk);
	const initialBalance =
		backtestConfig.initialBalance ?? accountConfig.startingBalance ?? 1000;
	const paperAccount = new PaperAccount(initialBalance);
	const executionEngine = new ExecutionEngine({
		client,
		mode: "paper",
		paperAccount,
	});

	runtimeLogger.info("backtest_config", {
		symbol: backtestConfig.symbol,
		timeframe: backtestConfig.timeframe,
		startTimestamp: new Date(backtestConfig.startTimestamp).toISOString(),
		endTimestamp: new Date(backtestConfig.endTimestamp).toISOString(),
		strategyId: backtestConfig.strategyId,
		maxCandles: backtestConfig.maxCandles ?? null,
		initialBalance,
	});

	const trackedTimeframes = deriveStrategyTimeframes(
		backtestConfig.strategyId,
		agenaiConfig.strategy,
		backtestConfig.timeframe
	);
	const warmupByTimeframe = deriveWarmupCandles(
		backtestConfig.strategyId,
		agenaiConfig.strategy,
		backtestConfig.timeframe
	);

	const timeframeSeries: TimeframeSeries[] = options.timeframeData
		? buildProvidedSeries(options.timeframeData, trackedTimeframes)
		: await loadTimeframeSeries(
				client,
				backtestConfig,
				trackedTimeframes,
				warmupByTimeframe
		  );

	const cache = new BacktestTimeframeCache({
		timeframes: trackedTimeframes,
		limit: Math.max(backtestConfig.maxCandles ?? 600, 300),
	});
	primeCacheWithWarmup(timeframeSeries, cache, backtestConfig.startTimestamp);

	const executionSeries = timeframeSeries.find(
		(series) => series.timeframe === backtestConfig.timeframe
	);
	if (!executionSeries || executionSeries.candles.length === 0) {
		throw new Error("No candles loaded for execution timeframe");
	}

	const strategySource: StrategySource = options.strategyOverride
		? "override"
		: "builder";
	const strategy = options.strategyOverride
		? options.strategyOverride
		: createBacktestStrategy(
				backtestConfig.strategyId,
				agenaiConfig.strategy,
				cache
		  );

	logStrategyLoaded({
		source: strategySource,
		strategy,
		strategyConfig: options.strategyOverride
			? undefined
			: agenaiConfig.strategy,
		strategyId: backtestConfig.strategyId,
		traderConfig: {
			symbol: backtestConfig.symbol,
			timeframe: backtestConfig.timeframe,
			useTestnet: backtestConfig.useTestnet ?? false,
		},
		executionMode: "paper",
		builderName: strategySource === "builder" ? "backtest_strategy" : undefined,
		profiles: {
			account: options.accountProfile,
			strategy: options.strategyProfile,
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

		const buffer = await cache.getCandles(backtestConfig.timeframe);
		if (!buffer.length) {
			continue;
		}

		const positionState = executionEngine.getPosition(backtestConfig.symbol);
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
				backtestConfig.symbol,
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
			backtestConfig.symbol,
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
				backtestConfig.symbol,
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

		const latestPosition = executionEngine.getPosition(backtestConfig.symbol);
		logPaperPosition(backtestConfig.symbol, latestPosition);

		const accountSnapshot = snapshotPaperAccount(
			executionEngine,
			calculateUnrealizedPnl(latestPosition, candle.close),
			backtestConfig.symbol,
			candle.timestamp
		);
		if (accountSnapshot) {
			fallbackEquity = accountSnapshot.equity;
			equitySnapshots.push(accountSnapshot);
		}
	}

	runtimeLogger.info("backtest_summary", {
		symbol: backtestConfig.symbol,
		timeframe: backtestConfig.timeframe,
		totalCandles: executionSeries.candles.length,
		totalTrades: trades.length,
		finalEquity:
			equitySnapshots[equitySnapshots.length - 1]?.equity ?? fallbackEquity,
	});

	return {
		config: backtestConfig,
		trades,
		equitySnapshots,
	};
};

const deriveStrategyTimeframes = (
	strategyId: StrategyId,
	strategyConfig: StrategyConfig,
	executionTimeframe: string
): string[] => {
	const frames = new Set<string>([executionTimeframe]);
	if (strategyId === "ultra_aggressive_btc_usdt") {
		const cfg = strategyConfig as UltraAggressiveBtcUsdtConfig;
		frames.add(cfg.timeframes.execution);
		frames.add(cfg.timeframes.confirming);
		frames.add(cfg.timeframes.context);
	}
	if (strategyId === "vwap_delta_gamma") {
		const cfg = strategyConfig as VWAPDeltaGammaConfig;
		frames.add(cfg.timeframes.execution);
		frames.add(cfg.timeframes.trend);
		frames.add(cfg.timeframes.bias);
		frames.add(cfg.timeframes.macro);
	}
	return Array.from(frames);
};

const deriveWarmupCandles = (
	strategyId: StrategyId,
	strategyConfig: StrategyConfig,
	executionTimeframe: string
): WarmupMap => {
	const warmup = new Map<string, number>();
	const ensure = (timeframe: string, candles: number): void => {
		if (!timeframe) {
			return;
		}
		const normalized = Math.max(0, Math.floor(candles));
		const current = warmup.get(timeframe) ?? 0;
		warmup.set(timeframe, Math.max(current, normalized));
	};

	ensure(executionTimeframe, 300);

	if (strategyId === "vwap_delta_gamma") {
		const cfg = strategyConfig as VWAPDeltaGammaConfig;
		ensure(cfg.timeframes.execution, cfg.vwapRollingLong + 20);
		ensure(cfg.timeframes.trend, Math.max(cfg.vwapRollingLong / 2, 150));
		ensure(cfg.timeframes.bias, 180);
		ensure(cfg.timeframes.macro, 120);
	}

	if (strategyId === "ultra_aggressive_btc_usdt") {
		const cfg = strategyConfig as UltraAggressiveBtcUsdtConfig;
		const maxLookback = Math.max(
			cfg.lookbacks.executionBars,
			cfg.lookbacks.breakoutRange,
			cfg.lookbacks.rangeDetection,
			cfg.lookbacks.trendCandles,
			cfg.lookbacks.volatility,
			cfg.lookbacks.cvd
		);
		ensure(cfg.timeframes.execution, maxLookback + 20);
		ensure(cfg.timeframes.confirming, Math.max(maxLookback / 3, 100));
		ensure(cfg.timeframes.context, Math.max(maxLookback / 4, 80));
	}

	return warmup;
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
	client: MexcClient,
	backtestConfig: BacktestConfig,
	timeframes: string[],
	warmupByTimeframe: WarmupMap
): Promise<TimeframeSeries[]> => {
	const series: TimeframeSeries[] = [];
	for (const timeframe of timeframes) {
		const limit =
			timeframe === backtestConfig.timeframe
				? backtestConfig.maxCandles
				: undefined;
		const warmupCandles = warmupByTimeframe.get(timeframe) ?? 0;
		const candles = await fetchHistoricalCandles(
			client,
			backtestConfig.symbol,
			timeframe,
			backtestConfig.startTimestamp,
			backtestConfig.endTimestamp,
			limit,
			warmupCandles
		);
		series.push({ timeframe, candles });
		runtimeLogger.info("backtest_timeframe_loaded", {
			timeframe,
			candles: candles.length,
			warmupCandles,
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

const fetchHistoricalCandles = async (
	client: MexcClient,
	symbol: string,
	timeframe: string,
	startTs: number,
	endTs: number,
	maxCandles?: number,
	warmupCandles = 0
): Promise<Candle[]> => {
	const result: Candle[] = [];
	const warmupMs = timeframeToMs(timeframe) * Math.max(0, warmupCandles);
	let since = Math.max(0, startTs - warmupMs);
	const limit = 500;
	let safety = 0;
	const maxIterations = 10_000;
	let inRangeCount = 0;

	while (since <= endTs && safety < maxIterations) {
		const remaining =
			typeof maxCandles === "number" && maxCandles > 0
				? Math.min(limit, Math.max(maxCandles - inRangeCount, 0))
				: limit;
		if (remaining <= 0) {
			break;
		}

		const batch = await client.fetchOHLCV(symbol, timeframe, remaining, since);
		if (!batch.length) {
			break;
		}

		for (const candle of batch) {
			if (candle.timestamp > endTs) {
				return result;
			}
			result.push(candle);
			if (candle.timestamp >= startTs) {
				inRangeCount += 1;
			}
			if (maxCandles && inRangeCount >= maxCandles) {
				return result;
			}
		}

		const last = batch[batch.length - 1];
		if (!last) {
			break;
		}
		const nextSince = last.timestamp + timeframeToMs(timeframe);
		if (nextSince <= since) {
			break;
		}
		since = nextSince;
		safety += 1;
	}

	return result;
};

const timeframeToMs = (timeframe: string): number => {
	const match = timeframe.match(/^(\d+)([smhdw])$/i);
	if (!match) {
		throw new Error(`Unsupported timeframe format: ${timeframe}`);
	}
	const value = Number(match[1]);
	const unit = match[2].toLowerCase();
	const unitToMs: Record<string, number> = {
		s: 1000,
		m: 60_000,
		h: 3_600_000,
		d: 86_400_000,
		w: 604_800_000,
	};
	const factor = unitToMs[unit];
	if (!factor) {
		throw new Error(`Unsupported timeframe unit: ${timeframe}`);
	}
	return value * factor;
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

const createBacktestStrategy = (
	strategyId: StrategyId,
	strategyConfig: StrategyConfig,
	cache: BacktestTimeframeCache
): TraderStrategy => {
	if (strategyId === "ultra_aggressive_btc_usdt") {
		const strategy = new UltraAggressiveBtcUsdtStrategy(
			strategyConfig as UltraAggressiveBtcUsdtConfig,
			{ cache }
		);
		return createCacheDrivenAdapter(strategy);
	}
	if (strategyId === "vwap_delta_gamma") {
		const strategy = new VWAPDeltaGammaStrategy(
			strategyConfig as VWAPDeltaGammaConfig,
			{ cache }
		);
		return createCacheDrivenAdapter(strategy);
	}
	throw new Error(`No backtest strategy constructed for ${strategyId}`);
};

const createCacheDrivenAdapter = (strategy: {
	decide: (position: PositionSide) => Promise<TradeIntent>;
}): TraderStrategy => {
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
				? result.price ?? candle.close
				: priorPosition.avgEntryPrice ?? result.price ?? candle.close,
		exitPrice:
			plan.action === "CLOSE" ? result.price ?? candle.close : undefined,
		realizedPnl: plan.action === "CLOSE" ? result.realizedPnl : undefined,
		timestamp: candle.timestamp,
	};
	trades.push(trade);
};
