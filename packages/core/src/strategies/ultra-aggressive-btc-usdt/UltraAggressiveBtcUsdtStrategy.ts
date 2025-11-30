import fs from "node:fs";
import path from "node:path";
import {
	calculateATRSeries,
	calculateDailyVWAP,
	calculateRSI,
	ema,
} from "@agenai/indicators";
import { getWorkspaceRoot } from "../../config";
import {
	MultiTimeframeCache,
	MultiTimeframeCacheOptions,
	createMTFCache,
} from "../../data/multiTimeframeCache";
import { Candle, PositionSide, TradeIntent } from "../../types";
import { createLogger } from "../../utils/logger";

const strategyLogger = createLogger("ultra-agg-btc-usdt");

export type TrendDirection = "TrendingUp" | "TrendingDown" | "Ranging";
export type VolatilityRegime = "low" | "balanced" | "high";

export interface UltraAggressiveRiskConfig {
	riskPerTradePct: number;
	atrStopMultiple: number;
	partialTpRR: number;
	finalTpRR: number;
	trailingAtrMultiple: number;
}

export interface UltraAggressiveThresholds {
	vwapStretchPct: number;
	breakoutVolumeMultiple: number;
	breakoutAtrMultiple: number;
	meanRevStretchAtr: number;
	liquiditySweepWickMultiple: number;
	trapVolumeMaxMultiple: number;
	cvdDivergenceThreshold: number;
	rsiOverbought: number;
	rsiOversold: number;
}

export interface UltraAggressiveLookbacks {
	executionBars: number;
	breakoutRange: number;
	rangeDetection: number;
	trendCandles: number;
	volatility: number;
	cvd: number;
}

export interface UltraAggressiveBtcUsdtConfig {
	name: string;
	symbol: string;
	timeframes: {
		execution: string;
		confirming: string;
		context: string;
	};
	cacheTTLms: number;
	atrPeriod1m: number;
	atrPeriod5m: number;
	emaFastPeriod: number;
	emaSlowPeriod: number;
	rsiPeriod: number;
	lookbacks: UltraAggressiveLookbacks;
	thresholds: UltraAggressiveThresholds;
	risk: UltraAggressiveRiskConfig;
	maxTradeDurationMinutes: number;
}

export interface UltraAggressiveDeps {
	cache: MultiTimeframeCache;
}

interface IndicatorSnapshot {
	atr1m: number | null;
	atr5m: number | null;
	atrSeries: number[];
	emaFast: number | null;
	emaSlow: number | null;
	rsi: number | null;
	vwap: number | null;
	vwapDeviationPct: number | null;
	cvdSeries: number[];
	cvdTrend: "up" | "down" | "flat";
	cvdDivergence: "bullish" | "bearish" | null;
	volumeAvgShort: number;
	volumeAvgLong: number;
}

interface LevelSnapshot {
	dayHigh: number | null;
	dayLow: number | null;
	previousDayHigh: number | null;
	previousDayLow: number | null;
	rangeHigh: number | null;
	rangeLow: number | null;
	recentSwingHigh: number | null;
	recentSwingLow: number | null;
}

interface StrategyContextSnapshot {
	symbol: string;
	timeframe: string;
	timestamp: number;
	price: number;
	trendDirection: TrendDirection;
	volRegime: VolatilityRegime;
	indicator: IndicatorSnapshot;
	levels: LevelSnapshot;
	setups: StrategySetups;
}

type StrategySetups = Record<
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

interface SetupDecision {
	intent: TradeIntent["intent"];
	reason: string;
	stop: number | null;
	tp1: number | null;
	tp2: number | null;
	confidence: number;
}

interface PositionMemory {
	side: PositionSide;
	openedAt: number;
	entryPrice: number;
	stop: number | null;
}

export class UltraAggressiveBtcUsdtStrategy {
	private positionMemory: PositionMemory | null = null;

	constructor(
		private readonly config: UltraAggressiveBtcUsdtConfig,
		private readonly deps: UltraAggressiveDeps
	) {}

