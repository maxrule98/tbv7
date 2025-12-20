import {
	calculateATRSeries,
	calculateDailyVWAP,
	calculateRSI,
	ema,
} from "@agenai/indicators";
import { Candle, TradeIntent } from "../../types";
import {
	UltraAggressiveBtcUsdtConfig,
	UltraAggressiveRiskConfig,
	UltraAggressivePlayType,
	UltraAggressiveSessionFilters,
	UltraAggressiveSessionLabel,
	UltraAggressiveQualityFilters,
} from "./config";

export type TrendDirection = "TrendingUp" | "TrendingDown" | "Ranging";
export type VolatilityRegime = "low" | "balanced" | "high";

export interface IndicatorSnapshot {
	atr1m: number | null;
	atr5m: number | null;
	atrSeries: number[];
	emaFast: number | null;
	emaSlow: number | null;
	rsi: number | null;
	previousClose: number | null;
	vwap: number | null;
	vwapDeviationPct: number | null;
	cvdSeries: number[];
	cvdTrend: "up" | "down" | "flat";
	cvdDivergence: "bullish" | "bearish" | null;
	volumeAvgShort: number;
	volumeAvgLong: number;
}

export interface LevelSnapshot {
	dayHigh: number | null;
	dayLow: number | null;
	previousDayHigh: number | null;
	previousDayLow: number | null;
	rangeHigh: number | null;
	rangeLow: number | null;
	recentSwingHigh: number | null;
	recentSwingLow: number | null;
}

export type StrategySetups = Record<
	| "trendIgnitionLong"
	| "trendIgnitionShort"
	| "meanReversionLong"
	| "meanReversionShort"
	| "breakoutTrapLong"
	| "breakoutTrapShort"
	| "liquiditySweepLong"
	| "liquiditySweepShort",
	boolean
>;

export interface SetupDiagnosticsEntry {
	name: string;
	side: "long" | "short";
	active: boolean;
	checks: Record<string, boolean | number | string | null>;
}

export interface RiskControlState {
	lastExitReason: string | null;
	lastRealizedPnLPct: number | null;
	cooldownBarsRemaining: number;
	sessionPnLPct: number;
	rollingDrawdownPct: number;
}

export interface StrategyContextSnapshot {
	symbol: string;
	timeframe: string;
	timestamp: number;
	price: number;
	trendDirection: TrendDirection;
	volRegime: VolatilityRegime;
	indicator: IndicatorSnapshot;
	levels: LevelSnapshot;
	setups: StrategySetups;
	setupDiagnostics: SetupDiagnosticsEntry[];
	recentExecutionCandles: Candle[];
	sessionLabel: UltraAggressiveSessionLabel;
	utcHour: number;
	riskState: RiskControlState | null;
}

export interface SetupEvaluationResult {
	setups: StrategySetups;
	diagnostics: SetupDiagnosticsEntry[];
}

export interface SetupDecision {
	intent: TradeIntent["intent"];
	reason: string;
	stop: number | null;
	tp1: number | null;
	tp2: number | null;
	confidence: number;
	riskPerTradePct?: number;
}

const DEFAULT_PLAYTYPE_PRIORITY: UltraAggressivePlayType[] = [
	"liquiditySweep",
	"breakoutTrap",
	"breakout",
	"meanReversion",
];

export const buildStrategyContext = (
	executionCandles: Candle[],
	confirmingCandles: Candle[],
	contextCandles: Candle[],
	config: UltraAggressiveBtcUsdtConfig,
	riskState?: RiskControlState
): StrategyContextSnapshot => {
	const latest = executionCandles[executionCandles.length - 1];
	const indicator = computeIndicators(
		executionCandles,
		confirmingCandles,
		config
	);
	const levels = computeLevels(executionCandles, contextCandles, config);
	const trendDirection = classifyTrendDirection(
		confirmingCandles,
		indicator.vwap,
		config
	);
	const volRegime = computeVolRegime(
		indicator.atrSeries,
		indicator.atr1m,
		config
	);
	const { setups, diagnostics } = evaluateSetups(
		trendDirection,
		volRegime,
		indicator,
		levels,
		latest,
		config
	);
	const recentWindow = Math.min(
		Math.max(Math.floor(config.lookbacks.executionBars * 0.2), 5),
		50
	);
	const recentExecutionCandles = executionCandles.slice(-recentWindow);
	const utcHour = getUtcHour(latest.timestamp);
	const sessionLabel = classifySessionLabel(latest.timestamp);
	return {
		symbol: latest.symbol,
		timeframe: latest.timeframe,
		timestamp: latest.timestamp,
		price: latest.close,
		trendDirection,
		volRegime,
		indicator,
		levels,
		setups,
		setupDiagnostics: diagnostics,
		recentExecutionCandles,
		sessionLabel,
		utcHour,
		riskState: riskState ?? null,
	};
};

