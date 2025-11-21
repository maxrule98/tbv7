import fs from "node:fs";
import path from "node:path";
import { ar4Forecast } from "@agenai/models-quant";
import {
	calculateATRSeries,
	calculateAtr5m,
	calculateDailyVWAP,
	calculateMonthlyVWAP,
	calculateRollingVWAP,
	calculateWeeklyVWAP,
	computeDeltaGamma,
	DeltaGammaResult,
	VwapCandle,
} from "@agenai/indicators";
import { Candle, PositionSide, TradeIntent } from "../../types";
import {
	MultiTimeframeCache,
	MultiTimeframeCacheOptions,
	createMTFCache,
} from "../../data/multiTimeframeCache";
import { getWorkspaceRoot } from "../../config";
import { createLogger } from "../../utils/logger";

const strategyLogger = createLogger("vwap-delta-gamma");

export interface VWAPDeltaGammaConfig {
	name: string;
	timeframes: {
		execution: string;
		trend: string;
		bias: string;
		macro: string;
	};
	atrPeriod1m: number;
	atrPeriod5m: number;
	vwapRollingShort: number;
	vwapRollingLong: number;
	atrLowThreshold: number;
	atrExpansionThreshold: number;
	deltaExtremeMultiplier: number;
	minPullbackDistance: number;
	macdForecastDeadband: number;
	cacheTTLms: number;
}

export interface VWAPDeltaGammaStrategyDependencies {
	cache: MultiTimeframeCache;
}

interface VwapDeltaContext {
	value: number | null;
	previous: number | null;
	delta: DeltaGammaResult;
}

interface VwapContext {
	daily: VwapDeltaContext;
	weekly: VwapDeltaContext;
	monthly: VwapDeltaContext;
	rolling50: VwapDeltaContext;
	rolling200: VwapDeltaContext;
	trendRolling50: VwapDeltaContext | null;
}

interface AtrContext {
	atr1m: number | null;
	atr1mPrev: number | null;
	atr1mAvg: number | null;
	atr5m: number | null;
	rising: boolean;
	low: boolean;
	expanding: boolean;
	collapsed: boolean;
}

interface BiasSummary {
	trend: "bull" | "bear" | "neutral";
	bias: "bull" | "bear" | "neutral";
	macro: "bull" | "bear" | "neutral";
}

interface StrategyFlags {
	trendLong: boolean;
	trendShort: boolean;
	meanRevLong: boolean;
	meanRevShort: boolean;
	breakoutLong: boolean;
	breakoutShort: boolean;
	longExitReason: string | null;
	shortExitReason: string | null;
	trendRegime: "bull_trend" | "bear_trend" | "range";
	volatilityRegime: "expansion" | "compression" | "balanced";
}

interface RecommendationLevels {
	stopLoss: number | null;
	takeProfit: number | null;
}

interface StrategyRecommendations {
	trendLong?: RecommendationLevels;
	trendShort?: RecommendationLevels;
	meanRevLong?: RecommendationLevels;
	meanRevShort?: RecommendationLevels;
	breakoutLong?: RecommendationLevels;
	breakoutShort?: RecommendationLevels;
}

const DEFAULT_MACD_FAST = 12;
const DEFAULT_MACD_SLOW = 26;
const DEFAULT_MACD_SIGNAL = 9;
const DEFAULT_MACD_WINDOW = 20;

export class VWAPDeltaGammaStrategy {
	constructor(
		private readonly config: VWAPDeltaGammaConfig,
		private readonly deps: VWAPDeltaGammaStrategyDependencies
	) {}