	async decide(position: PositionSide = "FLAT"): Promise<TradeIntent> {
		const { execution, confirming, context } = this.config.timeframes;
		const executionCandles = await this.deps.cache.getCandles(execution);
		const confirmingCandles = await this.deps.cache.getCandles(confirming);
		const contextCandles = await this.deps.cache.getCandles(context);

		if (
			executionCandles.length < this.config.lookbacks.executionBars ||
			confirmingCandles.length < 10 ||
			contextCandles.length < 10
		) {
			return this.noAction("insufficient_candles", executionCandles);
		}

		const ctx = this.buildContext(
			executionCandles,
			confirmingCandles,
			contextCandles
		);

		this.logContext(ctx);

		const latest = executionCandles[executionCandles.length - 1];
		if (position !== this.positionMemory?.side) {
			if (position === "FLAT") {
				this.positionMemory = null;
			} else {
				this.positionMemory = {
					side: position,
					openedAt: latest.timestamp,
					entryPrice: latest.close,
					stop: null,
				};
			}
		}

		if (position === "FLAT") {
			const entryDecision = this.findEntryDecision(ctx);
			if (!entryDecision) {
				return this.noAction("no_signal", executionCandles);
			}
			this.positionMemory = {
				side: entryDecision.intent === "OPEN_LONG" ? "LONG" : "SHORT",
				openedAt: latest.timestamp,
				entryPrice: latest.close,
				stop: entryDecision.stop,
			};
			this.logSignal(ctx, entryDecision);
			return this.buildIntent(latest, entryDecision);
		}

		const exitDecision = this.evaluateExit(ctx, position);
		if (exitDecision) {
			this.positionMemory = null;
			return exitDecision;
		}

		return this.noAction("manage_position", executionCandles);
	}

