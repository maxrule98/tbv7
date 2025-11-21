import {
	AccountConfig,
	AgenaiConfig,
	Candle,
	ExecutionMode,
	MacdAr4StrategyConfig,
	MomentumV3StrategyConfig,
	PositionSide,
	StrategyConfig,
	RiskConfig,
	StrategyId,
	TradeIntent,
	createLogger,
	loadAccountConfig,
	loadAgenaiConfig,
} from "@agenai/core";
import { macd } from "@agenai/indicators";
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
	HigherTimeframeTrend,
	HigherTimeframeTrendFetcher,
	MacdAr4Config,
	MacdAr4Strategy,
	MomentumV3Config,
	MomentumV3Strategy,
} from "@agenai/strategy-engine";

const logger = createLogger("trader-runtime");

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

export interface TraderStrategy {
	decide: (candles: Candle[], position: PositionSide) => Promise<TradeIntent>;
}

type StrategySource = "override" | "builder" | "registry";

interface StrategyLogContext {
	source: StrategySource;
	strategy: TraderStrategy;
	strategyConfig?: StrategyConfig;
	strategyId: StrategyId;
	traderConfig: TraderConfig;
	executionMode: ExecutionMode;
	builderName?: string;
	profiles?: {
		account?: string;
		strategy?: string;
		risk?: string;
		exchange?: string;
	};
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

	const strategySource: StrategySource = options.strategyOverride
		? "override"
		: options.strategyBuilder
		? "builder"
		: "registry";
	const strategy = options.strategyOverride
		? options.strategyOverride
		: options.strategyBuilder
		? await options.strategyBuilder(client)
		: createStrategyInstance(client, agenaiConfig.strategy);
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

