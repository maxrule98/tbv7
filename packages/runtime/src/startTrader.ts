import {
	AccountConfig,
	AgenaiConfig,
	Candle,
	ExecutionMode,
	RiskConfig,
	StrategyId,
} from "@agenai/core";
import {
	DefaultDataProvider,
	timeframeToMs,
	type DataProvider,
} from "@agenai/data";
import { MexcClient } from "@agenai/exchange-mexc";
import { ExecutionEngine, PaperAccount } from "@agenai/execution-engine";
import { RiskManager } from "@agenai/risk-engine";
import { resolveStrategyBuilder } from "./strategyBuilders";
import {
	StrategyRuntimeMode,
	StrategySource,
	calculateUnrealizedPnl,
	enrichIntentMetadata,
	getPreExecutionSkipReason,
	logAndSnapshotPosition,
	logExecutionError,
	logExecutionResult,
	logExecutionSkipped,
	logMarketDataError,
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
	withRuntimeFingerprints,
} from "./runtimeShared";
import type { StrategyRuntimeBuilder } from "./runtimeFactory";
import type { TraderStrategy } from "./types";
import type { LoadedRuntimeConfig } from "./loadRuntimeConfig";
import {
	createRuntimeSnapshot,
	createRuntime,
	type RuntimeSnapshot,
} from "./runtimeSnapshot";
import { buildRuntimeFingerprintLogPayload } from "./runtimeFingerprint";
import type { StrategyRuntimeFingerprints } from "./fingerprints";
export type { TraderStrategy } from "./types";

export const DEFAULT_POLL_INTERVAL_MS = 10_000;
const BOOTSTRAP_CANDLE_LIMIT = 300;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export interface TraderConfig {
	symbol?: string;
	timeframe?: string;
	useTestnet: boolean;
	executionMode?: ExecutionMode;
	pollIntervalMs?: number;
	strategyId?: StrategyId;
}

export interface StartTraderOptions {
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
	strategyBuilder?: StrategyRuntimeBuilder;
	dataProvider?: DataProvider;
}

export const startTrader = async (
	traderConfig: TraderConfig,
	options: StartTraderOptions = {}
): Promise<never> => {
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
			requestedStrategyId: traderConfig.strategyId,
			instrument: {
				symbol: traderConfig.symbol,
				timeframe: traderConfig.timeframe,
			},
		});

	const runtimeBootstrap = runtimeSnapshot.config;
	const agenaiConfig = runtimeBootstrap.agenaiConfig;
	const accountConfig = runtimeBootstrap.accountConfig;
	const executionMode =
		traderConfig.executionMode ?? agenaiConfig.env.executionMode ?? "paper";
	const resolvedStrategyId = runtimeBootstrap.strategyId;
	const runtimeMetadata = runtimeSnapshot.metadata;
	const instrument = {
		symbol: runtimeMetadata.runtimeParams.symbol,
		timeframe: runtimeMetadata.runtimeParams.executionTimeframe,
	};
	const profileMetadata = runtimeBootstrap.profiles;

	const client = new MexcClient({
		apiKey: agenaiConfig.exchange.credentials.apiKey,
		secret: agenaiConfig.exchange.credentials.apiSecret,
		useFutures: true,
	});

	const dataProvider =
		options.dataProvider ?? new DefaultDataProvider({ client });

	const effectiveBuilder =
		options.strategyBuilder ??
		resolveStrategyBuilder(resolvedStrategyId, client);

	const runtime = await createRuntime(runtimeSnapshot, {
		strategyOverride: options.strategyOverride,
		builder: effectiveBuilder,
		builderName: options.strategyOverride
			? undefined
			: (options.strategyBuilder?.name ?? "live_strategy_builder"),
	});
	const { strategy, source: strategySource } = runtime;
	const runtimeFingerprints: StrategyRuntimeFingerprints = {
		strategyConfigFingerprint: runtimeSnapshot.strategyConfigFingerprint,
		runtimeContextFingerprint: runtimeSnapshot.runtimeContextFingerprint,
	};
	logStrategyRuntimeMetadata({
		mode: executionMode,
		strategyId: resolvedStrategyId,
		strategyConfig: agenaiConfig.strategy,
		fingerprints: runtimeFingerprints,
		metadata: runtimeMetadata,
		source: strategySource,
		builderName: runtime.builderName,
		profiles: profileMetadata,
		extra: {
			symbol: instrument.symbol,
			timeframe: instrument.timeframe,
			pollIntervalMs: traderConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		},
	});
	runtimeLogger.info("runtime_fingerprints", {
		mode: executionMode,
		strategyId: resolvedStrategyId,
		...buildRuntimeFingerprintLogPayload(runtimeSnapshot),
	});
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

	runtimeLogger.info("trader_config", {
		symbol: instrument.symbol,
		timeframe: instrument.timeframe,
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
		traderConfig: {
			symbol: instrument.symbol,
			timeframe: instrument.timeframe,
			useTestnet: traderConfig.useTestnet,
		},
		executionMode,
		builderName: runtime.builderName,
		profiles: profileMetadata,
		pollIntervalMs: traderConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
	});
	logRiskConfig(agenaiConfig.risk);

	const candlesBySymbol = new Map<string, Candle[]>();
	const lastTimestampBySymbol = new Map<string, number>();

	const bootstrapWindow = await bootstrapCandles(
		dataProvider,
		instrument.symbol,
		instrument.timeframe,
		candlesBySymbol,
		lastTimestampBySymbol
	);
	if (bootstrapWindow.length) {
		logTimeframeFingerprint({
			mode: executionMode,
			label: "live_bootstrap",
			symbol: instrument.symbol,
			timeframe: instrument.timeframe,
			candles: bootstrapWindow,
		});
	}

	return startPolling(
		dataProvider,
		strategy,
		riskManager,
		agenaiConfig.risk,
		executionEngine,
		initialEquity,
		instrument.symbol,
		instrument.timeframe,
		candlesBySymbol,
		lastTimestampBySymbol,
		traderConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		executionMode,
		runtimeFingerprints
	);
};