	private buildContext(
		executionCandles: Candle[],
		confirmingCandles: Candle[],
		contextCandles: Candle[]
	): StrategyContextSnapshot {
		const latest = executionCandles[executionCandles.length - 1];
		const indicator = this.computeIndicators(
			executionCandles,
			confirmingCandles
		);
		const levels = this.computeLevels(executionCandles, contextCandles);
		const trendDirection = classifyTrendDirection(
			confirmingCandles,
			indicator.vwap,
			this.config
		);
		const volRegime = computeVolRegime(
			indicator.atrSeries,
			indicator.atr1m,
			this.config
		);
		const setups = this.evaluateSetups(
			trendDirection,
			volRegime,
			indicator,
			levels,
			latest
		);
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
		};
	}

	private computeIndicators(
		executionCandles: Candle[],
		confirmingCandles: Candle[]
	): IndicatorSnapshot {
		const atrSeries = calculateATRSeries(
			executionCandles,
			this.config.atrPeriod1m
		);
		const atr1m = atrSeries.length ? atrSeries[atrSeries.length - 1] : null;
		const atr5mSeries = calculateATRSeries(
			confirmingCandles,
			this.config.atrPeriod5m
		);
		const atr5m = atr5mSeries.length
			? atr5mSeries[atr5mSeries.length - 1]
			: null;
		const closes = executionCandles.map((c) => c.close);
		const emaFast = ema(closes, this.config.emaFastPeriod);
		const emaSlow = ema(closes, this.config.emaSlowPeriod);
		const rsi = calculateRSI(closes, this.config.rsiPeriod);
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
		const cvdSeries = computeCvdSeries(
			executionCandles,
			this.config.lookbacks.cvd
		);
		const cvdTrend = classifyCvdTrend(cvdSeries);
		const cvdDivergence = detectCvdDivergence(
			executionCandles,
			cvdSeries,
			this.config.thresholds.cvdDivergenceThreshold
		);
		return {
			atr1m,
			atr5m,
			atrSeries,
			emaFast,
			emaSlow,
			rsi,
			vwap,
			vwapDeviationPct,
			cvdSeries,
			cvdTrend,
			cvdDivergence,
			volumeAvgShort,
			volumeAvgLong,
		};
	}

	private computeLevels(
		executionCandles: Candle[],
		contextCandles: Candle[]
	): LevelSnapshot {
		const latest = executionCandles[executionCandles.length - 1];
		const sameDay = filterByUtcDay(executionCandles, latest.timestamp);
		const previousDay = filterByUtcDay(
			executionCandles,
			latest.timestamp - 24 * 60 * 60 * 1000
		);
		const executionRange = executionCandles.slice(
			-this.config.lookbacks.rangeDetection
		);
		const contextRange = contextCandles.slice(
			-this.config.lookbacks.rangeDetection * 2
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
	}

	private evaluateSetups(
		trendDirection: TrendDirection,
		volRegime: VolatilityRegime,
		indicator: IndicatorSnapshot,
		levels: LevelSnapshot,
		latest: Candle
	): StrategySetups {
		return {
			trendIgnitionLong: detectTrendIgnition(
				"long",
				trendDirection,
				volRegime,
				indicator,
				levels,
				latest,
				this.config
			),
			trendIgnitionShort: detectTrendIgnition(
				"short",
				trendDirection,
				volRegime,
				indicator,
				levels,
				latest,
				this.config
			),
			meanReversionLong: detectMeanReversion(
				"long",
				trendDirection,
				indicator,
				levels,
				latest,
				this.config
			),
			meanReversionShort: detectMeanReversion(
				"short",
				trendDirection,
				indicator,
				levels,
				latest,
				this.config
			),
			breakoutTrapLong: detectBreakoutTrap(
				"long",
				trendDirection,
				indicator,
				levels,
				latest,
				this.config
			),
			breakoutTrapShort: detectBreakoutTrap(
				"short",
				trendDirection,
				indicator,
				levels,
				latest,
				this.config
			),
			liquiditySweepLong: detectLiquiditySweep(
				"long",
				indicator,
				levels,
				latest,
				this.config
			),
			liquiditySweepShort: detectLiquiditySweep(
				"short",
				indicator,
				levels,
				latest,
				this.config
			),
		};
	}

	private findEntryDecision(
		ctx: StrategyContextSnapshot
	): SetupDecision | null {
		const pipeline: (SetupDecision | null)[] = [
			ctx.setups.trendIgnitionLong
				? this.buildSetupDecision(ctx, "OPEN_LONG", "trend_ignition_long")
				: null,
			ctx.setups.trendIgnitionShort
				? this.buildSetupDecision(ctx, "OPEN_SHORT", "trend_ignition_short")
				: null,
			ctx.setups.liquiditySweepLong
				? this.buildSetupDecision(ctx, "OPEN_LONG", "liquidity_sweep_long")
				: null,
			ctx.setups.liquiditySweepShort
				? this.buildSetupDecision(ctx, "OPEN_SHORT", "liquidity_sweep_short")
				: null,
			ctx.setups.breakoutTrapShort
				? this.buildSetupDecision(ctx, "OPEN_SHORT", "breakout_trap_short")
				: null,
			ctx.setups.breakoutTrapLong
				? this.buildSetupDecision(ctx, "OPEN_LONG", "breakout_trap_long")
				: null,
			ctx.setups.meanReversionShort
				? this.buildSetupDecision(ctx, "OPEN_SHORT", "mean_reversion_short")
				: null,
			ctx.setups.meanReversionLong
				? this.buildSetupDecision(ctx, "OPEN_LONG", "mean_reversion_long")
				: null,
		];
		return pipeline.find((decision) => decision !== null) ?? null;
	}

	private buildSetupDecision(
		ctx: StrategyContextSnapshot,
		intent: SetupDecision["intent"],
		reason: string
	): SetupDecision {
		const sideMultiplier = intent === "OPEN_LONG" ? 1 : -1;
		const stopDistance =
			(ctx.indicator.atr1m ?? ctx.price * 0.002) *
			this.config.risk.atrStopMultiple;
		const stop = ctx.price - sideMultiplier * stopDistance;
		const tp1 =
			ctx.price + sideMultiplier * stopDistance * this.config.risk.partialTpRR;
		const tp2 =
			ctx.price + sideMultiplier * stopDistance * this.config.risk.finalTpRR;
		const confidence = computeConfidenceScore(ctx, intent, reason);
		return {
			intent,
			reason,
			stop,
			tp1,
			tp2,
			confidence,
		};
	}

	private evaluateExit(
		ctx: StrategyContextSnapshot,
		position: PositionSide
	): TradeIntent | null {
		if (position === "FLAT") {
			return null;
		}
		const latestTs = ctx.timestamp;
		const maxDuration = this.config.maxTradeDurationMinutes * 60 * 1000;
		if (
			this.positionMemory &&
			latestTs - this.positionMemory.openedAt >= maxDuration
		) {
			return this.buildCloseIntent(ctx, position, "max_duration_exit");
		}

		if (position === "LONG") {
			if (
				ctx.indicator.vwap &&
				ctx.price < ctx.indicator.vwap &&
				ctx.trendDirection !== "TrendingUp"
			) {
				return this.buildCloseIntent(ctx, position, "lost_vwap_support");
			}
			if (ctx.indicator.rsi && ctx.indicator.rsi > 80) {
				return this.buildCloseIntent(ctx, position, "rsi_extreme_exit");
			}
		}

		if (position === "SHORT") {
			if (
				ctx.indicator.vwap &&
				ctx.price > ctx.indicator.vwap &&
				ctx.trendDirection !== "TrendingDown"
			) {
				return this.buildCloseIntent(ctx, position, "lost_vwap_resistance");
			}
			if (ctx.indicator.rsi && ctx.indicator.rsi < 20) {
				return this.buildCloseIntent(ctx, position, "rsi_extreme_exit");
			}
		}

		return null;
	}

	private buildIntent(latest: Candle, decision: SetupDecision): TradeIntent {
		const intent: TradeIntent = {
			symbol: latest.symbol,
			intent: decision.intent,
			reason: decision.reason,
			timestamp: latest.timestamp,
			metadata: {
				stop: decision.stop,
				tp1: decision.tp1,
				tp2: decision.tp2,
				confidence: decision.confidence,
			},
		};
		if (decision.intent === "OPEN_LONG" || decision.intent === "OPEN_SHORT") {
			strategyLogger.info("strategy_entry", {
				strategy: "UltraAggressiveBtcUsdt",
				symbol: latest.symbol,
				intent: decision.intent,
				reason: decision.reason,
				price: latest.close,
				timestamp: new Date(latest.timestamp).toISOString(),
				stop: decision.stop,
				tp1: decision.tp1,
				tp2: decision.tp2,
			});
		}
		return intent;
	}

	private buildCloseIntent(
		ctx: StrategyContextSnapshot,
		position: PositionSide,
		reason: string
	): TradeIntent {
		const intent = position === "LONG" ? "CLOSE_LONG" : "CLOSE_SHORT";
		strategyLogger.info("strategy_exit", {
			reason,
			side: position,
			price: ctx.price,
			timestamp: new Date(ctx.timestamp).toISOString(),
		});
		return {
			symbol: ctx.symbol,
			intent,
			reason,
			timestamp: ctx.timestamp,
			metadata: {
				price: ctx.price,
				trendDirection: ctx.trendDirection,
				volRegime: ctx.volRegime,
			},
		};
	}

	private logContext(ctx: StrategyContextSnapshot): void {
		strategyLogger.info("strategy_context", {
			strategy: "UltraAggressiveBtcUsdt",
			symbol: ctx.symbol,
			timeframe: ctx.timeframe,
			price: ctx.price,
			timestamp: new Date(ctx.timestamp).toISOString(),
			trend: ctx.trendDirection,
			volatility: ctx.volRegime,
			vwap: ctx.indicator.vwap,
			vwapDeviationPct: ctx.indicator.vwapDeviationPct,
			atr1m: ctx.indicator.atr1m,
			atr5m: ctx.indicator.atr5m,
			emaFast: ctx.indicator.emaFast,
			emaSlow: ctx.indicator.emaSlow,
			rsi: ctx.indicator.rsi,
			cvdTrend: ctx.indicator.cvdTrend,
			cvdDivergence: ctx.indicator.cvdDivergence,
			levels: ctx.levels,
			setups: ctx.setups,
		});
	}

	private logSignal(
		ctx: StrategyContextSnapshot,
		decision: SetupDecision
	): void {
		strategyLogger.info("strategy_signal", {
			strategy: "UltraAggressiveBtcUsdt",
			symbol: ctx.symbol,
			intent: decision.intent,
			reason: decision.reason,
			price: ctx.price,
			timestamp: new Date(ctx.timestamp).toISOString(),
			trend: ctx.trendDirection,
			volatility: ctx.volRegime,
			confidence: decision.confidence,
			stop: decision.stop,
			tp1: decision.tp1,
			tp2: decision.tp2,
		});
	}

	private noAction(reason: string, candles: Candle[]): TradeIntent {
		const latest = candles[candles.length - 1];
		return {
			symbol: latest?.symbol ?? this.config.symbol,
			intent: "NO_ACTION",
			reason,
			timestamp: latest?.timestamp,
		};
	}
}

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
): boolean => {
	const isLong = side === "long";
	const trending = isLong
		? trendDirection === "TrendingUp"
		: trendDirection === "TrendingDown";
	if (!trending || volRegime === "low") {
		return false;
	}
	if (!indicator.vwap) {
		return false;
	}
	const priceVsVwap = indicator.vwapDeviationPct ?? 0;
	if (isLong && priceVsVwap < 0) {
		return false;
	}
	if (!isLong && priceVsVwap > 0) {
		return false;
	}
	const breakoutRef = isLong ? levels.rangeHigh : levels.rangeLow;
	if (!breakoutRef) {
		return false;
	}
	const breakout = isLong
		? latest.close > breakoutRef * 1.001
		: latest.close < breakoutRef * 0.999;
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
	return breakout && wideBody && highVolume && cvdOk;
};