export const selectEntryDecision = (
	ctx: StrategyContextSnapshot,
	config: UltraAggressiveBtcUsdtConfig
): SetupDecision | null => {
	const priority = config.playTypePriority?.length
		? config.playTypePriority
		: DEFAULT_PLAYTYPE_PRIORITY;
	const candidates: Array<{
		decision: SetupDecision;
		priorityIndex: number;
	}> = [];

	const pushDecision = (
		active: boolean,
		intent: SetupDecision["intent"],
		reason: string,
		priorityIndex: number
	): void => {
		if (!active) {
			return;
		}
		if (!isIntentAllowedForSession(ctx, intent, config)) {
			return;
		}
		const decision = buildSetupDecision(ctx, intent, reason, config.risk);
		if (!passesQualityFilters(ctx, decision, config)) {
			return;
		}
		candidates.push({
			decision,
			priorityIndex,
		});
	};

	priority.forEach((playType, priorityIndex) => {
		switch (playType) {
			case "liquiditySweep":
				pushDecision(
					ctx.setups.liquiditySweepLong,
					"OPEN_LONG",
					"liquidity_sweep_long",
					priorityIndex
				);
				pushDecision(
					ctx.setups.liquiditySweepShort,
					"OPEN_SHORT",
					"liquidity_sweep_short",
					priorityIndex
				);
				break;
			case "breakoutTrap":
				pushDecision(
					ctx.setups.breakoutTrapLong,
					"OPEN_LONG",
					"breakout_trap_long",
					priorityIndex
				);
				pushDecision(
					ctx.setups.breakoutTrapShort,
					"OPEN_SHORT",
					"breakout_trap_short",
					priorityIndex
				);
				break;
			case "breakout":
				pushDecision(
					ctx.setups.trendIgnitionLong,
					"OPEN_LONG",
					"trend_ignition_long",
					priorityIndex
				);
				pushDecision(
					ctx.setups.trendIgnitionShort,
					"OPEN_SHORT",
					"trend_ignition_short",
					priorityIndex
				);
				break;
			case "meanReversion":
			default:
				pushDecision(
					ctx.setups.meanReversionLong,
					"OPEN_LONG",
					"mean_reversion_long",
					priorityIndex
				);
				pushDecision(
					ctx.setups.meanReversionShort,
					"OPEN_SHORT",
					"mean_reversion_short",
					priorityIndex
				);
				break;
		}
	});

	if (!candidates.length) {
		return null;
	}

	candidates.sort((a, b) => {
		if (a.priorityIndex !== b.priorityIndex) {
			return a.priorityIndex - b.priorityIndex;
		}
		return b.decision.confidence - a.decision.confidence;
	});

	return candidates[0]?.decision ?? null;
};

const isIntentAllowedForSession = (
	ctx: StrategyContextSnapshot,
	intent: SetupDecision["intent"],
	config: UltraAggressiveBtcUsdtConfig
): boolean => {
	const filters = config.sessionFilters;
	if (!filters?.enabled) {
		return true;
	}
	const side =
		intent === "OPEN_LONG" ? "long" : intent === "OPEN_SHORT" ? "short" : null;
	if (!side) {
		return true;
	}
	return passesSessionFilters(ctx, ctx.sessionLabel, side, filters);
};

const passesSessionFilters = (
	ctx: StrategyContextSnapshot,
	session: UltraAggressiveSessionLabel,
	side: "long" | "short",
	filters: UltraAggressiveSessionFilters
): boolean => {
	if (
		filters.allowedSessions?.length &&
		!filters.allowedSessions.includes(session)
	) {
		return false;
	}
	if (filters.blockedSessions?.includes(session)) {
		return false;
	}
	const trendOverride =
		side === "long" &&
		filters.allowLongsWhenTrendingUp?.includes(session) &&
		ctx.trendDirection === "TrendingUp";
	if (side === "long") {
		if (
			filters.allowedLongSessions?.length &&
			!filters.allowedLongSessions.includes(session) &&
			!trendOverride
		) {
			return false;
		}
		if (filters.blockedLongSessions?.includes(session) && !trendOverride) {
			return false;
		}
		return true;
	}
	if (
		filters.allowedShortSessions?.length &&
		!filters.allowedShortSessions.includes(session)
	) {
		return false;
	}
	if (filters.blockedShortSessions?.includes(session)) {
		return false;
	}
	return true;
};