	async decide(position: PositionSide = "FLAT"): Promise<TradeIntent> {
		const executionCandles = await this.deps.cache.getCandles(
			this.config.timeframes.execution
		);
		if (executionCandles.length < this.config.vwapRollingLong + 5) {
			return this.noAction(executionCandles, "insufficient_candles");
		}

		const trendCandles = await this.deps.cache.getCandles(
			this.config.timeframes.trend
		);
		const biasCandles = await this.deps.cache.getCandles(
			this.config.timeframes.bias
		);
		const macroCandles = await this.deps.cache.getCandles(
			this.config.timeframes.macro
		);

		const latest = executionCandles[executionCandles.length - 1];
		const prev = executionCandles[executionCandles.length - 2] ?? null;
		const vwapContext = this.buildVwapContext(executionCandles, trendCandles);
		const atrContext = this.buildAtrContext(executionCandles, trendCandles);
		const mtfBias = this.computeBiasSummary(
			trendCandles,
			biasCandles,
			macroCandles
		);
		const macdForecast = this.computeMacdForecast(executionCandles);
		const deltaHistory = this.computeDeltaHistory(
			executionCandles,
			vwapContext.daily.value
		);
		const trendFlags = this.evaluateSetups(
			latest,
			prev,
			vwapContext,
			atrContext,
			mtfBias,
			macdForecast,
			deltaHistory
		);
		const recommendations = this.computeRecommendations(
			latest,
			vwapContext,
			atrContext
		);

		this.logContext(latest, {
			vwapContext,
			atrContext,
			mtfBias,
			macdForecast,
			flags: trendFlags,
		});

		if (position === "LONG" && trendFlags.longExitReason) {
			return this.tradeIntent(
				latest,
				"CLOSE_LONG",
				trendFlags.longExitReason,
				recommendations
			);
		}
		if (position === "SHORT" && trendFlags.shortExitReason) {
			return this.tradeIntent(
				latest,
				"CLOSE_SHORT",
				trendFlags.shortExitReason,
				recommendations
			);
		}
		if (position === "FLAT") {
			if (
				trendFlags.trendLong ||
				trendFlags.meanRevLong ||
				trendFlags.breakoutLong
			) {
				const reason = trendFlags.trendLong
					? "trend_continuation_long"
					: trendFlags.breakoutLong
					? "compression_breakout_long"
					: "mean_reversion_long";
				return this.tradeIntent(latest, "OPEN_LONG", reason, recommendations);
			}

			if (
				trendFlags.trendShort ||
				trendFlags.meanRevShort ||
				trendFlags.breakoutShort
			) {
				const reason = trendFlags.trendShort
					? "trend_continuation_short"
					: trendFlags.breakoutShort
					? "compression_breakout_short"
					: "mean_reversion_short";
				return this.tradeIntent(latest, "OPEN_SHORT", reason, recommendations);
			}
		}

		return this.noAction(executionCandles, "no_signal");
	}

	private buildVwapContext(
		executionCandles: Candle[],
		trendCandles: Candle[]
	): VwapContext {
		const prevExecution = executionCandles.slice(0, -1);
		const price = executionCandles[executionCandles.length - 1].close;
		const prevPrice = prevExecution.length
			? prevExecution[prevExecution.length - 1].close
			: null;

		const daily = this.buildVwapDelta(
			executionCandles,
			prevExecution,
			price,
			prevPrice,
			calculateDailyVWAP
		);
		const weekly = this.buildVwapDelta(
			executionCandles,
			prevExecution,
			price,
			prevPrice,
			calculateWeeklyVWAP
		);
		const monthly = this.buildVwapDelta(
			executionCandles,
			prevExecution,
			price,
			prevPrice,
			calculateMonthlyVWAP
		);
		const rolling50 = this.buildVwapDelta(
			executionCandles,
			prevExecution,
			price,
			prevPrice,
			(candles) =>
				calculateRollingVWAP(
					candles as VwapCandle[],
					this.config.vwapRollingShort
				)
		);
		const rolling200 = this.buildVwapDelta(
			executionCandles,
			prevExecution,
			price,
			prevPrice,
			(candles) =>
				calculateRollingVWAP(
					candles as VwapCandle[],
					this.config.vwapRollingLong
				)
		);

		const trendPrev = trendCandles.slice(0, -1);
		const trendPrice = trendCandles[trendCandles.length - 1]?.close ?? null;
		const trendPrevPrice = trendPrev.length
			? trendPrev[trendPrev.length - 1].close
			: null;
		const trendRolling50 =
			trendPrice === null
				? null
				: this.buildVwapDelta(
						trendCandles,
						trendPrev,
						trendPrice,
						trendPrevPrice,
						(candles) => {
							const period = Math.min(
								this.config.vwapRollingShort,
								candles.length
							);
							if (period <= 0) {
								return null;
							}
							return calculateRollingVWAP(candles as VwapCandle[], period);
						}
				  );

		return {
			daily,
			weekly,
			monthly,
			rolling50,
			rolling200,
			trendRolling50,
		};
	}