const detectMeanReversion = (
	side: "long" | "short",
	trendDirection: TrendDirection,
	indicator: IndicatorSnapshot,
	levels: LevelSnapshot,
	latest: Candle,
	config: UltraAggressiveBtcUsdtConfig
): boolean => {
	if (trendDirection === "TrendingUp" && side === "short") {
		return false;
	}
	if (trendDirection === "TrendingDown" && side === "long") {
		return false;
	}
	const stretchPct = indicator.vwapDeviationPct ?? 0;
	const overExtended =
		side === "short"
			? stretchPct > config.thresholds.vwapStretchPct
			: stretchPct < -config.thresholds.vwapStretchPct;
	if (!overExtended) {
		return false;
	}
	const anchor =
		side === "short"
			? levels.dayHigh ?? levels.rangeHigh
			: levels.dayLow ?? levels.rangeLow;
	if (!anchor) {
		return false;
	}
	const nearExtreme =
		side === "short"
			? latest.high >= anchor * 0.999
			: latest.low <= anchor * 1.001;
	if (!nearExtreme) {
		return false;
	}
	if (!indicator.rsi) {
		return false;
	}
	const rsiCondition =
		side === "short"
			? indicator.rsi >= config.thresholds.rsiOverbought
			: indicator.rsi <= config.thresholds.rsiOversold;
	if (!rsiCondition) {
		return false;
	}
	const atr = indicator.atr1m ?? 0;
	const impulse =
		Math.abs(latest.close - latest.open) >=
		atr * config.thresholds.meanRevStretchAtr;
	const divergence =
		indicator.cvdDivergence === (side === "short" ? "bearish" : "bullish");
	return impulse && divergence;
};