const passesQualityFilters = (
	ctx: StrategyContextSnapshot,
	decision: SetupDecision,
	config: UltraAggressiveBtcUsdtConfig
): boolean => {
	const filters: UltraAggressiveQualityFilters | undefined =
		config.qualityFilters;
	if (!filters) {
		return true;
	}
	const playType = getPlayTypeFromReason(decision.reason);
	const isLong = decision.intent === "OPEN_LONG";
	const isShort = decision.intent === "OPEN_SHORT";
	const requiredConfidence = Math.max(
		filters.minConfidence ?? 0,
		playType && filters.playTypeMinConfidence?.[playType]
			? (filters.playTypeMinConfidence[playType] ?? 0)
			: 0
	);
	if (
		requiredConfidence > 0 &&
		decision.confidence < Number(requiredConfidence.toFixed(2))
	) {
		return false;
	}
	const cvdAligned = isCvdAlignedWithIntent(
		ctx.indicator.cvdTrend,
		decision.intent
	);
	if (filters.requireCvdAlignment && !cvdAligned) {
		if (!(isShort && filters.allowShortsAgainstCvd)) {
			return false;
		}
	}
	const trendSlopePct = getTrendSlopePct(ctx.recentExecutionCandles);
	const slopeMagnitude = Math.abs(trendSlopePct);
	const vwapDeviation = ctx.indicator.vwapDeviationPct;
	if (
		isLong &&
		filters.requireStrongLongCvd &&
		ctx.indicator.cvdTrend !== "up"
	) {
		return false;
	}
	if (
		isLong &&
		typeof filters.minLongTrendSlopePct === "number" &&
		trendSlopePct < filters.minLongTrendSlopePct
	) {
		return false;
	}
	if (
		isShort &&
		typeof filters.minShortTrendSlopePct === "number" &&
		trendSlopePct > -Math.abs(filters.minShortTrendSlopePct)
	) {
		return false;
	}
	if (isLong && typeof filters.requireLongDiscountToVwapPct === "number") {
		const longThreshold = Math.abs(filters.requireLongDiscountToVwapPct);
		if (vwapDeviation === null || vwapDeviation > -longThreshold) {
			return false;
		}
	}
	if (isShort && typeof filters.requireShortPremiumToVwapPct === "number") {
		const shortThreshold = Math.abs(filters.requireShortPremiumToVwapPct);
		if (vwapDeviation === null || vwapDeviation < shortThreshold) {
			return false;
		}
	}
	if (
		playType === "meanReversion" &&
		filters.maxVolatilityForMeanReversion &&
		compareVolRegime(ctx.volRegime, filters.maxVolatilityForMeanReversion) > 0
	) {
		return false;
	}
	if (
		(playType === "meanReversion" ||
			playType === "liquiditySweep" ||
			playType === "breakoutTrap") &&
		filters.maxTrendSlopePctForCounterTrend
	) {
		if (slopeMagnitude >= filters.maxTrendSlopePctForCounterTrend) {
			return false;
		}
	}
	return true;
};

const VOLATILITY_RANK: Record<VolatilityRegime, number> = {
	low: 0,
	balanced: 1,
	high: 2,
};

const compareVolRegime = (
	current: VolatilityRegime,
	maxAllowed: "low" | "balanced" | "high"
): number => VOLATILITY_RANK[current] - VOLATILITY_RANK[maxAllowed];

const isCvdAlignedWithIntent = (
	trend: IndicatorSnapshot["cvdTrend"],
	intent: SetupDecision["intent"]
): boolean => {
	if (!trend || trend === "flat" || intent === "NO_ACTION") {
		return true;
	}
	if (intent === "OPEN_LONG") {
		return trend !== "down";
	}
	if (intent === "OPEN_SHORT") {
		return trend !== "up";
	}
	return true;
};

function getPlayTypeFromReason(reason: string): UltraAggressivePlayType | null {
	if (reason.includes("liquidity_sweep")) {
		return "liquiditySweep";
	}
	if (reason.includes("breakout_trap")) {
		return "breakoutTrap";
	}
	if (reason.includes("trend_ignition")) {
		return "breakout";
	}
	if (reason.includes("mean_reversion")) {
		return "meanReversion";
	}
	return null;
}

const computeIndicators = (
	executionCandles: Candle[],
	confirmingCandles: Candle[],
	config: UltraAggressiveBtcUsdtConfig
): IndicatorSnapshot => {
	const atrSeries = calculateATRSeries(executionCandles, config.atrPeriod1m);
	const atr1m = atrSeries.length ? atrSeries[atrSeries.length - 1] : null;
	const atr5mSeries = calculateATRSeries(confirmingCandles, config.atrPeriod5m);
	const atr5m = atr5mSeries.length ? atr5mSeries[atr5mSeries.length - 1] : null;
	const closes = executionCandles.map((c) => c.close);
	const emaFast = ema(closes, config.emaFastPeriod);
	const emaSlow = ema(closes, config.emaSlowPeriod);
	const rsi = calculateRSI(closes, config.rsiPeriod);
	const previousClose = closes.length > 1 ? closes[closes.length - 2] : null;
	const volumeAvgShort = averageVolumeFromCandles(
		executionCandles,
		Math.min(20, executionCandles.length)
	);
	const volumeAvgLong = averageVolumeFromCandles(
		executionCandles,
		Math.min(60, executionCandles.length)
	);
	const vwap = calculateDailyVWAP(executionCandles);
	const price = executionCandles[executionCandles.length - 1].close;
	const vwapDeviationPct = vwap && vwap !== 0 ? (price - vwap) / vwap : null;
	const cvdSeries = computeCvdSeries(executionCandles, config.lookbacks.cvd);
	const cvdTrend = classifyCvdTrend(cvdSeries);
	const cvdDivergence = detectCvdDivergence(
		executionCandles,
		cvdSeries,
		config.thresholds.cvdDivergenceThreshold
	);
	return {
		atr1m,
		atr5m,
		atrSeries,
		emaFast,
		emaSlow,
		rsi,
		previousClose,
		vwap,
		vwapDeviationPct,
		cvdSeries,
		cvdTrend,
		cvdDivergence,
		volumeAvgShort,
		volumeAvgLong,
	};
};

