import {
	AccountConfig,
	AgenaiConfig,
	Candle,
	CandleStore,
	ExecutionMode,
	RiskConfig,
	StrategyId,
} from "@agenai/core";
import { RiskManager } from "@agenai/risk-engine";
import { resolveStrategyBuilder } from "./strategyBuilders";
import {
	StrategyRuntimeMode,
	StrategySource,
	logMarketDataError,
	logRiskConfig,
	logStrategyLoaded,
	logStrategyRuntimeMetadata,
	logTimeframeFingerprint,
	runtimeLogger,
} from "./runtimeShared";
import { runTick } from "./loop/runTick";
import { buildTickSnapshot } from "./loop/buildTickSnapshot";
import type { ClosedCandleSource } from "./types/tickSnapshot";
import type { StrategyRuntimeBuilder } from "./runtimeFactory";
import type { StrategyDecisionContext, TraderStrategy } from "./types";
import type { LoadedRuntimeConfig, VenueSelection } from "./loadRuntimeConfig";
import {
	createRuntimeSnapshot,
	createRuntime,
	type RuntimeSnapshot,
} from "./runtimeSnapshot";
import { buildRuntimeFingerprintLogPayload } from "./runtimeFingerprint";
import type { StrategyRuntimeFingerprints } from "./fingerprints";
import { type ClosedCandleEvent, type MarketDataProvider } from "./marketData";
import { type ExecutionProvider } from "./execution/executionProvider";
export type { TraderStrategy } from "./types";

export const DEFAULT_POLL_INTERVAL_MS = 10_000;
const BOOTSTRAP_CANDLE_LIMIT = 300;
const FIFTEEN_MIN_MS = 15 * 60 * 1_000;

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
	marketDataProvider?: MarketDataProvider;
	executionProvider?: ExecutionProvider;
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
	const executionMode: ExecutionMode =
		traderConfig.executionMode ?? agenaiConfig.env.executionMode ?? "paper";
	const runtimeMode: StrategyRuntimeMode =
		executionMode === "live" ? "live" : "paper";
	const resolvedStrategyId = runtimeBootstrap.strategyId;
	const runtimeMetadata = runtimeSnapshot.metadata;
	const venues = runtimeBootstrap.venues;
	const executionTimeframe =
		venues.executionTimeframe ??
		runtimeMetadata.runtimeParams.executionTimeframe;
	const instrument = {
		symbol: runtimeMetadata.runtimeParams.symbol,
		timeframe: executionTimeframe,
	};
	const signalTimeframes = venues.signalTimeframes.length
		? venues.signalTimeframes
		: [executionTimeframe];
	const pollIntervalMs =
		traderConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const profileMetadata = runtimeBootstrap.profiles;

	if (!options.marketDataProvider) {
		throw new Error(
			"marketDataProvider is required. Inject an adapter from the app layer."
		);
	}
	if (!options.executionProvider) {
		throw new Error(
			"executionProvider is required. Inject an adapter from the app layer."
		);
	}

	const marketDataProvider = options.marketDataProvider;
	const executionProvider = options.executionProvider;

	const effectiveBuilder =
		options.strategyBuilder ??
		resolveStrategyBuilder(
			resolvedStrategyId,
			(symbolArg, timeframeArg, limit) =>
				marketDataProvider.fetchCandles(symbolArg, timeframeArg, limit)
		);

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
		mode: runtimeMode,
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
			pollIntervalMs,
			signalVenue: venues.signalVenue,
			executionVenue: venues.executionVenue,
			signalTimeframes,
			executionTimeframe,
		},
	});
	runtimeLogger.info("runtime_fingerprints", {
		mode: runtimeMode,
		strategyId: resolvedStrategyId,
		...buildRuntimeFingerprintLogPayload(runtimeSnapshot),
	});

	const riskManager = new RiskManager(agenaiConfig.risk);
	const initialSnapshot = executionProvider.snapshotAccount(0);
	const initialEquity =
		initialSnapshot?.equity ?? accountConfig.startingBalance ?? 100;

	runtimeLogger.info("venue_wiring_selected", {
		signalVenue: venues.signalVenue,
		executionVenue: venues.executionVenue,
		signalTimeframes,
		executionTimeframe,
		marketDataProvider: marketDataProvider.venue,
		executionProvider: executionProvider.venue,
	});

	runtimeLogger.info("trader_config", {
		symbol: instrument.symbol,
		timeframe: instrument.timeframe,
		useTestnet: traderConfig.useTestnet,
		executionMode,
		signalVenue: venues.signalVenue,
		executionVenue: venues.executionVenue,
		signalTimeframes,
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
		pollIntervalMs,
	});
	logRiskConfig(agenaiConfig.risk);

	const bootstrapState = await bootstrapMarketData({
		provider: marketDataProvider,
		symbol: instrument.symbol,
		timeframes: signalTimeframes,
		limit: BOOTSTRAP_CANDLE_LIMIT,
		mode: runtimeMode,
	});

	return startClosedCandleRuntime({
		provider: marketDataProvider,
		strategy,
		riskManager,
		riskConfig: agenaiConfig.risk,
		executionProvider,
		initialEquity,
		instrument,
		signalTimeframes,
		executionTimeframe,
		pollIntervalMs,
		bootstrap: bootstrapState,
		mode: runtimeMode,
		fingerprints: runtimeFingerprints,
		venues,
	});
};

