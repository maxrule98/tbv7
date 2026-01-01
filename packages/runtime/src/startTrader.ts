import {
	AccountConfig,
	AgenaiConfig,
	Candle,
	CandleStore,
	ExecutionMode,
	RiskConfig,
	StrategyId,
	type MarketDataClient,
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
import {
	type ClosedCandleEvent,
	type BaseCandleSource,
	MarketDataPlant,
} from "./marketData";
import { type ExecutionProvider } from "./execution/executionProvider";
export type { TraderStrategy } from "./types";

const BOOTSTRAP_CANDLE_LIMIT = 300;
const FIFTEEN_MIN_MS = 15 * 60 * 1_000;

export interface TraderConfig {
	symbol?: string;
	timeframe?: string;
	useTestnet: boolean;
	executionMode?: ExecutionMode;
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
	// Phase F: Required dependencies
	executionProvider: ExecutionProvider;
	baseCandleSource: BaseCandleSource;
	marketDataClient: MarketDataClient;
}

export const startTrader = async (
	traderConfig: TraderConfig,
	options: StartTraderOptions
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
	const profileMetadata = runtimeBootstrap.profiles;

	// Phase F: Strict validation - all dependencies required
	if (!options.executionProvider) {
		throw new Error("executionProvider is required.");
	}
	if (!options.baseCandleSource) {
		throw new Error("baseCandleSource is required for Phase F runtime.");
	}
	if (!options.marketDataClient) {
		throw new Error("marketDataClient is required for Phase F runtime.");
	}

	const executionProvider = options.executionProvider;

	const effectiveBuilder =
		options.strategyBuilder ??
		resolveStrategyBuilder(resolvedStrategyId, (symbol, timeframe, limit) =>
			options.marketDataClient.fetchOHLCV(symbol, timeframe, limit)
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
		baseCandleSource: options.baseCandleSource.venue,
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
	});
	logRiskConfig(agenaiConfig.risk);

	// Phase F: Start Plant-driven runtime
	return startClosedCandleRuntime({
		baseCandleSource: options.baseCandleSource,
		marketDataClient: options.marketDataClient,
		strategy,
		riskManager,
		riskConfig: agenaiConfig.risk,
		executionProvider,
		initialEquity,
		instrument,
		signalTimeframes,
		executionTimeframe,
		mode: runtimeMode,
		fingerprints: runtimeFingerprints,
		venues,
	});
};

interface ClosedCandleRuntimeOptions {
	baseCandleSource: BaseCandleSource;
	marketDataClient: MarketDataClient;
	strategy: TraderStrategy;
	riskManager: RiskManager;
	riskConfig: RiskConfig;
	executionProvider: ExecutionProvider;
	initialEquity: number;
	instrument: { symbol: string; timeframe: string };
	signalTimeframes: string[];
	executionTimeframe: string;
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

	// Initialize CandleStore (Plant will populate it)
	const candleStore = new CandleStore({
		defaultMaxCandles: historyWindow,
		maxCandlesByTimeframe,
	});

	const lastFingerprintByTimeframe = new Map<string, number>();
	let fallbackEquity = options.initialEquity;

	// Phase F: Create MarketDataPlant
	const plant = new MarketDataPlant({
		venue: options.venues.signalVenue,
		symbol: options.instrument.symbol,
		marketDataClient: options.marketDataClient,
		candleStore,
		source: options.baseCandleSource,
		logger: runtimeLogger,
	});

	let queue = Promise.resolve();

	const handleEvent = async (event: ClosedCandleEvent): Promise<void> => {
		// Plant already ingested to candleStore, no need to re-ingest
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

	plant.onCandle((event) => {
		queue = queue
			.then(() => handleEvent(event))
			.catch((error) => {
				runtimeLogger.error("live_candle_processing_error", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		return queue;
	});

	// Plant bootstraps history and starts source
	await plant.start({
		timeframes: options.signalTimeframes,
		executionTimeframe: options.executionTimeframe,
		historyLimit: BOOTSTRAP_CANDLE_LIMIT,
	});

	runtimeLogger.info("plant_runtime_started", {
		symbol: options.instrument.symbol,
		venue: options.venues.signalVenue,
		timeframes: options.signalTimeframes,
		executionTimeframe: options.executionTimeframe,
	});

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