const computeLevels = (
	executionCandles: Candle[],
	contextCandles: Candle[],
	config: UltraAggressiveBtcUsdtConfig
): LevelSnapshot => {
	const latest = executionCandles[executionCandles.length - 1];
	const sameDay = filterByUtcDay(executionCandles, latest.timestamp);
	const previousDay = filterByUtcDay(
		executionCandles,
		latest.timestamp - 24 * 60 * 60 * 1000
	);
	const executionRange = executionCandles.slice(
		-config.lookbacks.rangeDetection
	);
	const contextRange = contextCandles.slice(
		-config.lookbacks.rangeDetection * 2
	);
	const combinedRange = executionRange.length ? executionRange : contextRange;

	return {
		dayHigh: sameDay.length ? Math.max(...sameDay.map((c) => c.high)) : null,
		dayLow: sameDay.length ? Math.min(...sameDay.map((c) => c.low)) : null,
		previousDayHigh: previousDay.length
			? Math.max(...previousDay.map((c) => c.high))
			: null,
		previousDayLow: previousDay.length
			? Math.min(...previousDay.map((c) => c.low))
			: null,
		rangeHigh: combinedRange.length
			? Math.max(...combinedRange.map((c) => c.high))
			: null,
		rangeLow: combinedRange.length
			? Math.min(...combinedRange.map((c) => c.low))
			: null,
		recentSwingHigh: findRecentSwing(executionRange, "high"),
		recentSwingLow: findRecentSwing(executionRange, "low"),
	};
};

const evaluateSetups = (
	trendDirection: TrendDirection,
	volRegime: VolatilityRegime,
	indicator: IndicatorSnapshot,
	levels: LevelSnapshot,
	latest: Candle,
	config: UltraAggressiveBtcUsdtConfig
): SetupEvaluationResult => {
	const diagEntries: SetupDiagnosticsEntry[] = [];
	const trendIgnitionLongEval = detectTrendIgnition(
		"long",
		trendDirection,
		volRegime,
		indicator,
		levels,
		latest,
		config
	);
	diagEntries.push(trendIgnitionLongEval);
	const trendIgnitionShortEval = detectTrendIgnition(
		"short",
		trendDirection,
		volRegime,
		indicator,
		levels,
		latest,
		config
	);
	diagEntries.push(trendIgnitionShortEval);
	const meanRevLongEval = detectMeanReversion(
		"long",
		trendDirection,
		indicator,
		levels,
		latest,
		config
	);
	diagEntries.push(meanRevLongEval);
	const meanRevShortEval = detectMeanReversion(
		"short",
		trendDirection,
		indicator,
		levels,
		latest,
		config
	);
	diagEntries.push(meanRevShortEval);
	const breakoutTrapLongEval = detectBreakoutTrap(
		"long",
		trendDirection,
		indicator,
		levels,
		latest,
		config
	);
	diagEntries.push(breakoutTrapLongEval);
	const breakoutTrapShortEval = detectBreakoutTrap(
		"short",
		trendDirection,
		indicator,
		levels,
		latest,
		config
	);
	diagEntries.push(breakoutTrapShortEval);
	const liquidityLongEval = detectLiquiditySweep(
		"long",
		indicator,
		levels,
		latest,
		config
	);
	diagEntries.push(liquidityLongEval);
	const liquidityShortEval = detectLiquiditySweep(
		"short",
		indicator,
		levels,
		latest,
		config
	);
	diagEntries.push(liquidityShortEval);

	const setups: StrategySetups = {
		trendIgnitionLong: trendIgnitionLongEval.active,
		trendIgnitionShort: trendIgnitionShortEval.active,
		meanReversionLong: meanRevLongEval.active,
		meanReversionShort: meanRevShortEval.active,
		breakoutTrapLong: breakoutTrapLongEval.active,
		breakoutTrapShort: breakoutTrapShortEval.active,
		liquiditySweepLong: liquidityLongEval.active,
		liquiditySweepShort: liquidityShortEval.active,
	};

	return { setups, diagnostics: diagEntries };
};

/**
 * Dynamic risk scaling: Use max risk (3%) for A+ setups, base risk (2.5%) otherwise
 * A+ = liquiditySweep with confidence >= 30%
 */