	private buildVwapDelta(
		candles: Candle[],
		previousCandles: Candle[],
		price: number,
		prevPrice: number | null,
		calculator: (candles: VwapCandle[]) => number | null
	): VwapDeltaContext {
		const value = calculator(candles as VwapCandle[]);
		const previous = calculator(previousCandles as VwapCandle[]);
		const prevDelta =
			prevPrice !== null && previous !== null ? prevPrice - previous : null;
		return {
			value,
			previous,
			delta: computeDeltaGamma(price, value, prevDelta),
		};
	}

	private buildAtrContext(
		executionCandles: Candle[],
		trendCandles: Candle[]
	): AtrContext {
		const atrInputs = executionCandles.map((candle) => ({
			high: candle.high,
			low: candle.low,
			close: candle.close,
		}));
		const atrSeries = calculateATRSeries(atrInputs, this.config.atrPeriod1m);
		const atrLen = atrSeries.length;
		const atr1m = atrLen ? atrSeries[atrLen - 1] : null;
		const atr1mPrev = atrLen > 1 ? atrSeries[atrLen - 2] : null;
		const atr1mAvg = atrSeries.length
			? atrSeries.reduce((acc, value) => acc + value, 0) / atrSeries.length
			: null;
		const atr5mInputs = trendCandles.map((candle) => ({
			high: candle.high,
			low: candle.low,
			close: candle.close,
		}));
		const atr5m = calculateAtr5m(atr5mInputs, this.config.atrPeriod5m);

		const rising =
			atrLen >= 3 &&
			atrSeries[atrLen - 3] < atrSeries[atrLen - 2] &&
			atrSeries[atrLen - 2] < atrSeries[atrLen - 1];
		const low =
			atr1m !== null &&
			atr1mAvg !== null &&
			atr1mAvg > 0 &&
			atr1m / atr1mAvg <= this.config.atrLowThreshold;
		const expanding =
			atr1m !== null &&
			atr1mPrev !== null &&
			atr1mPrev > 0 &&
			atr1m / atr1mPrev >= this.config.atrExpansionThreshold;
		const collapsed = low && !expanding;

		return {
			atr1m,
			atr1mPrev,
			atr1mAvg,
			atr5m,
			rising,
			low,
			expanding,
			collapsed,
		};
	}

	private computeBiasSummary(
		trendCandles: Candle[],
		biasCandles: Candle[],
		macroCandles: Candle[]
	): BiasSummary {
		const summarize = (candles: Candle[]): BiasSummary["trend"] => {
			if (candles.length < 2) {
				return "neutral";
			}
			const first = candles[candles.length - Math.min(50, candles.length)];
			const last = candles[candles.length - 1];
			if (last.close > first.close) {
				return "bull";
			}
			if (last.close < first.close) {
				return "bear";
			}
			return "neutral";
		};

		return {
			trend: summarize(trendCandles),
			bias: summarize(biasCandles),
			macro: summarize(macroCandles),
		};
	}

	private computeMacdForecast(candles: Candle[]): number | null {
		const closes = candles.map((candle) => candle.close);
		const histogramSeries = this.buildHistogramSeries(closes);
		const window = histogramSeries.slice(-DEFAULT_MACD_WINDOW);
		if (window.length < DEFAULT_MACD_WINDOW) {
			return null;
		}
		return ar4Forecast(window);
	}