const bootstrapCandles = async (
	dataProvider: DataProvider,
	symbol: string,
	timeframe: string,
	candlesBySymbol: Map<string, Candle[]>,
	lastTimestampBySymbol: Map<string, number>
): Promise<Candle[]> => {
	const now = Date.now();
	const windowMs = timeframeToMs(timeframe) * (BOOTSTRAP_CANDLE_LIMIT + 5);
	const startTimestamp = Math.max(0, now - windowMs);
	try {
		const [series] = await dataProvider.loadHistoricalSeries({
			symbol,
			startTimestamp,
			endTimestamp: now,
			requests: [
				{
					timeframe,
					limit: BOOTSTRAP_CANDLE_LIMIT,
				},
			],
		});

		const candles = series?.candles ?? [];
		if (!candles.length) {
			runtimeLogger.warn("bootstrap_no_candles", { symbol, timeframe });
			return [];
		}

		const trimmed =
			candles.length <= BOOTSTRAP_CANDLE_LIMIT
				? candles
				: candles.slice(candles.length - BOOTSTRAP_CANDLE_LIMIT);

		candlesBySymbol.set(symbol, trimmed);
		lastTimestampBySymbol.set(
			symbol,
			trimmed[trimmed.length - 1]?.timestamp ?? 0
		);
		runtimeLogger.info("bootstrap_candles_loaded", {
			symbol,
			timeframe,
			count: trimmed.length,
		});
		return trimmed;
	} catch (error) {
		logMarketDataError(error);
		return [];
	}
};

const startPolling = async (
	dataProvider: DataProvider,
	strategy: TraderStrategy,
	riskManager: RiskManager,
	riskConfig: RiskConfig,
	executionEngine: ExecutionEngine,
	defaultEquity: number,
	symbol: string,
	timeframe: string,
	candlesBySymbol: Map<string, Candle[]>,
	lastTimestampBySymbol: Map<string, number>,
	pollIntervalMs: number,
	runtimeMode: StrategyRuntimeMode,
	fingerprints: StrategyRuntimeFingerprints
): Promise<never> => {
	let fallbackEquity = defaultEquity;
	const subscription = dataProvider.createLiveSubscription({
		symbol,
		timeframes: [timeframe],
		pollIntervalMs,
		bufferSize: 500,
	});

	let queue = Promise.resolve();
	let lastFingerprintLogged = 0;

	const processCandle = async (latest: Candle): Promise<void> => {
		const lastTimestamp = lastTimestampBySymbol.get(symbol);
		if (lastTimestamp === latest.timestamp) {
			runtimeLogger.debug("poll_no_update", {
				symbol,
				timeframe,
				lastTimestamp,
			});
			return;
		}

		lastTimestampBySymbol.set(symbol, latest.timestamp);
		const buffer = appendCandle(candlesBySymbol, latest);
		logCandle(latest);
		if (latest.timestamp - lastFingerprintLogged >= FIFTEEN_MIN_MS) {
			logTimeframeFingerprint({
				mode: runtimeMode,
				label: "live_window",
				symbol,
				timeframe,
				candles: buffer,
				windowMs: FIFTEEN_MIN_MS,
			});
			lastFingerprintLogged = latest.timestamp;
		}

		const positionState = executionEngine.getPosition(symbol);
		const unrealizedPnl = calculateUnrealizedPnl(positionState, latest.close);
		const prePlanSnapshot = executionEngine.snapshotPaperAccount(unrealizedPnl);
		const accountEquity = prePlanSnapshot?.equity ?? fallbackEquity;

		const forcedExitHandled = await maybeHandleForcedExit(
			positionState,
			latest,
			riskManager,
			executionEngine,
			accountEquity,
			undefined,
			fingerprints
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
			return;
		}

		const trailingExitHandled = await maybeHandleTrailingStop(
			symbol,
			positionState,
			latest,
			riskManager,
			executionEngine,
			accountEquity,
			riskConfig,
			undefined,
			fingerprints
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
			return;
		}

		const intent = enrichIntentMetadata(
			await strategy.decide(buffer, positionState.side)
		);
		const fingerprintedIntent = withRuntimeFingerprints(intent, fingerprints);
		logStrategyDecision(latest, fingerprintedIntent, fingerprints);

		const plan = riskManager.plan(
			fingerprintedIntent,
			latest.close,
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
				logTradePlan(plan, latest, fingerprintedIntent);
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
	};

	subscription.onCandle((candle) => {
		queue = queue
			.then(() => processCandle(candle))
			.catch((error) => {
				runtimeLogger.error("live_candle_processing_error", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		return queue;
	});

	subscription.start();
	return new Promise<never>(() => {
		// Keeps the process alive; shutdown handled externally.
	});
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
	runtimeLogger.debug("latest_candle", payload);
};