const getDynamicRiskPct = (
	reason: string,
	confidence: number,
	risk: UltraAggressiveRiskConfig
): number => {
	const maxRisk = risk.maxRiskPerTradePct ?? risk.riskPerTradePct;
	const baseRisk = risk.riskPerTradePct;

	// Liquidity sweep with high confidence gets max risk
	if (reason.includes("liquidity_sweep") && confidence >= 0.3) {
		return maxRisk;
	}

	// Breakout with very high confidence gets max risk
	if (reason.includes("trend_ignition") && confidence >= 0.35) {
		return maxRisk;
	}

	// All other setups use base risk
	return baseRisk;
};

const buildSetupDecision = (
	ctx: StrategyContextSnapshot,
	intent: SetupDecision["intent"],
	reason: string,
	risk: UltraAggressiveRiskConfig
): SetupDecision => {
	const confidence = computeConfidenceScore(ctx, intent, reason);
	const dynamicRiskPct = getDynamicRiskPct(reason, confidence, risk);

	const sideMultiplier = intent === "OPEN_LONG" ? 1 : -1;
	const stopDistance =
		(ctx.indicator.atr1m ?? ctx.price * 0.002) * risk.atrStopMultiple;
	const stop = ctx.price - sideMultiplier * stopDistance;
	const tp1 = ctx.price + sideMultiplier * stopDistance * risk.partialTpRR;
	const tp2 = ctx.price + sideMultiplier * stopDistance * risk.finalTpRR;

	return {
		intent,
		reason,
		stop,
		tp1,
		tp2,
		confidence,
		riskPerTradePct: dynamicRiskPct,
	};
};

export const evaluateRiskBlocks = (
	ctx: StrategyContextSnapshot,
	config: UltraAggressiveBtcUsdtConfig
): string | null => {
	const state = ctx.riskState;
	if (!state) {
		return null;
	}
	if (config.cooldownAfterStopoutBars > 0 && state.cooldownBarsRemaining > 0) {
		return "cooldownBlock";
	}
	if (
		config.equityThrottle?.enabled &&
		config.equityThrottle.maxDrawdownPct > 0 &&
		state.rollingDrawdownPct <= -config.equityThrottle.maxDrawdownPct
	) {
		return "equityThrottle";
	}
	if (
		config.dailyDrawdownLimitPct > 0 &&
		state.sessionPnLPct <= -config.dailyDrawdownLimitPct
	) {
		return "drawdownLimit";
	}
	return null;
};

const getUtcHour = (timestamp: number): number =>
	new Date(timestamp).getUTCHours();

const classifySessionLabel = (
	timestamp: number
): UltraAggressiveSessionLabel => {
	const hour = getUtcHour(timestamp);
	if (hour < 8) {
		return "asia";
	}
	if (hour < 16) {
		return "eu";
	}
	return "us";
};

const classifyTrendDirection = (
	confirmingCandles: Candle[],
	vwap: number | null,
	config: UltraAggressiveBtcUsdtConfig
): TrendDirection => {
	const lookback = config.lookbacks.trendCandles;
	const sample = confirmingCandles.slice(-lookback);
	if (sample.length < 2) {
		return "Ranging";
	}
	const start = sample[0].close;
	const end = sample[sample.length - 1].close;
	const slope = end - start;
	if (slope > 0 && (!vwap || end >= vwap)) {
		return "TrendingUp";
	}
	if (slope < 0 && (!vwap || end <= vwap)) {
		return "TrendingDown";
	}
	return "Ranging";
};

const computeVolRegime = (
	atrSeries: number[],
	latestAtr: number | null,
	config: UltraAggressiveBtcUsdtConfig
): VolatilityRegime => {
	if (!latestAtr || !atrSeries.length) {
		return "balanced";
	}
	const lookback = Math.min(config.lookbacks.volatility, atrSeries.length);
	const sample = atrSeries.slice(-lookback);
	const median = computeMedian(sample);
	if (!median) {
		return "balanced";
	}
	if (latestAtr >= median * 1.25) {
		return "high";
	}
	if (latestAtr <= median * 0.8) {
		return "low";
	}
	return "balanced";
};

const computeCvdSeries = (candles: Candle[], lookback: number): number[] => {
	const sample = candles.slice(-lookback);
	let cvd = 0;
	const series: number[] = [];
	for (const candle of sample) {
		const delta = candle.close >= candle.open ? candle.volume : -candle.volume;
		cvd += delta;
		series.push(Number(cvd.toFixed(2)));
	}
	return series;
};

const classifyCvdTrend = (series: number[]): "up" | "down" | "flat" => {
	if (series.length < 2) {
		return "flat";
	}
	const change = series[series.length - 1] - series[0];
	if (change > 0) {
		return "up";
	}
	if (change < 0) {
		return "down";
	}
	return "flat";
};