	private buildHistogramSeries(closes: number[]): number[] {
		if (closes.length === 0) {
			return [];
		}

		const fastSeries = this.calculateEmaSeries(closes, DEFAULT_MACD_FAST);
		const slowSeries = this.calculateEmaSeries(closes, DEFAULT_MACD_SLOW);
		const macdSeries: Array<number | null> = fastSeries.map(
			(fastValue, index) => {
				const slowValue = slowSeries[index];
				if (fastValue === null || slowValue === null) {
					return null;
				}
				return fastValue - slowValue;
			}
		);

		const signalSeries = this.calculateSignalSeries(
			macdSeries,
			DEFAULT_MACD_SIGNAL
		);
		const histogramSeries = macdSeries.map((macdValue, index) => {
			const signalValue = signalSeries[index];
			if (macdValue === null || signalValue === null) {
				return null;
			}
			return macdValue - signalValue;
		});

		return histogramSeries.filter((value): value is number => value !== null);
	}

	private calculateEmaSeries(
		values: number[],
		length: number
	): Array<number | null> {
		const series: Array<number | null> = new Array(values.length).fill(null);
		if (length <= 0 || values.length < length) {
			return series;
		}

		const multiplier = 2 / (length + 1);
		let emaValue = this.average(values.slice(0, length));
		series[length - 1] = emaValue;

		for (let i = length; i < values.length; i += 1) {
			emaValue = (values[i] - emaValue) * multiplier + emaValue;
			series[i] = emaValue;
		}

		return series;
	}

	private calculateSignalSeries(
		values: Array<number | null>,
		length: number
	): Array<number | null> {
		const series: Array<number | null> = new Array(values.length).fill(null);
		if (length <= 0) {
			return series;
		}

		const multiplier = 2 / (length + 1);
		let signal =
			values.find((value): value is number => value !== null) ?? null;
		const startIndex = values.findIndex((value) => value !== null);
		if (signal === null || startIndex === -1) {
			return series;
		}

		series[startIndex] = signal;
		for (let i = startIndex + 1; i < values.length; i += 1) {
			const value = values[i];
			if (value === null) {
				continue;
			}
			signal = (value - signal) * multiplier + signal;
			series[i] = signal;
		}

		return series;
	}