const detectBreakoutTrap = (
	side: "long" | "short",
	trendDirection: TrendDirection,
	indicator: IndicatorSnapshot,
	levels: LevelSnapshot,
	latest: Candle,
	config: UltraAggressiveBtcUsdtConfig
): boolean => {
	const isLong = side === "long";
	const rangeContext = trendDirection === "Ranging";
	const keyLevel = isLong
		? levels.rangeLow ?? levels.previousDayLow ?? levels.dayLow
		: levels.rangeHigh ?? levels.previousDayHigh ?? levels.dayHigh;
	if (!keyLevel || !rangeContext) {
		return false;
	}
	const overshoot = isLong
		? latest.low < keyLevel * 0.999
		: latest.high > keyLevel * 1.001;
	const reEntry = isLong ? latest.close > keyLevel : latest.close < keyLevel;
	if (!overshoot || !reEntry) {
		return false;
	}
	const volumeControlled =
		indicator.volumeAvgShort > 0 &&
		latest.volume <=
			indicator.volumeAvgShort * config.thresholds.trapVolumeMaxMultiple;
	const orderFlowReject = isLong
		? indicator.cvdDivergence === "bullish" || indicator.cvdTrend === "up"
		: indicator.cvdDivergence === "bearish" || indicator.cvdTrend === "down";
	return volumeControlled && orderFlowReject;
};

