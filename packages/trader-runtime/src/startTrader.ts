import {
	AccountConfig,
	AgenaiConfig,
	Candle,
	ExecutionMode,
	RiskConfig,
	StrategyId,
	loadAccountConfig,
	loadAgenaiConfig,
} from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
import { ExecutionEngine, PaperAccount } from "@agenai/execution-engine";
import { RiskManager } from "@agenai/risk-engine";
import { resolveStrategyBuilder } from "./strategyBuilders";
import {
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
	logTradePlan,
	maybeHandleForcedExit,
	maybeHandleTrailingStop,
	runtimeLogger,
	snapshotPaperAccount,
} from "./runtimeShared";
import type { TraderStrategy } from "./types";
export type { TraderStrategy } from "./types";

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

	runtimeLogger.info("trader_config", {
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
		traderConfig: {
			symbol: traderConfig.symbol,
			timeframe: traderConfig.timeframe,
			useTestnet: traderConfig.useTestnet,
		},
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
		pollIntervalMs: traderConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
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
			runtimeLogger.warn("bootstrap_no_candles", { symbol, timeframe });
			return;
		}

		candlesBySymbol.set(symbol, candles);
		lastTimestampBySymbol.set(
			symbol,
			candles[candles.length - 1]?.timestamp ?? 0
		);
		runtimeLogger.info("bootstrap_candles_loaded", {
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
				runtimeLogger.warn("poll_no_candle", { symbol, timeframe });
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
				runtimeLogger.debug("poll_no_update", {
					symbol,
					timeframe,
					lastTimestamp,
				});
			}

			await delay(pollIntervalMs);
		}
	}
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

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