	private evaluateSetups(
		latest: Candle,
		prev: Candle | null,
		vwap: VwapContext,
		atr: AtrContext,
		bias: BiasSummary,
		macdForecast: number | null,
		deltaHistory: Array<number | null>
	): StrategyFlags {
		const price = latest.close;
		const prevClose = prev?.close ?? null;
		const priceAboveAll =
			this.isAbove(price, vwap.rolling200.value) &&
			this.isAbove(price, vwap.daily.value) &&
			this.isAbove(price, vwap.weekly.value) &&
			this.isAbove(price, vwap.monthly.value);
		const priceBelowAll =
			this.isBelow(price, vwap.rolling200.value) &&
			this.isBelow(price, vwap.daily.value) &&
			this.isBelow(price, vwap.weekly.value) &&
			this.isBelow(price, vwap.monthly.value);

		const pullbackTouch =
			vwap.rolling50.value !== null &&
			Math.abs(price - vwap.rolling50.value) <= this.config.minPullbackDistance;
		const delta50FlippedPositive =
			vwap.rolling50.delta.deltaSign === "positive" &&
			vwap.rolling50.delta.gammaFlipped;
		const gamma50Positive = vwap.rolling50.delta.gammaSign === "positive";
		const delta200Positive = vwap.rolling200.delta.deltaSign === "positive";
		const gamma200Positive = vwap.rolling200.delta.gammaSign === "positive";
		const macdUpward =
			macdForecast !== null && macdForecast > this.config.macdForecastDeadband;
		const macdDownward =
			macdForecast !== null && macdForecast < -this.config.macdForecastDeadband;
		const fiveMinuteDeltaPositive =
			vwap.trendRolling50?.delta?.deltaSign === "positive";
		const fiveMinuteDeltaNegative =
			vwap.trendRolling50?.delta?.deltaSign === "negative";

		const trendLong =
			priceAboveAll &&
			delta200Positive &&
			gamma200Positive &&
			pullbackTouch &&
			delta50FlippedPositive &&
			gamma50Positive &&
			macdUpward &&
			!!fiveMinuteDeltaPositive &&
			atr.rising &&
			bias.trend === "bull" &&
			bias.macro !== "bear";
		const trendShort =
			priceBelowAll &&
			vwap.rolling200.delta.deltaSign === "negative" &&
			vwap.rolling200.delta.gammaSign === "negative" &&
			pullbackTouch &&
			vwap.rolling50.delta.deltaSign === "negative" &&
			vwap.rolling50.delta.gammaFlipped &&
			vwap.rolling50.delta.gammaSign === "negative" &&
			macdDownward &&
			!!fiveMinuteDeltaNegative &&
			atr.rising &&
			bias.trend === "bear" &&
			bias.macro !== "bull";

		const atrReference = atr.atr1m ?? 0;
		const priceBelowDailyExtreme =
			vwap.daily.value !== null &&
			atrReference > 0 &&
			price < vwap.daily.value - 2 * atrReference;
		const priceAboveDailyExtreme =
			vwap.daily.value !== null &&
			atrReference > 0 &&
			price > vwap.daily.value + 2 * atrReference;
		const deltaDailyExtremeNegative =
			vwap.daily.delta.delta !== null &&
			atrReference > 0 &&
			vwap.daily.delta.delta <=
				-this.config.deltaExtremeMultiplier * atrReference;
		const deltaDailyExtremePositive =
			vwap.daily.delta.delta !== null &&
			atrReference > 0 &&
			vwap.daily.delta.delta >=
				this.config.deltaExtremeMultiplier * atrReference;
		const gammaDailyPositiveFlip =
			vwap.daily.delta.gammaSign === "positive" &&
			vwap.daily.delta.gammaFlipped;
		const gammaDailyNegativeFlip =
			vwap.daily.delta.gammaSign === "negative" &&
			vwap.daily.delta.gammaFlipped;

		const meanRevLong =
			priceBelowDailyExtreme &&
			deltaDailyExtremeNegative &&
			gammaDailyPositiveFlip &&
			macdUpward;
		const meanRevShort =
			priceAboveDailyExtreme &&
			deltaDailyExtremePositive &&
			gammaDailyNegativeFlip &&
			macdDownward;

		const betweenDailyWeekly = this.isBetween(
			price,
			vwap.daily.value,
			vwap.weekly.value
		);
		const prevBelowDaily =
			prevClose !== null &&
			vwap.daily.value !== null &&
			prevClose <= vwap.daily.value;
		const prevAboveDaily =
			prevClose !== null &&
			vwap.daily.value !== null &&
			prevClose >= vwap.daily.value;
		const deltaSmall =
			vwap.daily.delta.deltaMagnitude !== null &&
			vwap.daily.delta.deltaMagnitude <= this.config.minPullbackDistance;
		const gammaNearZero =
			vwap.daily.delta.gammaMagnitude !== null &&
			vwap.daily.delta.gammaMagnitude <= this.config.minPullbackDistance;
		const breakoutLong =
			betweenDailyWeekly &&
			atr.low &&
			deltaSmall &&
			gammaNearZero &&
			prevBelowDaily &&
			this.isAbove(price, vwap.daily.value) &&
			vwap.daily.delta.deltaSign === "positive" &&
			vwap.daily.delta.gammaSign === "positive" &&
			atr.expanding;
		const breakoutShort =
			betweenDailyWeekly &&
			atr.low &&
			deltaSmall &&
			gammaNearZero &&
			prevAboveDaily &&
			this.isBelow(price, vwap.daily.value) &&
			vwap.daily.delta.deltaSign === "negative" &&
			vwap.daily.delta.gammaSign === "negative" &&
			atr.expanding;

		const deltaWeakening = this.isDeltaWeakening(deltaHistory, "long");
		const deltaStrengthening = this.isDeltaWeakening(deltaHistory, "short");
		const longExitReason = this.pickLongExitReason(
			vwap,
			atr,
			price,
			deltaWeakening
		);
		const shortExitReason = this.pickShortExitReason(
			vwap,
			atr,
			price,
			deltaStrengthening
		);
		const trendRegime: StrategyFlags["trendRegime"] = priceAboveAll
			? "bull_trend"
			: priceBelowAll
			? "bear_trend"
			: "range";
		const volatilityRegime: StrategyFlags["volatilityRegime"] = atr.expanding
			? "expansion"
			: atr.low
			? "compression"
			: "balanced";

		return {
			trendLong,
			trendShort,
			meanRevLong,
			meanRevShort,
			breakoutLong,
			breakoutShort,
			longExitReason,
			shortExitReason,
			trendRegime,
			volatilityRegime,
		};
	}