const detectLiquiditySweep = (
	side: "long" | "short",
	indicator: IndicatorSnapshot,
	levels: LevelSnapshot,
	latest: Candle,
	config: UltraAggressiveBtcUsdtConfig
): boolean => {
	const isLong = side === "long";
	const referenceLevel = isLong
		? levels.recentSwingLow ?? levels.dayLow ?? levels.previousDayLow
		: levels.recentSwingHigh ?? levels.dayHigh ?? levels.previousDayHigh;
	if (!referenceLevel) {
		return false;
	}
	const atr = indicator.atr1m ?? 0;
	const wickSize = isLong
		? referenceLevel - latest.low
		: latest.high - referenceLevel;
	const wickLarge = atr
		? wickSize >= atr * config.thresholds.liquiditySweepWickMultiple
		: wickSize / referenceLevel >= config.thresholds.vwapStretchPct;
	const reclaimed = isLong
		? latest.close > referenceLevel
		: latest.close < referenceLevel;
	const divergence =
		indicator.cvdDivergence === (isLong ? "bullish" : "bearish");
	return wickLarge && reclaimed && divergence;
};

const computeConfidenceScore = (
	ctx: StrategyContextSnapshot,
	intent: SetupDecision["intent"],
	reason: string
): number => {
	let score = 0.5;
	const isLong = intent === "OPEN_LONG";
	if (reason.includes("trend_ignition")) {
		score += ctx.volRegime === "high" ? 0.2 : 0.1;
		score +=
			ctx.trendDirection === (isLong ? "TrendingUp" : "TrendingDown") ? 0.2 : 0;
	}
	if (reason.includes("liquidity_sweep")) {
		score += ctx.indicator.cvdDivergence ? 0.2 : 0;
		score += ctx.volRegime !== "high" ? 0.1 : 0;
	}
	if (reason.includes("mean_reversion") || reason.includes("breakout_trap")) {
		score += ctx.volRegime !== "high" ? 0.15 : 0;
		score += ctx.indicator.cvdDivergence ? 0.1 : 0;
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

export const createUltraAggressiveCache = (
	clientFetcher: MultiTimeframeCacheOptions["fetcher"],
	symbol: string,
	timeframes: string[],
	maxAgeMs: number
): MultiTimeframeCache =>
	createMTFCache({
		symbol,
		timeframes,
		maxAgeMs,
		fetcher: clientFetcher,
		limit: 500,
	});

export const loadUltraAggressiveConfig = (
	configPath = path.join(
		getWorkspaceRoot(),
		"configs",
		"strategies",
		"ultra-aggressive-btc-usdt.json"
	)
): UltraAggressiveBtcUsdtConfig => {
	const contents = fs.readFileSync(configPath, "utf-8");
	return JSON.parse(contents) as UltraAggressiveBtcUsdtConfig;
};