interface BootstrapState {
	candlesByTimeframe: Map<string, Candle[]>;
	lastTimestampByTimeframe: Map<string, number>;
}

interface BootstrapOptions {
	provider: MarketDataProvider;
	symbol: string;
	timeframes: string[];
	limit: number;
	mode: StrategyRuntimeMode;
}

const bootstrapMarketData = async (
	options: BootstrapOptions
): Promise<BootstrapState> => {
	try {
		const result = await options.provider.bootstrap({
			symbol: options.symbol,
			timeframes: options.timeframes,
			limit: options.limit,
		});
		const candlesByTimeframe = new Map<string, Candle[]>();
		const lastTimestampByTimeframe = new Map<string, number>();
		for (const timeframe of options.timeframes) {
			const source = result.candlesByTimeframe.get(timeframe) ?? [];
			const trimmed =
				source.length <= options.limit
					? [...source]
					: source.slice(source.length - options.limit);
			candlesByTimeframe.set(timeframe, trimmed);
			if (trimmed.length) {
				const latest = trimmed[trimmed.length - 1]?.timestamp ?? 0;
				lastTimestampByTimeframe.set(timeframe, latest);
				logTimeframeFingerprint({
					mode: options.mode,
					label: "live_bootstrap",
					symbol: options.symbol,
					timeframe,
					candles: trimmed,
				});
			} else {
				runtimeLogger.warn("bootstrap_missing_candles", {
					symbol: options.symbol,
					timeframe,
					venue: options.provider.venue,
				});
			}
		}
		runtimeLogger.info("market_data_bootstrap_complete", {
			symbol: options.symbol,
			timeframes: options.timeframes,
			venue: options.provider.venue,
		});
		return { candlesByTimeframe, lastTimestampByTimeframe };
	} catch (error) {
		logMarketDataError(error);
		return {
			candlesByTimeframe: new Map(),
			lastTimestampByTimeframe: new Map(),
		};
	}
};

interface ClosedCandleRuntimeOptions {
	provider: MarketDataProvider;
	strategy: TraderStrategy;
	riskManager: RiskManager;
	riskConfig: RiskConfig;
	executionProvider: ExecutionProvider;
	initialEquity: number;
	instrument: { symbol: string; timeframe: string };
	signalTimeframes: string[];
	executionTimeframe: string;
	pollIntervalMs: number;
	bootstrap: BootstrapState;
	mode: StrategyRuntimeMode;
	fingerprints: StrategyRuntimeFingerprints;
	venues: VenueSelection;
}