	private computeDeltaHistory(
		candles: Candle[],
		reference: number | null,
		lookback = 3
	): Array<number | null> {
		if (reference === null) {
			return [];
		}
		const slice = candles.slice(-lookback);
		return slice.map((candle) => candle.close - reference);
	}

	private isDeltaWeakening(
		history: Array<number | null>,
		side: "long" | "short"
	): boolean {
		if (history.length < 3 || history.some((value) => value === null)) {
			return false;
		}
		const [a, b, c] = history as number[];
		if (side === "long") {
			return a > b && b > c;
		}
		return a < b && b < c;
	}

	private pickLongExitReason(
		vwap: VwapContext,
		atr: AtrContext,
		price: number,
		deltaWeakening: boolean
	): string | null {
		if (vwap.rolling50.value !== null && price < vwap.rolling50.value) {
			return "trend_vwap50_break";
		}
		if (
			vwap.rolling50.delta.gammaSign === "negative" &&
			vwap.rolling50.delta.gammaFlipped
		) {
			return "trend_gamma50_flip_down";
		}
		if (deltaWeakening) {
			return "trend_daily_delta_weakening";
		}
		if (
			vwap.daily.value !== null &&
			price >= vwap.daily.value &&
			atr.collapsed
		) {
			return "breakout_completed";
		}
		return null;
	}

	private pickShortExitReason(
		vwap: VwapContext,
		atr: AtrContext,
		price: number,
		deltaStrengthening: boolean
	): string | null {
		if (vwap.rolling50.value !== null && price > vwap.rolling50.value) {
			return "trend_vwap50_break";
		}
		if (
			vwap.rolling50.delta.gammaSign === "positive" &&
			vwap.rolling50.delta.gammaFlipped
		) {
			return "trend_gamma50_flip_up";
		}
		if (deltaStrengthening) {
			return "trend_daily_delta_strengthening";
		}
		if (
			vwap.daily.value !== null &&
			price <= vwap.daily.value &&
			atr.collapsed
		) {
			return "breakout_completed";
		}
		return null;
	}

	private computeRecommendations(
		latest: Candle,
		vwap: VwapContext,
		atr: AtrContext
	): StrategyRecommendations {
		const atrValue = atr.atr1m ?? 0;
		const levels: StrategyRecommendations = {};

		if (vwap.rolling50.value !== null && atrValue > 0) {
			levels.trendLong = {
				stopLoss: vwap.rolling50.value - 1.5 * atrValue,
				takeProfit:
					vwap.rolling200.value !== null
						? vwap.rolling200.value + atrValue
						: latest.close + 2 * atrValue,
			};
			levels.trendShort = {
				stopLoss: vwap.rolling50.value + 1.5 * atrValue,
				takeProfit:
					vwap.rolling200.value !== null
						? vwap.rolling200.value - atrValue
						: latest.close - 2 * atrValue,
			};
		}

		if (vwap.daily.value !== null && atrValue > 0) {
			levels.meanRevLong = {
				stopLoss: latest.close - 0.75 * atrValue,
				takeProfit: vwap.daily.value,
			};
			levels.meanRevShort = {
				stopLoss: latest.close + 0.75 * atrValue,
				takeProfit: vwap.daily.value,
			};
		}

		if (
			vwap.daily.value !== null &&
			vwap.weekly.value !== null &&
			atrValue > 0
		) {
			const clusterLow = Math.min(
				vwap.daily.value,
				vwap.weekly.value,
				vwap.monthly.value ?? vwap.daily.value
			);
			const clusterHigh = Math.max(
				vwap.daily.value,
				vwap.weekly.value,
				vwap.monthly.value ?? vwap.weekly.value
			);
			levels.breakoutLong = {
				stopLoss: clusterLow - atrValue,
				takeProfit:
					vwap.rolling200.value !== null
						? vwap.rolling200.value
						: latest.close + 3 * atrValue,
			};
			levels.breakoutShort = {
				stopLoss: clusterHigh + atrValue,
				takeProfit:
					vwap.rolling200.value !== null
						? vwap.rolling200.value
						: latest.close - 3 * atrValue,
			};
		}

		return levels;
	}