	logger.info("trader_config", {
		symbol: traderConfig.symbol,
		timeframe: traderConfig.timeframe,
		useTestnet: traderConfig.useTestnet,
		executionMode,
		strategyId: resolvedStrategyId,
	});
	logStrategyLoaded({
		source: strategySource,
		strategy,
		strategyConfig:
			strategySource === "registry" ? agenaiConfig.strategy : undefined,
		strategyId: resolvedStrategyId,
		traderConfig,
		executionMode,
		builderName: options.strategyBuilder?.name,
		profiles: {
			account: options.accountProfile,
			strategy: options.strategyProfile,
			risk: options.riskProfile,
			exchange: options.exchangeProfile,
		},
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

const buildMacdAr4RuntimeConfig = (
	strategyConfig: MacdAr4StrategyConfig
): MacdAr4Config => {
	const { indicators, thresholds, higherTimeframe } = strategyConfig;
	return {
		emaFast: indicators.emaFast,
		emaSlow: indicators.emaSlow,
		signal: indicators.signal,
		arWindow: indicators.arWindow,
		minForecast: thresholds.minForecast,
		pullbackFast: indicators.pullbackFast,
		pullbackSlow: indicators.pullbackSlow,
		atrPeriod: indicators.atrPeriod,
		minAtr: thresholds.minAtr,
		maxAtr: thresholds.maxAtr,
		rsiPeriod: indicators.rsiPeriod,
		rsiLongRange: [thresholds.rsiLongLower, thresholds.rsiLongUpper],
		rsiShortRange: [thresholds.rsiShortLower, thresholds.rsiShortUpper],
		higherTimeframe,
	};
};

const buildMomentumV3RuntimeConfig = (
	strategyConfig: MomentumV3StrategyConfig
): MomentumV3Config => {
	return {
		atrPeriod: strategyConfig.atr.period,
		atrEmaPeriod: strategyConfig.atr.emaPeriod,
		volumeSmaPeriod: strategyConfig.volume.smaPeriod,
		volumeSpikeMultiplier: strategyConfig.volume.spikeMultiplier,
		breakoutLookback: strategyConfig.breakout.lookback,
		rsiPeriod: strategyConfig.rsi.period,
		rsiLongRange: [strategyConfig.rsi.longMin, strategyConfig.rsi.longMax],
		rsiShortRange: [strategyConfig.rsi.shortMin, strategyConfig.rsi.shortMax],
		macdFast: strategyConfig.htf.macdFast,
		macdSlow: strategyConfig.htf.macdSlow,
		macdSignal: strategyConfig.htf.macdSignal,
		htfTimeframe: strategyConfig.htf.timeframe,
	};
};

const createStrategyInstance = (
	client: MexcClient,
	strategyConfig: StrategyConfig
): TraderStrategy => {
	if (strategyConfig.id === "momentum_v3") {
		const runtimeConfig = buildMomentumV3RuntimeConfig(
			strategyConfig as MomentumV3StrategyConfig
		);
		const getHTFTrend = createHigherTimeframeTrendFetcher(client, {
			timeframe: strategyConfig.htf.timeframe,
			cacheMs: strategyConfig.htfCacheMs,
			deadband: strategyConfig.htf.deadband,
			emaFast: strategyConfig.htf.macdFast,
			emaSlow: strategyConfig.htf.macdSlow,
			signal: strategyConfig.htf.macdSignal,
		});
		return new MomentumV3Strategy(runtimeConfig, { getHTFTrend });
	}

	const macdConfig = buildMacdAr4RuntimeConfig(
		strategyConfig as MacdAr4StrategyConfig
	);
	const getHTFTrend = createHigherTimeframeTrendFetcher(client, {
		timeframe: macdConfig.higherTimeframe,
		cacheMs: strategyConfig.htfCacheMs,
		deadband: strategyConfig.thresholds.htfHistogramDeadband,
		emaFast: macdConfig.emaFast,
		emaSlow: macdConfig.emaSlow,
		signal: macdConfig.signal,
	});
	return new MacdAr4Strategy(macdConfig, { getHTFTrend });
};

interface HigherTimeframeFetcherOptions {
	cacheMs: number;
	deadband: number;
	emaFast: number;
	emaSlow: number;
	signal: number;
	timeframe: string;
}
const createHigherTimeframeTrendFetcher = (
	client: MexcClient,
	options: HigherTimeframeFetcherOptions
): HigherTimeframeTrendFetcher => {
	const cache = new Map<
		string,
		{ fetchedAt: number; trend: HigherTimeframeTrend | null }
	>();
	const lookback = Math.max(options.emaSlow * 4, 300);
	return async (symbol: string, timeframe = options.timeframe) => {
		const now = Date.now();
		const cached = cache.get(symbol);
		if (cached && now - cached.fetchedAt < options.cacheMs) {
			return cached.trend;
		}

		try {
			const candles = await client.fetchOHLCV(symbol, timeframe, lookback);
			const closes = candles.map((candle) => candle.close);
			const macdResult = macd(
				closes,
				options.emaFast,
				options.emaSlow,
				options.signal
			);
			const trend = deriveTrendFromHistogram(
				macdResult.histogram,
				options.deadband
			);
			cache.set(symbol, { trend, fetchedAt: now });
			return trend;
		} catch (error) {
			logger.error("htf_trend_error", {
				symbol,
				timeframe,
				message: error instanceof Error ? error.message : String(error),
			});
			return cached?.trend ?? null;
		}
	};
};

const deriveTrendFromHistogram = (
	histogram: number | null,
	deadband: number
): HigherTimeframeTrend => {
	if (histogram === null) {
		return { macdHist: null, isBull: false, isBear: false, isNeutral: true };
	}
	const isBull = histogram > deadband;
	const isBear = histogram < -deadband;
	return {
		macdHist: histogram,
		isBull,
		isBear,
		isNeutral: !isBull && !isBear,
	};
};

const getStrategyName = (strategy: TraderStrategy): string => {
	const ctorName =
		(strategy as { constructor?: { name?: string } })?.constructor?.name ??
		"AnonymousStrategy";
	return ctorName === "Object" ? "AnonymousStrategy" : ctorName;
};

const logStrategyLoaded = ({
	source,
	strategy,
	strategyConfig,
	strategyId,
	traderConfig,
	executionMode,
	builderName,
	profiles,
}: StrategyLogContext): void => {
	const pollInterval = traderConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	logger.info("strategy_loaded", {
		source,
		strategyId,
		strategyClass: getStrategyName(strategy),
		symbol: traderConfig.symbol,
		timeframe: traderConfig.timeframe,
		executionMode,
		useTestnet: traderConfig.useTestnet,
		pollIntervalMs: pollInterval,
		builder: builderName ?? null,
		profiles: profiles ?? null,
		configId: strategyConfig?.id ?? null,
	});
};

const logRiskConfig = (risk: RiskConfig): void => {
	logger.info("risk_config", {
		riskPerTradePercent: risk.riskPerTradePercent,
		minPositionSize: risk.minPositionSize,
		maxPositionSize: risk.maxPositionSize,
		slPct: risk.slPct,
		tpPct: risk.tpPct,
		trailingActivationPct: risk.trailingActivationPct,
		trailingTrailPct: risk.trailingTrailPct,
	});
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
			logger.warn("bootstrap_no_candles", { symbol, timeframe });
			return;
		}

		candlesBySymbol.set(symbol, candles);
		lastTimestampBySymbol.set(
			symbol,
			candles[candles.length - 1]?.timestamp ?? 0
		);
		logger.info("bootstrap_candles_loaded", {
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
				logger.warn("poll_no_candle", { symbol, timeframe });
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

				const intent = await strategy.decide(buffer, positionState.side);
				logStrategyDecision(latest, intent);

				if (intent.intent === "OPEN_LONG" || intent.intent === "CLOSE_LONG") {
					const plan = riskManager.plan(
						intent,
						latest.close,
						accountEquity,
						positionState.size
					);
					if (!plan) {
						logExecutionSkipped(
							intent,
							positionState.side,
							intent.intent === "CLOSE_LONG"
								? "no_position_to_close"
								: "risk_plan_rejected"
						);
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
				logger.debug("poll_no_update", {
					symbol,
					timeframe,
					lastTimestamp,
				});
			}
		}

		await delay(pollIntervalMs);
	}
};

const maybeHandleForcedExit = async (
	positionState: PaperPositionSnapshot,
	lastCandle: Candle,
	riskManager: RiskManager,
	executionEngine: ExecutionEngine,
	accountEquity: number
): Promise<boolean> => {
	if (positionState.side !== "LONG" || positionState.size <= 0) {
		return false;
	}

	const stopLossPrice = positionState.stopLossPrice;
	const takeProfitPrice = positionState.takeProfitPrice;
	const hitSL =
		typeof stopLossPrice === "number" && lastCandle.low <= stopLossPrice;
	const hitTP =
		typeof takeProfitPrice === "number" && lastCandle.high >= takeProfitPrice;

	if (!hitSL && !hitTP) {
		return false;
	}

	const reason = hitSL ? "stop_loss_hit" : "take_profit_hit";
	const forcedIntent: TradeIntent = {
		symbol: lastCandle.symbol,
		intent: "CLOSE_LONG",
		reason,
		timestamp: lastCandle.timestamp,
	};

	logStrategyDecision(lastCandle, forcedIntent);

	const plan = riskManager.plan(
		forcedIntent,
		lastCandle.close,
		accountEquity,
		positionState.size
	);
	if (!plan) {
		logExecutionSkipped(
			forcedIntent,
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

	logTradePlan(plan, lastCandle, forcedIntent);
	try {
		const result = await executionEngine.execute(plan, {
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
		}
	} catch (error) {
		logExecutionError(error, plan);
	}

	return true;
};

const maybeHandleTrailingStop = async (
	symbol: string,
	positionState: PaperPositionSnapshot,
	lastCandle: Candle,
	riskManager: RiskManager,
	executionEngine: ExecutionEngine,
	accountEquity: number,
	riskConfig: RiskConfig
): Promise<boolean> => {
	if (positionState.side !== "LONG" || positionState.size <= 0) {
		return false;
	}

	const entryPrice =
		positionState.entryPrice > 0
			? positionState.entryPrice
			: positionState.avgEntryPrice ?? 0;
	if (entryPrice <= 0) {
		return false;
	}

	const activationPct = Math.max(riskConfig.trailingActivationPct ?? 0, 0);
	const trailPct = Math.max(riskConfig.trailingTrailPct ?? 0, 0);
	if (trailPct <= 0) {
		return false;
	}

	let isTrailingActive = positionState.isTrailingActive;
	let peakPrice =
		positionState.peakPrice > 0 ? positionState.peakPrice : entryPrice;
	let trailingStopPrice =
		positionState.trailingStopPrice > 0
			? positionState.trailingStopPrice
			: positionState.stopLossPrice ?? 0;
	const updates: Partial<PaperPositionSnapshot> = {};

	if (
		!isTrailingActive &&
		lastCandle.close >= entryPrice * (1 + activationPct)
	) {
		isTrailingActive = true;
		updates.isTrailingActive = true;
	}

	if (!isTrailingActive) {
		if (Object.keys(updates).length) {
			executionEngine.updatePosition(symbol, updates);
		}
		return false;
	}

	peakPrice = Math.max(peakPrice, lastCandle.high);
	const proposedTrailing = peakPrice * (1 - trailPct);
	if (peakPrice !== positionState.peakPrice) {
		updates.peakPrice = peakPrice;
	}
	if (proposedTrailing > trailingStopPrice) {
		trailingStopPrice = proposedTrailing;
		updates.trailingStopPrice = trailingStopPrice;
	}

	if (Object.keys(updates).length) {
		executionEngine.updatePosition(symbol, updates);
	}

	if (trailingStopPrice <= 0 || lastCandle.low > trailingStopPrice) {
		return false;
	}

	const forcedIntent: TradeIntent = {
		symbol,
		intent: "CLOSE_LONG",
		reason: "trailing_stop_hit",
		timestamp: lastCandle.timestamp,
	};

	logStrategyDecision(lastCandle, forcedIntent);

	const plan = riskManager.plan(
		forcedIntent,
		lastCandle.close,
		accountEquity,
		positionState.size
	);
	if (!plan) {
		logExecutionSkipped(
			forcedIntent,
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

	logTradePlan(plan, lastCandle, forcedIntent);
	try {
		const result = await executionEngine.execute(plan, {
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
		}
	} catch (error) {
		logExecutionError(error, plan);
	}

	return true;
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
	logger.debug("latest_candle", payload);
};

const logStrategyDecision = (candle: Candle, intent: TradeIntent): void => {
	logger.info("strategy_decision", {
		symbol: candle.symbol,
		timestamp: new Date(candle.timestamp).toISOString(),
		close: candle.close,
		intent: intent.intent,
		reason: intent.reason,
	});
};

const logTradePlan = (
	plan: TradePlan,
	candle: Candle,
	intent: TradeIntent
): void => {
	logger.info("trade_plan", {
		symbol: plan.symbol,
		timestamp: new Date(candle.timestamp).toISOString(),
		intent: plan.reason,
		side: plan.side,
		quantity: plan.quantity,
		stopLossPrice: plan.stopLossPrice,
		takeProfitPrice: plan.takeProfitPrice,
		recommendations: intent.metadata?.recommendations ?? null,
	});
};

const logExecutionResult = (result: ExecutionResult): void => {
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

	logger.info(eventName, payload);
};

const logExecutionError = (error: unknown, plan: TradePlan): void => {
	logger.error("execution_error", {
		symbol: plan.symbol,
		side: plan.side,
		quantity: plan.quantity,
		message: error instanceof Error ? error.message : String(error),
	});
};

const logMarketDataError = (error: unknown): void => {
	logger.error("market_data_error", {
		message: error instanceof Error ? error.message : String(error),
	});
};

const logExecutionSkipped = (
	planOrIntent: TradePlan | TradeIntent,
	positionSide: PositionSide,
	reason: string
): void => {
	logger.info("execution_skipped", {
		symbol: planOrIntent.symbol,
		side: "side" in planOrIntent ? planOrIntent.side : planOrIntent.intent,
		positionSide,
		reason,
	});
};

const getPreExecutionSkipReason = (
	plan: TradePlan,
	positionState: PaperPositionSnapshot
): string | null => {
	if (plan.side === "buy" && positionState.side === "LONG") {
		return "already_long";
	}
	if (plan.side === "sell" && positionState.side === "FLAT") {
		return "already_flat";
	}
	return null;
};

const logPaperPosition = (
	symbol: string,
	position: PaperPositionSnapshot
): void => {
	logger.info("paper_position", {
		symbol,
		side: position.side,
		size: position.size,
		avgEntryPrice: position.avgEntryPrice,
		realizedPnl: position.realizedPnl,
		stopLossPrice: position.stopLossPrice,
		takeProfitPrice: position.takeProfitPrice,
		entryPrice: position.entryPrice,
		peakPrice: position.peakPrice,
		trailingStopPrice: position.trailingStopPrice,
		isTrailingActive: position.isTrailingActive,
	});
};

const snapshotPaperAccount = (
	executionEngine: ExecutionEngine,
	unrealizedPnl: number,
	symbol: string,
	timestamp: number
): PaperAccountSnapshot | null => {
	const snapshot = executionEngine.snapshotPaperAccount(unrealizedPnl);
	if (!snapshot) {
		return null;
	}

	logPaperAccountSnapshot(symbol, timestamp, snapshot);
	return snapshot;
};

const logAndSnapshotPosition = (
	executionEngine: ExecutionEngine,
	symbol: string,
	price: number,
	timestamp: number
): PaperAccountSnapshot | null => {
	const latestPosition = executionEngine.getPosition(symbol);
	logPaperPosition(symbol, latestPosition);
	return snapshotPaperAccount(
		executionEngine,
		calculateUnrealizedPnl(latestPosition, price),
		symbol,
		timestamp
	);
};

const logPaperAccountSnapshot = (
	symbol: string,
	timestamp: number,
	snapshot: PaperAccountSnapshot
): void => {
	logger.info("paper_account_snapshot", {
		symbol,
		timestamp: new Date(timestamp).toISOString(),
		snapshot,
	});
};

const calculateUnrealizedPnl = (
	position: PaperPositionSnapshot,
	price: number
): number => {
	if (position.side !== "LONG" || position.avgEntryPrice === null) {
		return 0;
	}

	return (price - position.avgEntryPrice) * position.size;
};

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