const startClosedCandleRuntime = async (
	options: ClosedCandleRuntimeOptions
): Promise<never> => {
	// Calculate max candles per timeframe from warmup config
	const maxCandlesByTimeframe: Record<string, number> = {};
	const historyWindow = 600; // Default window
	for (const tf of options.signalTimeframes) {
		// Use a generous limit that accommodates warmup + history
		maxCandlesByTimeframe[tf] = historyWindow;
	}

	// Initialize CandleStore
	const candleStore = new CandleStore({
		defaultMaxCandles: historyWindow,
		maxCandlesByTimeframe,
	});

	// Ingest bootstrap candles
	for (const timeframe of options.signalTimeframes) {
		const candles = options.bootstrap.candlesByTimeframe.get(timeframe) ?? [];
		if (candles.length > 0) {
			candleStore.ingestMany(timeframe, candles);
		}
	}

	const lastTimestampByTimeframe = new Map(
		options.bootstrap.lastTimestampByTimeframe
	);
	const lastFingerprintByTimeframe = new Map<string, number>();
	let fallbackEquity = options.initialEquity;

	const feed = options.provider.createFeed({
		symbol: options.instrument.symbol,
		timeframes: options.signalTimeframes,
		executionTimeframe: options.executionTimeframe,
		pollIntervalMs: options.pollIntervalMs,
	});

	let queue = Promise.resolve();

	const handleEvent = async (event: ClosedCandleEvent): Promise<void> => {
		const lastTs = lastTimestampByTimeframe.get(event.timeframe) ?? 0;
		if (lastTs && event.candle.timestamp <= lastTs) {
			runtimeLogger.debug("candle_duplicate_skipped", {
				timeframe: event.timeframe,
				symbol: event.symbol,
				lastTimestamp: lastTs,
			});
			return;
		}

		lastTimestampByTimeframe.set(event.timeframe, event.candle.timestamp);
		candleStore.ingest(event.timeframe, event.candle);
		logClosedCandleEvent(event);

		if (event.timeframe === options.executionTimeframe) {
			const buffer = candleStore.getSeries(event.timeframe);
			maybeLogFingerprint({
				timeframe: event.timeframe,
				buffer,
				mode: options.mode,
				symbol: options.instrument.symbol,
				latestTimestamp: event.candle.timestamp,
				lastLoggedByTimeframe: lastFingerprintByTimeframe,
			});

			// Build multi-timeframe series from CandleStore
			const series: Record<string, Candle[]> = {};
			for (const tf of options.signalTimeframes) {
				series[tf] = candleStore.getSeries(tf);
			}

			// Build snapshot
			const snapshot = buildTickSnapshot({
				symbol: options.instrument.symbol,
				signalVenue: options.venues.signalVenue,
				executionTimeframe: options.executionTimeframe,
				executionCandle: event.candle,
				series,
				arrivalDelayMs: event.arrivalDelayMs,
			});

			const tickResult = await runTick({
				snapshot,
				strategy: options.strategy,
				riskManager: options.riskManager,
				riskConfig: options.riskConfig,
				executionProvider: options.executionProvider,
				symbol: options.instrument.symbol,
				accountEquityFallback: fallbackEquity,
				decisionContext: createDecisionContext(event, options.venues),
				fingerprints: options.fingerprints,
			});
			fallbackEquity = tickResult.updatedEquity;
		}
	};

	feed.onCandle((event) => {
		queue = queue
			.then(() => handleEvent(event))
			.catch((error) => {
				runtimeLogger.error("live_candle_processing_error", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		return queue;
	});

	feed.start();
	return new Promise<never>(() => {
		// Keeps the process alive; shutdown handled externally.
	});
};

interface FingerprintLogContext {
	timeframe: string;
	buffer: Candle[];
	mode: StrategyRuntimeMode;
	symbol: string;
	latestTimestamp: number;
	lastLoggedByTimeframe: Map<string, number>;
}

const maybeLogFingerprint = (context: FingerprintLogContext): void => {
	if (!context.buffer.length) {
		return;
	}
	const lastLogged = context.lastLoggedByTimeframe.get(context.timeframe) ?? 0;
	if (context.latestTimestamp - lastLogged < FIFTEEN_MIN_MS) {
		return;
	}
	logTimeframeFingerprint({
		mode: context.mode,
		label: "live_window",
		symbol: context.symbol,
		timeframe: context.timeframe,
		candles: context.buffer,
		windowMs: FIFTEEN_MIN_MS,
	});
	context.lastLoggedByTimeframe.set(context.timeframe, context.latestTimestamp);
};

const logClosedCandleEvent = (event: ClosedCandleEvent): void => {
	runtimeLogger.debug("closed_candle_event", {
		venue: event.venue,
		symbol: event.symbol,
		timeframe: event.timeframe,
		timestamp: new Date(event.candle.timestamp).toISOString(),
		close: event.candle.close,
		gapFilled: event.gapFilled ?? false,
		source: event.source,
		arrivalDelayMs: event.arrivalDelayMs,
	});
};

const createDecisionContext = (
	event: ClosedCandleEvent,
	venues: VenueSelection
): StrategyDecisionContext => ({
	signalVenue: event.venue,
	executionVenue: venues.executionVenue,
	timeframe: event.timeframe,
	isClosed: true,
});