	private isAbove(price: number, reference: number | null): boolean {
		return reference !== null ? price > reference : false;
	}

	private isBelow(price: number, reference: number | null): boolean {
		return reference !== null ? price < reference : false;
	}

	private isBetween(
		price: number,
		first: number | null,
		second: number | null
	): boolean {
		if (first === null || second === null) {
			return false;
		}
		const low = Math.min(first, second);
		const high = Math.max(first, second);
		return price >= low && price <= high;
	}

	private average(values: number[]): number {
		if (!values.length) {
			return 0;
		}
		return values.reduce((acc, value) => acc + value, 0) / values.length;
	}

	private tradeIntent(
		latest: Candle,
		intent: TradeIntent["intent"],
		reason: string,
		recommendations: StrategyRecommendations
	): TradeIntent {
		return {
			symbol: latest.symbol,
			intent,
			reason,
			timestamp: latest.timestamp,
			metadata: {
				recommendations,
			},
		};
	}

	private noAction(candles: Candle[], reason: string): TradeIntent {
		const latest = candles.at(-1);
		return {
			symbol: latest?.symbol ?? "UNKNOWN",
			intent: "NO_ACTION",
			reason,
			timestamp: latest?.timestamp,
		};
	}

	private logContext(
		latest: Candle,
		payload: {
			vwapContext: VwapContext;
			atrContext: AtrContext;
			mtfBias: BiasSummary;
			macdForecast: number | null;
			flags: StrategyFlags;
		}
	): void {
		strategyLogger.info("strategy_context", {
			strategy: "VWAPDeltaGamma",
			symbol: latest.symbol,
			timeframe: latest.timeframe,
			timestamp: new Date(latest.timestamp).toISOString(),
			price: latest.close,
			vwap: {
				daily: payload.vwapContext.daily.value,
				weekly: payload.vwapContext.weekly.value,
				monthly: payload.vwapContext.monthly.value,
				rolling50: payload.vwapContext.rolling50.value,
				rolling200: payload.vwapContext.rolling200.value,
			},
			delta: {
				daily: payload.vwapContext.daily.delta,
				weekly: payload.vwapContext.weekly.delta,
				monthly: payload.vwapContext.monthly.delta,
				rolling50: payload.vwapContext.rolling50.delta,
				rolling200: payload.vwapContext.rolling200.delta,
			},
			atr: {
				atr1m: payload.atrContext.atr1m,
				atr5m: payload.atrContext.atr5m,
				low: payload.atrContext.low,
				expanding: payload.atrContext.expanding,
			},
			bias: payload.mtfBias,
			regime: {
				trend: payload.flags.trendRegime,
				volatility: payload.flags.volatilityRegime,
			},
			macdForecast: payload.macdForecast,
			setups: {
				trendLong: payload.flags.trendLong,
				trendShort: payload.flags.trendShort,
				meanRevLong: payload.flags.meanRevLong,
				meanRevShort: payload.flags.meanRevShort,
				breakoutLong: payload.flags.breakoutLong,
				breakoutShort: payload.flags.breakoutShort,
			},
			exits: {
				long: payload.flags.longExitReason,
				short: payload.flags.shortExitReason,
			},
		});
	}
}

export const createVWAPDeltaGammaCache = (
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
	});

export const loadVWAPDeltaGammaConfig = (
	configPath = path.join(
		getWorkspaceRoot(),
		"configs",
		"strategies",
		"vwap-delta-gamma.json"
	)
): VWAPDeltaGammaConfig => {
	const contents = fs.readFileSync(configPath, "utf-8");
	return JSON.parse(contents) as VWAPDeltaGammaConfig;
};