const detectCvdDivergence = (
	candles: Candle[],
	cvdSeries: number[],
	threshold: number
): "bullish" | "bearish" | null => {
	if (candles.length < 5 || cvdSeries.length < 5) {
		return null;
	}
	const priceLast = candles[candles.length - 1].close;
	const pricePrev = candles[candles.length - 4].close;
	const cvdLast = cvdSeries[cvdSeries.length - 1];
	const cvdPrev = cvdSeries[cvdSeries.length - 4];
	const priceDelta = priceLast - pricePrev;
	const cvdDelta = cvdLast - cvdPrev;
	if (priceDelta > threshold && cvdDelta < -threshold) {
		return "bearish";
	}
	if (priceDelta < -threshold && cvdDelta > threshold) {
		return "bullish";
	}
	return null;
};

const filterByUtcDay = (candles: Candle[], referenceTs: number): Candle[] => {
	const date = new Date(referenceTs);
	const start = Date.UTC(
		date.getUTCFullYear(),
		date.getUTCMonth(),
		date.getUTCDate()
	);
	const end = start + 24 * 60 * 60 * 1000;
	return candles.filter(
		(candle) => candle.timestamp >= start && candle.timestamp < end
	);
};

const findRecentSwing = (
	candles: Candle[],
	direction: "high" | "low"
): number | null => {
	if (candles.length < 3) {
		return null;
	}
	for (let i = candles.length - 2; i >= 1; i -= 1) {
		const prev = candles[i - 1];
		const curr = candles[i];
		const next = candles[i + 1];
		if (
			direction === "high" &&
			curr.high > prev.high &&
			curr.high > next.high
		) {
			return curr.high;
		}
		if (direction === "low" && curr.low < prev.low && curr.low < next.low) {
			return curr.low;
		}
	}
	return null;
};

const detectTrendIgnition = (
	side: "long" | "short",
	trendDirection: TrendDirection,
	volRegime: VolatilityRegime,
	indicator: IndicatorSnapshot,
	levels: LevelSnapshot,
	latest: Candle,
	config: UltraAggressiveBtcUsdtConfig
): SetupDiagnosticsEntry => {
	const isLong = side === "long";
	const trending = isLong
		? trendDirection === "TrendingUp"
		: trendDirection === "TrendingDown";
	const volOk = volRegime !== "low";
	const hasVwap = indicator.vwap !== null;
	const priceVsVwap = indicator.vwapDeviationPct ?? 0;
	const priceAlignment = isLong ? priceVsVwap >= 0 : priceVsVwap <= 0;
	const breakoutRef = isLong ? levels.rangeHigh : levels.rangeLow;
	const breakout = !!breakoutRef
		? isLong
			? latest.close > breakoutRef * 1.001
			: latest.close < breakoutRef * 0.999
		: false;
	const body = Math.abs(latest.close - latest.open);
	const atr = indicator.atr1m ?? 0;
	const wideBody =
		atr > 0 && body >= atr * config.thresholds.breakoutAtrMultiple;
	const referenceVolume =
		indicator.volumeAvgShort || indicator.volumeAvgLong || latest.volume;
	const highVolume =
		referenceVolume > 0 &&
		latest.volume >= referenceVolume * config.thresholds.breakoutVolumeMultiple;
	const cvdOk =
		indicator.cvdTrend === (isLong ? "up" : "down") &&
		indicator.cvdDivergence !== (isLong ? "bearish" : "bullish");
	const prevClose = indicator.previousClose;
	const priorBreakout = !!breakoutRef
		? prevClose !== null
			? isLong
				? prevClose > breakoutRef * 1.001
				: prevClose < breakoutRef * 0.999
			: false
		: false;
	const breakoutConfirmed = breakout && priorBreakout;
	const rsi = indicator.rsi;
	const breakoutOverride =
		config.allowBreakoutsWhenRSIOverbought &&
		rsi !== null &&
		((isLong && rsi >= config.thresholds.rsiOverbought) ||
			(!isLong && rsi <= config.thresholds.rsiOversold)) &&
		highVolume &&
		cvdOk;
	const active =
		trending &&
		volOk &&
		hasVwap &&
		!!breakoutRef &&
		cvdOk &&
		((priceAlignment && breakoutConfirmed && wideBody && highVolume) ||
			breakoutOverride);
	return {
		name: `trendIgnition${isLong ? "Long" : "Short"}`,
		side,
		active,
		checks: {
			trending,
			volOk,
			hasVwap,
			priceVsVwap,
			priceAlignment,
			breakoutRef: breakoutRef ?? null,
			breakout,
			priorBreakout,
			breakoutConfirmed,
			wideBody,
			highVolume,
			cvdOk,
			rsi,
			breakoutOverride,
		},
	};
};

const detectMeanReversion = (
	side: "long" | "short",
	trendDirection: TrendDirection,
	indicator: IndicatorSnapshot,
	levels: LevelSnapshot,
	latest: Candle,
	config: UltraAggressiveBtcUsdtConfig
): SetupDiagnosticsEntry => {
	const trendFilterOk = !(
		(trendDirection === "TrendingUp" && side === "short") ||
		(trendDirection === "TrendingDown" && side === "long")
	);
	const stretchPct = indicator.vwapDeviationPct ?? 0;
	const overExtended =
		side === "short"
			? stretchPct > config.thresholds.vwapStretchPct
			: stretchPct < -config.thresholds.vwapStretchPct;
	const anchor =
		side === "short"
			? (levels.dayHigh ?? levels.rangeHigh)
			: (levels.dayLow ?? levels.rangeLow);
	const proximity = config.thresholds.vwapStretchPct;
	const nearExtreme =
		anchor !== null
			? side === "short"
				? latest.high >= anchor * (1 - proximity)
				: latest.low <= anchor * (1 + proximity)
			: false;
	const rsi = indicator.rsi;
	const rsiCondition =
		rsi !== null
			? side === "short"
				? rsi >= config.thresholds.rsiOverbought
				: rsi <= config.thresholds.rsiOversold
			: false;
	const atr = indicator.atr1m ?? 0;
	const impulse =
		atr > 0 &&
		Math.abs(latest.close - latest.open) >=
			atr * config.thresholds.meanRevStretchAtr;
	const divergence =
		indicator.cvdDivergence === (side === "short" ? "bearish" : "bullish");
	const reversionSignalCount = [overExtended, rsiCondition, divergence].filter(
		(flag) => flag
	).length;
	const reversionSignalsOk = config.reversionNeedsTwoOfThreeConditions
		? reversionSignalCount >= 2
		: overExtended && rsiCondition && divergence;
	const active =
		trendFilterOk &&
		reversionSignalsOk &&
		anchor !== null &&
		nearExtreme &&
		impulse;
	return {
		name: `meanReversion${side === "long" ? "Long" : "Short"}`,
		side,
		active,
		checks: {
			trendFilterOk,
			stretchPct,
			overExtended,
			anchor: anchor ?? null,
			nearExtreme,
			rsi,
			rsiCondition,
			atr,
			impulse,
			divergence,
			reversionSignalCount,
			reversionSignalsOk,
		},
	};
};

const detectBreakoutTrap = (
	side: "long" | "short",
	trendDirection: TrendDirection,
	indicator: IndicatorSnapshot,
	levels: LevelSnapshot,
	latest: Candle,
	config: UltraAggressiveBtcUsdtConfig
): SetupDiagnosticsEntry => {
	const isLong = side === "long";
	const rangeContext = trendDirection === "Ranging";
	const keyLevel = isLong
		? (levels.rangeLow ?? levels.previousDayLow ?? levels.dayLow)
		: (levels.rangeHigh ?? levels.previousDayHigh ?? levels.dayHigh);
	const proximity = config.thresholds.vwapStretchPct;

	const overshoot = isLong
		? keyLevel !== null && latest.low < keyLevel * (1 - proximity)
		: keyLevel !== null && latest.high > keyLevel * (1 + proximity);
	const reEntry = isLong
		? keyLevel !== null && latest.close > keyLevel
		: keyLevel !== null && latest.close < keyLevel;
	const volumeControlled =
		indicator.volumeAvgShort > 0 &&
		latest.volume <=
			indicator.volumeAvgShort * config.thresholds.trapVolumeMaxMultiple;
	const orderFlowReject = isLong
		? indicator.cvdDivergence === "bullish" || indicator.cvdTrend === "up"
		: indicator.cvdDivergence === "bearish" || indicator.cvdTrend === "down";
	const wickReclaim = overshoot && reEntry;
	const vwapFlat =
		indicator.vwap === null ||
		Math.abs(indicator.vwapDeviationPct ?? 0) <=
			config.thresholds.vwapStretchPct * 0.5;
	const trapOverride =
		!rangeContext &&
		keyLevel !== null &&
		wickReclaim &&
		volumeControlled &&
		orderFlowReject &&
		vwapFlat;
	const active =
		(rangeContext &&
			keyLevel !== null &&
			overshoot &&
			reEntry &&
			volumeControlled &&
			orderFlowReject) ||
		trapOverride;
	return {
		name: `breakoutTrap${isLong ? "Long" : "Short"}`,
		side,
		active,
		checks: {
			rangeContext,
			keyLevel: keyLevel ?? null,
			overshoot,
			reEntry,
			volumeControlled,
			orderFlowReject,
			vwapFlat,
			trapOverride,
		},
	};
};

const detectLiquiditySweep = (
	side: "long" | "short",
	indicator: IndicatorSnapshot,
	levels: LevelSnapshot,
	latest: Candle,
	config: UltraAggressiveBtcUsdtConfig
): SetupDiagnosticsEntry => {
	const isLong = side === "long";
	const referenceLevel = isLong
		? (levels.recentSwingLow ?? levels.dayLow ?? levels.previousDayLow)
		: (levels.recentSwingHigh ?? levels.dayHigh ?? levels.previousDayHigh);
	const atr = indicator.atr1m ?? 0;
	const wickSize = referenceLevel
		? isLong
			? referenceLevel - latest.low
			: latest.high - referenceLevel
		: 0;
	const wickLarge = referenceLevel
		? atr
			? wickSize >= atr * config.thresholds.liquiditySweepWickMultiple
			: wickSize / referenceLevel >= config.thresholds.vwapStretchPct
		: false;
	const reclaimed = referenceLevel
		? isLong
			? latest.close > referenceLevel
			: latest.close < referenceLevel
		: false;
	const vwapDeviation = indicator.vwapDeviationPct ?? 0;
	const vwapFlat =
		indicator.vwap === null ||
		Math.abs(vwapDeviation) <= config.thresholds.vwapStretchPct * 0.5;
	const divergenceMatch =
		indicator.cvdDivergence === (isLong ? "bullish" : "bearish");
	const flowConfirmed =
		divergenceMatch || indicator.cvdTrend === (isLong ? "up" : "down");
	const divergenceOk =
		flowConfirmed && (divergenceMatch || (vwapFlat && reclaimed));
	const active =
		referenceLevel !== null && wickLarge && reclaimed && divergenceOk;
	return {
		name: `liquiditySweep${isLong ? "Long" : "Short"}`,
		side,
		active,
		checks: {
			referenceLevel: referenceLevel ?? null,
			atr,
			wickSize,
			wickLarge,
			reclaimed,
			divergence: divergenceMatch,
			flowConfirmed,
			vwapFlat,
		},
	};
};

const getTrendSlopePct = (candles: Candle[]): number => {
	if (candles.length < 2) {
		return 0;
	}
	const first = candles[0].close;
	const last = candles[candles.length - 1].close;
	if (!first) {
		return 0;
	}
	return (last - first) / first;
};

const computeConfidenceScore = (
	ctx: StrategyContextSnapshot,
	intent: SetupDecision["intent"],
	reason: string
): number => {
	let score = 0.5;
	const isLong = intent === "OPEN_LONG";
	const playType = getPlayTypeFromReason(reason);
	const slope = Math.abs(getTrendSlopePct(ctx.recentExecutionCandles));
	const atrPct = ctx.indicator.atr1m
		? ctx.indicator.atr1m / Math.max(ctx.price, 1)
		: 0;
	const rsi = ctx.indicator.rsi;
	const lastRealized = ctx.riskState?.lastRealizedPnLPct ?? 0;

	if (reason.includes("trend_ignition")) {
		score += ctx.volRegime === "high" ? 0.2 : 0.1;
		score +=
			ctx.trendDirection === (isLong ? "TrendingUp" : "TrendingDown") ? 0.2 : 0;
		score += Math.min(0.2, slope * 20);
	}
	if (reason.includes("liquidity_sweep")) {
		score += ctx.indicator.cvdDivergence ? 0.2 : 0;
		score += ctx.volRegime !== "high" ? 0.1 : 0;
		score -= Math.min(0.2, slope * 25);
		if (atrPct > 0.004) {
			score -= 0.1;
		}
	}
	if (reason.includes("mean_reversion") || reason.includes("breakout_trap")) {
		score += ctx.volRegime !== "high" ? 0.15 : -0.05;
		score += ctx.indicator.cvdDivergence ? 0.1 : 0;
		score -= Math.min(0.2, slope * 25);
		if (atrPct > 0.004) {
			score -= 0.05;
		}
	}
	if (
		playType &&
		(playType === "meanReversion" || playType === "liquiditySweep") &&
		ctx.trendDirection === (isLong ? "TrendingDown" : "TrendingUp")
	) {
		score -= 0.05;
	}
	const cvdTrend = ctx.indicator.cvdTrend;
	if (cvdTrend && cvdTrend !== "flat") {
		if (isLong && cvdTrend === "up") {
			score += 0.05;
		} else if (!isLong && cvdTrend === "down") {
			score += 0.05;
		} else {
			score -= 0.05;
		}
	}
	if (rsi !== null) {
		if (isLong && rsi < 35) {
			score += 0.05;
		} else if (!isLong && rsi > 65) {
			score += 0.05;
		}
	}
	if (ctx.riskState?.lastExitReason === "perTradeDrawdown") {
		score -= 0.1;
	}
	if (lastRealized > 0) {
		score += 0.02;
	} else if (lastRealized < 0) {
		score -= 0.05;
	}
	return Number(Math.min(1, Math.max(0, score)).toFixed(2));
};

const computeMedian = (values: number[]): number => {
	if (!values.length) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[middle - 1] + sorted[middle]) / 2;
	}
	return sorted[middle];
};

const averageVolumeFromCandles = (
	candles: Candle[],
	length: number
): number => {
	if (!candles.length || length <= 0) {
		return 0;
	}
	const slice = candles.slice(-length);
	const total = slice.reduce((acc, candle) => acc + candle.volume, 0);
	return total / slice.length;
};
