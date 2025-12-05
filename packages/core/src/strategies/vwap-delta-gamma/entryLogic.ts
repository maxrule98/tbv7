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
import { Candle, PositionSide } from "../../types";
import { VWAPDeltaGammaConfig } from "./config";

export interface VwapDeltaContext {
	value: number | null;
	previous: number | null;
	delta: DeltaGammaResult;
}

export interface VwapContext {
	daily: VwapDeltaContext;
	weekly: VwapDeltaContext;
	monthly: VwapDeltaContext;
	rolling50: VwapDeltaContext;
	rolling200: VwapDeltaContext;
	trendRolling50: VwapDeltaContext | null;
}

export interface AtrContext {
	atr1m: number | null;
	atr1mPrev: number | null;
	atr1mAvg: number | null;
	atr5m: number | null;
	rising: boolean;
	low: boolean;
	expanding: boolean;
	collapsed: boolean;
}

export interface BiasSummary {
	trend: "bull" | "bear" | "neutral";
	bias: "bull" | "bear" | "neutral";
	macro: "bull" | "bear" | "neutral";
}

export interface StrategyFlags {
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

export interface RecommendationLevels {
	stopLoss: number | null;
	takeProfit: number | null;
}

export interface StrategyRecommendations {
	trendLong?: RecommendationLevels;
	trendShort?: RecommendationLevels;
	meanRevLong?: RecommendationLevels;
	meanRevShort?: RecommendationLevels;
	breakoutLong?: RecommendationLevels;
	breakoutShort?: RecommendationLevels;
}

export interface TrendLongChecks {
	priceAboveAllVwaps: boolean;
	delta200Positive: boolean;
	gamma200Positive: boolean;
	pullbackToVwap50: boolean;
	delta50Reclaimed: boolean;
	gamma50Positive: boolean;
	macdBullish: boolean;
	trendDeltaPositive: boolean;
	mtfTrendBullish: boolean;
	macroFilterOk: boolean;
	atrTrendOk: boolean;
	atrTrendReason: string;
	positionFlat: boolean;
}

export interface TrendShortChecks {
	priceBelowAllVwaps: boolean;
	delta200Negative: boolean;
	gamma200Negative: boolean;
	pullbackToVwap50: boolean;
	delta50Rejected: boolean;
	gamma50Negative: boolean;
	macdBearish: boolean;
	trendDeltaNegative: boolean;
	mtfTrendBearish: boolean;
	macroFilterOk: boolean;
	atrTrendOk: boolean;
	atrTrendReason: string;
	positionFlat: boolean;
}

export interface MeanRevLongChecks {
	priceBelowDailyExtreme: boolean;
	deltaDailyExtremeNegative: boolean;
	gammaDailyPositiveFlip: boolean;
	macdBullish: boolean;
	atrReferenceAvailable: boolean;
}

export interface MeanRevShortChecks {
	priceAboveDailyExtreme: boolean;
	deltaDailyExtremePositive: boolean;
	gammaDailyNegativeFlip: boolean;
	macdBearish: boolean;
	atrReferenceAvailable: boolean;
}

export interface BreakoutLongChecks {
	betweenDailyWeekly: boolean;
	atrCompression: boolean;
	deltaCalm: boolean;
	gammaCalm: boolean;
	prevBelowDaily: boolean;
	reclaimDailyClose: boolean;
	deltaPositive: boolean;
	gammaPositive: boolean;
	atrExpansion: boolean;
}

export interface BreakoutShortChecks {
	betweenDailyWeekly: boolean;
	atrCompression: boolean;
	deltaCalm: boolean;
	gammaCalm: boolean;
	prevAboveDaily: boolean;
	rejectDailyClose: boolean;
	deltaNegative: boolean;
	gammaNegative: boolean;
	atrExpansion: boolean;
}

export interface StrategySetupChecks {
	trendLong: TrendLongChecks;
	trendShort: TrendShortChecks;
	meanRevLong: MeanRevLongChecks;
	meanRevShort: MeanRevShortChecks;
	breakoutLong: BreakoutLongChecks;
	breakoutShort: BreakoutShortChecks;
}

export interface StrategySetups {
	trendLong: boolean;
	trendShort: boolean;
	meanRevLong: boolean;
	meanRevShort: boolean;
	breakoutLong: boolean;
	breakoutShort: boolean;
}

export interface LongExitSignals {
	trendVwap50Break: boolean;
	trendGamma50FlipDown: boolean;
	trendDailyDeltaWeakening: boolean;
	breakoutCompleted: boolean;
}

export interface ShortExitSignals {
	trendVwap50Break: boolean;
	trendGamma50FlipUp: boolean;
	trendDailyDeltaStrengthening: boolean;
	breakoutCompleted: boolean;
}

export interface StrategyExitSignals {
	long: LongExitSignals;
	short: ShortExitSignals;
}

export interface StrategyEvaluation {
	flags: StrategyFlags;
	setupChecks: StrategySetupChecks;
	exits: StrategyExitSignals;
}

export interface StrategyContextSnapshot {
	latest: Candle;
	position: PositionSide;
	bias: BiasSummary;
	regime: {
		trend: StrategyFlags["trendRegime"];
		volatility: StrategyFlags["volatilityRegime"];
	};
	setupChecks: StrategySetupChecks;
	setups: StrategySetups;
	exits: StrategyExitSignals;
}

interface SetupEvaluation<TChecks> {
	active: boolean;
	checks: TChecks;
}

interface AtrTrendRules {
	requireExpansionForTrend: boolean;
	minAtr1m: number;
	minAtr5m: number;
}

const DEFAULT_MACD_FAST = 12;
const DEFAULT_MACD_SLOW = 26;
const DEFAULT_MACD_SIGNAL = 9;
const DEFAULT_MACD_WINDOW = 20;
const DEFAULT_ATR_GATING: AtrTrendRules = {
	requireExpansionForTrend: false,
	minAtr1m: 0,
	minAtr5m: 0,
};

export const buildVwapContext = (
	executionCandles: Candle[],
	trendCandles: Candle[],
	config: VWAPDeltaGammaConfig
): VwapContext => {
	const prevExecution = executionCandles.slice(0, -1);
	const price = executionCandles[executionCandles.length - 1].close;
	const prevPrice = prevExecution.length
		? prevExecution[prevExecution.length - 1].close
		: null;

	const daily = buildVwapDelta(
		executionCandles,
		prevExecution,
		price,
		prevPrice,
		calculateDailyVWAP
	);
	const weekly = buildVwapDelta(
		executionCandles,
		prevExecution,
		price,
		prevPrice,
		calculateWeeklyVWAP
	);
	const monthly = buildVwapDelta(
		executionCandles,
		prevExecution,
		price,
		prevPrice,
		calculateMonthlyVWAP
	);
	const rolling50 = buildVwapDelta(
		executionCandles,
		prevExecution,
		price,
		prevPrice,
		(candles) =>
			calculateRollingVWAP(candles as VwapCandle[], config.vwapRollingShort)
	);
	const rolling200 = buildVwapDelta(
		executionCandles,
		prevExecution,
		price,
		prevPrice,
		(candles) =>
			calculateRollingVWAP(candles as VwapCandle[], config.vwapRollingLong)
	);

	const trendPrev = trendCandles.slice(0, -1);
	const trendPrice = trendCandles[trendCandles.length - 1]?.close ?? null;
	const trendPrevPrice = trendPrev.length
		? trendPrev[trendPrev.length - 1].close
		: null;
	const trendRolling50 =
		trendPrice === null
			? null
			: buildVwapDelta(
					trendCandles,
					trendPrev,
					trendPrice,
					trendPrevPrice,
					(candles) => {
						const period = Math.min(config.vwapRollingShort, candles.length);
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
};

const buildVwapDelta = (
	candles: Candle[],
	previousCandles: Candle[],
	price: number,
	prevPrice: number | null,
	calculator: (candles: VwapCandle[]) => number | null
): VwapDeltaContext => {
	const value = calculator(candles as VwapCandle[]);
	const previous = calculator(previousCandles as VwapCandle[]);
	const prevDelta =
		prevPrice !== null && previous !== null ? prevPrice - previous : null;
	return {
		value,
		previous,
		delta: computeDeltaGamma(price, value, prevDelta),
	};
};

export const buildAtrContext = (
	executionCandles: Candle[],
	trendCandles: Candle[],
	config: VWAPDeltaGammaConfig
): AtrContext => {
	const atrInputs = executionCandles.map((candle) => ({
		high: candle.high,
		low: candle.low,
		close: candle.close,
	}));
	const atrSeries = calculateATRSeries(atrInputs, config.atrPeriod1m);
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
	const atr5m = calculateAtr5m(atr5mInputs, config.atrPeriod5m);

	const rising =
		atrLen >= 3 &&
		atrSeries[atrLen - 3] < atrSeries[atrLen - 2] &&
		atrSeries[atrLen - 2] < atrSeries[atrLen - 1];
	const low =
		atr1m !== null &&
		atr1mAvg !== null &&
		atr1mAvg > 0 &&
		atr1m / atr1mAvg <= config.atrLowThreshold;
	const expanding =
		atr1m !== null &&
		atr1mPrev !== null &&
		atr1mPrev > 0 &&
		atr1m / atr1mPrev >= config.atrExpansionThreshold;
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
};

export const computeBiasSummary = (
	trendCandles: Candle[],
	biasCandles: Candle[],
	macroCandles: Candle[]
): BiasSummary => {
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
};

export const computeMacdForecast = (
	executionCandles: Candle[]
): number | null => {
	const closes = executionCandles.map((candle) => candle.close);
	const histogramSeries = buildHistogramSeries(closes);
	const window = histogramSeries.slice(-DEFAULT_MACD_WINDOW);
	if (window.length < DEFAULT_MACD_WINDOW) {
		return null;
	}
	return ar4Forecast(window);
};

const buildHistogramSeries = (closes: number[]): number[] => {
	if (closes.length === 0) {
		return [];
	}

	const fastSeries = calculateEmaSeries(closes, DEFAULT_MACD_FAST);
	const slowSeries = calculateEmaSeries(closes, DEFAULT_MACD_SLOW);
	const macdSeries: Array<number | null> = fastSeries.map(
		(fastValue, index) => {
			const slowValue = slowSeries[index];
			if (fastValue === null || slowValue === null) {
				return null;
			}
			return fastValue - slowValue;
		}
	);

	const signalSeries = calculateSignalSeries(macdSeries, DEFAULT_MACD_SIGNAL);
	const histogramSeries = macdSeries.map((macdValue, index) => {
		const signalValue = signalSeries[index];
		if (macdValue === null || signalValue === null) {
			return null;
		}
		return macdValue - signalValue;
	});

	return histogramSeries.filter((value): value is number => value !== null);
};

const calculateEmaSeries = (
	values: number[],
	length: number
): Array<number | null> => {
	const series: Array<number | null> = new Array(values.length).fill(null);
	if (length <= 0 || values.length < length) {
		return series;
	}

	const multiplier = 2 / (length + 1);
	let emaValue = average(values.slice(0, length));
	series[length - 1] = emaValue;

	for (let i = length; i < values.length; i += 1) {
		emaValue = (values[i] - emaValue) * multiplier + emaValue;
		series[i] = emaValue;
	}

	return series;
};

const calculateSignalSeries = (
	values: Array<number | null>,
	length: number
): Array<number | null> => {
	const series: Array<number | null> = new Array(values.length).fill(null);
	if (length <= 0) {
		return series;
	}

	const multiplier = 2 / (length + 1);
	let signal = values.find((value): value is number => value !== null) ?? null;
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
};

export const evaluateStrategy = (
	latest: Candle,
	prev: Candle | null,
	vwap: VwapContext,
	atr: AtrContext,
	bias: BiasSummary,
	macdForecast: number | null,
	deltaHistory: Array<number | null>,
	position: PositionSide,
	config: VWAPDeltaGammaConfig
): StrategyEvaluation => {
	const price = latest.close;
	const prevClose = prev?.close ?? null;
	const priceAboveAll =
		isAbove(price, vwap.rolling200.value) &&
		isAbove(price, vwap.daily.value) &&
		isAbove(price, vwap.weekly.value) &&
		isAbove(price, vwap.monthly.value);
	const priceBelowAll =
		isBelow(price, vwap.rolling200.value) &&
		isBelow(price, vwap.daily.value) &&
		isBelow(price, vwap.weekly.value) &&
		isBelow(price, vwap.monthly.value);

	const atr1mValue = atr.atr1m ?? 0;
	const pullbackBand =
		atr1mValue > 0
			? config.minPullbackDistance * atr1mValue
			: config.minPullbackDistance;
	const pullbackTouch =
		vwap.rolling50.value !== null &&
		Math.abs(price - vwap.rolling50.value) <= pullbackBand;
	const delta50FlippedPositive =
		vwap.rolling50.delta.deltaSign === "positive" &&
		vwap.rolling50.delta.gammaFlipped;
	const gamma50Positive = vwap.rolling50.delta.gammaSign === "positive";
	const gamma50Negative = vwap.rolling50.delta.gammaSign === "negative";
	const delta50Rejected =
		vwap.rolling50.delta.deltaSign === "negative" &&
		vwap.rolling50.delta.gammaFlipped;
	const delta200Positive = vwap.rolling200.delta.deltaSign === "positive";
	const gamma200Positive = vwap.rolling200.delta.gammaSign === "positive";
	const delta200Negative = vwap.rolling200.delta.deltaSign === "negative";
	const gamma200Negative = vwap.rolling200.delta.gammaSign === "negative";
	const macdUpward =
		macdForecast !== null && macdForecast > config.macdForecastDeadband;
	const macdDownward =
		macdForecast !== null && macdForecast < -config.macdForecastDeadband;
	const fiveMinuteDeltaPositive =
		vwap.trendRolling50?.delta?.deltaSign === "positive";
	const fiveMinuteDeltaNegative =
		vwap.trendRolling50?.delta?.deltaSign === "negative";
	const atrTrendRules = normalizeAtrTrendRules(config);
	const atrTrendResult = evaluateAtrTrend(atr, atrTrendRules);
	const trendLongEvaluation = evaluateTrendLong({
		priceAboveAll,
		delta200Positive,
		gamma200Positive,
		pullbackTouch,
		delta50Reclaimed: delta50FlippedPositive,
		gamma50Positive,
		macdUpward,
		trendDeltaPositive: !!fiveMinuteDeltaPositive,
		bias,
		atrTrendOk: atrTrendResult.ok,
		atrTrendReason: atrTrendResult.reason ?? "ok",
		position,
	});
	const trendShortEvaluation = evaluateTrendShort({
		priceBelowAll,
		delta200Negative,
		gamma200Negative,
		pullbackTouch,
		delta50Rejected,
		gamma50Negative,
		macdDownward,
		trendDeltaNegative: !!fiveMinuteDeltaNegative,
		bias,
		atrTrendOk: atrTrendResult.ok,
		atrTrendReason: atrTrendResult.reason ?? "ok",
		position,
	});

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
		vwap.daily.delta.delta <= -config.deltaExtremeMultiplier * atrReference;
	const deltaDailyExtremePositive =
		vwap.daily.delta.delta !== null &&
		atrReference > 0 &&
		vwap.daily.delta.delta >= config.deltaExtremeMultiplier * atrReference;
	const gammaDailyPositiveFlip =
		vwap.daily.delta.gammaSign === "positive" && vwap.daily.delta.gammaFlipped;
	const gammaDailyNegativeFlip =
		vwap.daily.delta.gammaSign === "negative" && vwap.daily.delta.gammaFlipped;

	const meanRevLongEvaluation = evaluateMeanRevLong({
		priceBelowDailyExtreme,
		deltaDailyExtremeNegative,
		gammaDailyPositiveFlip,
		macdUpward,
		atrReferenceAvailable: atrReference > 0,
	});
	const meanRevShortEvaluation = evaluateMeanRevShort({
		priceAboveDailyExtreme,
		deltaDailyExtremePositive,
		gammaDailyNegativeFlip,
		macdDownward,
		atrReferenceAvailable: atrReference > 0,
	});

	const betweenDailyWeekly = isBetween(
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
		vwap.daily.delta.deltaMagnitude <= config.minPullbackDistance;
	const gammaNearZero =
		vwap.daily.delta.gammaMagnitude !== null &&
		vwap.daily.delta.gammaMagnitude <= config.minPullbackDistance;
	const breakoutLongEvaluation = evaluateBreakoutLong({
		betweenDailyWeekly,
		atr,
		deltaSmall,
		gammaNearZero,
		prevBelowDaily,
		price,
		vwap,
	});
	const breakoutShortEvaluation = evaluateBreakoutShort({
		betweenDailyWeekly,
		atr,
		deltaSmall,
		gammaNearZero,
		prevAboveDaily,
		price,
		vwap,
	});

	const deltaWeakening = isDeltaWeakening(deltaHistory, "long");
	const deltaStrengthening = isDeltaWeakening(deltaHistory, "short");
	const longExitSignals = computeLongExitSignals(
		vwap,
		atr,
		price,
		deltaWeakening
	);
	const shortExitSignals = computeShortExitSignals(
		vwap,
		atr,
		price,
		deltaStrengthening
	);
	const longExitReason = pickLongExitReason(longExitSignals);
	const shortExitReason = pickShortExitReason(shortExitSignals);
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

	const flags: StrategyFlags = {
		trendLong: trendLongEvaluation.active,
		trendShort: trendShortEvaluation.active,
		meanRevLong: meanRevLongEvaluation.active,
		meanRevShort: meanRevShortEvaluation.active,
		breakoutLong: breakoutLongEvaluation.active,
		breakoutShort: breakoutShortEvaluation.active,
		longExitReason,
		shortExitReason,
		trendRegime,
		volatilityRegime,
	};

	const setupChecks: StrategySetupChecks = {
		trendLong: trendLongEvaluation.checks,
		trendShort: trendShortEvaluation.checks,
		meanRevLong: meanRevLongEvaluation.checks,
		meanRevShort: meanRevShortEvaluation.checks,
		breakoutLong: breakoutLongEvaluation.checks,
		breakoutShort: breakoutShortEvaluation.checks,
	};
	const exits: StrategyExitSignals = {
		long: longExitSignals,
		short: shortExitSignals,
	};

	return { flags, setupChecks, exits };
};

export const computeRecommendations = (
	latest: Candle,
	vwap: VwapContext,
	atr: AtrContext
): StrategyRecommendations => {
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

	if (vwap.daily.value !== null && vwap.weekly.value !== null && atrValue > 0) {
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
};

export const computeSetups = (params: {
	setupChecks: StrategySetupChecks;
	bias: BiasSummary;
	trendRegime: StrategyFlags["trendRegime"];
}): StrategySetups => {
	const { setupChecks: s, bias, trendRegime } = params;
	const trendLong =
		trendRegime === "bull_trend" &&
		bias.trend === "bull" &&
		s.trendLong.priceAboveAllVwaps &&
		s.trendLong.delta200Positive &&
		s.trendLong.gamma200Positive &&
		s.trendLong.pullbackToVwap50 &&
		s.trendLong.delta50Reclaimed &&
		s.trendLong.gamma50Positive &&
		s.trendLong.macdBullish &&
		s.trendLong.trendDeltaPositive &&
		s.trendLong.mtfTrendBullish &&
		s.trendLong.macroFilterOk &&
		s.trendLong.atrTrendOk &&
		s.trendLong.positionFlat;
	const trendShort =
		trendRegime === "bear_trend" &&
		bias.trend === "bear" &&
		s.trendShort.priceBelowAllVwaps &&
		s.trendShort.delta200Negative &&
		s.trendShort.gamma200Negative &&
		s.trendShort.pullbackToVwap50 &&
		s.trendShort.delta50Rejected &&
		s.trendShort.gamma50Negative &&
		s.trendShort.macdBearish &&
		s.trendShort.trendDeltaNegative &&
		s.trendShort.mtfTrendBearish &&
		s.trendShort.macroFilterOk &&
		s.trendShort.atrTrendOk &&
		s.trendShort.positionFlat;
	const meanRevLong =
		s.meanRevLong.priceBelowDailyExtreme &&
		s.meanRevLong.deltaDailyExtremeNegative &&
		s.meanRevLong.gammaDailyPositiveFlip &&
		s.meanRevLong.macdBullish &&
		s.meanRevLong.atrReferenceAvailable;
	const meanRevShort =
		s.meanRevShort.priceAboveDailyExtreme &&
		s.meanRevShort.deltaDailyExtremePositive &&
		s.meanRevShort.gammaDailyNegativeFlip &&
		s.meanRevShort.macdBearish &&
		s.meanRevShort.atrReferenceAvailable;
	const breakoutLong =
		s.breakoutLong.betweenDailyWeekly &&
		s.breakoutLong.atrCompression &&
		s.breakoutLong.deltaCalm &&
		s.breakoutLong.gammaCalm &&
		s.breakoutLong.prevBelowDaily &&
		s.breakoutLong.reclaimDailyClose &&
		s.breakoutLong.deltaPositive &&
		s.breakoutLong.gammaPositive &&
		s.breakoutLong.atrExpansion;
	const breakoutShort =
		s.breakoutShort.betweenDailyWeekly &&
		s.breakoutShort.atrCompression &&
		s.breakoutShort.deltaCalm &&
		s.breakoutShort.gammaCalm &&
		s.breakoutShort.prevAboveDaily &&
		s.breakoutShort.rejectDailyClose &&
		s.breakoutShort.deltaNegative &&
		s.breakoutShort.gammaNegative &&
		s.breakoutShort.atrExpansion;
	return {
		trendLong,
		trendShort,
		meanRevLong,
		meanRevShort,
		breakoutLong,
		breakoutShort,
	};
};

export const decideEntry = (
	position: PositionSide,
	setups: StrategySetups
): { intent: PositionSide | "FLAT"; reason: string | null } => {
	if (position !== "FLAT") {
		return { intent: "FLAT", reason: null };
	}
	const longReason = pickLongEntryReason(setups);
	if (longReason) {
		return { intent: "LONG", reason: longReason };
	}
	const shortReason = pickShortEntryReason(setups);
	if (shortReason) {
		return { intent: "SHORT", reason: shortReason };
	}
	return { intent: "FLAT", reason: null };
};

const evaluateTrendLong = (params: {
	priceAboveAll: boolean;
	delta200Positive: boolean;
	gamma200Positive: boolean;
	pullbackTouch: boolean;
	delta50Reclaimed: boolean;
	gamma50Positive: boolean;
	macdUpward: boolean;
	trendDeltaPositive: boolean;
	bias: BiasSummary;
	atrTrendOk: boolean;
	atrTrendReason: string;
	position: PositionSide;
}): SetupEvaluation<TrendLongChecks> => {
	const checks: TrendLongChecks = {
		priceAboveAllVwaps: params.priceAboveAll,
		delta200Positive: params.delta200Positive,
		gamma200Positive: params.gamma200Positive,
		pullbackToVwap50: params.pullbackTouch,
		delta50Reclaimed: params.delta50Reclaimed,
		gamma50Positive: params.gamma50Positive,
		macdBullish: params.macdUpward,
		trendDeltaPositive: params.trendDeltaPositive,
		mtfTrendBullish: params.bias.trend === "bull",
		macroFilterOk: params.bias.macro !== "bear",
		atrTrendOk: params.atrTrendOk,
		atrTrendReason: params.atrTrendReason,
		positionFlat: params.position === "FLAT",
	};
	const active =
		checks.priceAboveAllVwaps &&
		checks.delta200Positive &&
		checks.gamma200Positive &&
		checks.pullbackToVwap50 &&
		checks.delta50Reclaimed &&
		checks.gamma50Positive &&
		checks.macdBullish &&
		checks.trendDeltaPositive &&
		checks.mtfTrendBullish &&
		checks.macroFilterOk &&
		checks.atrTrendOk;
	return { active, checks };
};

const evaluateTrendShort = (params: {
	priceBelowAll: boolean;
	delta200Negative: boolean;
	gamma200Negative: boolean;
	pullbackTouch: boolean;
	delta50Rejected: boolean;
	gamma50Negative: boolean;
	macdDownward: boolean;
	trendDeltaNegative: boolean;
	bias: BiasSummary;
	atrTrendOk: boolean;
	atrTrendReason: string;
	position: PositionSide;
}): SetupEvaluation<TrendShortChecks> => {
	const checks: TrendShortChecks = {
		priceBelowAllVwaps: params.priceBelowAll,
		delta200Negative: params.delta200Negative,
		gamma200Negative: params.gamma200Negative,
		pullbackToVwap50: params.pullbackTouch,
		delta50Rejected: params.delta50Rejected,
		gamma50Negative: params.gamma50Negative,
		macdBearish: params.macdDownward,
		trendDeltaNegative: params.trendDeltaNegative,
		mtfTrendBearish: params.bias.trend === "bear",
		macroFilterOk: params.bias.macro !== "bull",
		atrTrendOk: params.atrTrendOk,
		atrTrendReason: params.atrTrendReason,
		positionFlat: params.position === "FLAT",
	};
	const active =
		checks.priceBelowAllVwaps &&
		checks.delta200Negative &&
		checks.gamma200Negative &&
		checks.pullbackToVwap50 &&
		checks.delta50Rejected &&
		checks.gamma50Negative &&
		checks.macdBearish &&
		checks.trendDeltaNegative &&
		checks.mtfTrendBearish &&
		checks.macroFilterOk &&
		checks.atrTrendOk;
	return { active, checks };
};

const evaluateMeanRevLong = (params: {
	priceBelowDailyExtreme: boolean;
	deltaDailyExtremeNegative: boolean;
	gammaDailyPositiveFlip: boolean;
	macdUpward: boolean;
	atrReferenceAvailable: boolean;
}): SetupEvaluation<MeanRevLongChecks> => {
	const checks: MeanRevLongChecks = {
		priceBelowDailyExtreme: params.priceBelowDailyExtreme,
		deltaDailyExtremeNegative: params.deltaDailyExtremeNegative,
		gammaDailyPositiveFlip: params.gammaDailyPositiveFlip,
		macdBullish: params.macdUpward,
		atrReferenceAvailable: params.atrReferenceAvailable,
	};
	const active =
		checks.priceBelowDailyExtreme &&
		checks.deltaDailyExtremeNegative &&
		checks.gammaDailyPositiveFlip &&
		checks.macdBullish &&
		checks.atrReferenceAvailable;
	return { active, checks };
};

const evaluateMeanRevShort = (params: {
	priceAboveDailyExtreme: boolean;
	deltaDailyExtremePositive: boolean;
	gammaDailyNegativeFlip: boolean;
	macdDownward: boolean;
	atrReferenceAvailable: boolean;
}): SetupEvaluation<MeanRevShortChecks> => {
	const checks: MeanRevShortChecks = {
		priceAboveDailyExtreme: params.priceAboveDailyExtreme,
		deltaDailyExtremePositive: params.deltaDailyExtremePositive,
		gammaDailyNegativeFlip: params.gammaDailyNegativeFlip,
		macdBearish: params.macdDownward,
		atrReferenceAvailable: params.atrReferenceAvailable,
	};
	const active =
		checks.priceAboveDailyExtreme &&
		checks.deltaDailyExtremePositive &&
		checks.gammaDailyNegativeFlip &&
		checks.macdBearish &&
		checks.atrReferenceAvailable;
	return { active, checks };
};

const evaluateBreakoutLong = (params: {
	betweenDailyWeekly: boolean;
	atr: AtrContext;
	deltaSmall: boolean;
	gammaNearZero: boolean;
	prevBelowDaily: boolean;
	price: number;
	vwap: VwapContext;
}): SetupEvaluation<BreakoutLongChecks> => {
	const reclaimDaily = isAbove(params.price, params.vwap.daily.value);
	const checks: BreakoutLongChecks = {
		betweenDailyWeekly: params.betweenDailyWeekly,
		atrCompression: params.atr.low,
		deltaCalm: params.deltaSmall,
		gammaCalm: params.gammaNearZero,
		prevBelowDaily: params.prevBelowDaily,
		reclaimDailyClose: reclaimDaily,
		deltaPositive: params.vwap.daily.delta.deltaSign === "positive",
		gammaPositive: params.vwap.daily.delta.gammaSign === "positive",
		atrExpansion: params.atr.expanding,
	};
	const active =
		checks.betweenDailyWeekly &&
		checks.atrCompression &&
		checks.deltaCalm &&
		checks.gammaCalm &&
		checks.prevBelowDaily &&
		checks.reclaimDailyClose &&
		checks.deltaPositive &&
		checks.gammaPositive &&
		checks.atrExpansion;
	return { active, checks };
};

const evaluateBreakoutShort = (params: {
	betweenDailyWeekly: boolean;
	atr: AtrContext;
	deltaSmall: boolean;
	gammaNearZero: boolean;
	prevAboveDaily: boolean;
	price: number;
	vwap: VwapContext;
}): SetupEvaluation<BreakoutShortChecks> => {
	const rejectDaily = isBelow(params.price, params.vwap.daily.value);
	const checks: BreakoutShortChecks = {
		betweenDailyWeekly: params.betweenDailyWeekly,
		atrCompression: params.atr.low,
		deltaCalm: params.deltaSmall,
		gammaCalm: params.gammaNearZero,
		prevAboveDaily: params.prevAboveDaily,
		rejectDailyClose: rejectDaily,
		deltaNegative: params.vwap.daily.delta.deltaSign === "negative",
		gammaNegative: params.vwap.daily.delta.gammaSign === "negative",
		atrExpansion: params.atr.expanding,
	};
	const active =
		checks.betweenDailyWeekly &&
		checks.atrCompression &&
		checks.deltaCalm &&
		checks.gammaCalm &&
		checks.prevAboveDaily &&
		checks.rejectDailyClose &&
		checks.deltaNegative &&
		checks.gammaNegative &&
		checks.atrExpansion;
	return { active, checks };
};

const normalizeAtrTrendRules = (
	config: VWAPDeltaGammaConfig
): AtrTrendRules => {
	const overrides = config.atr ?? {};
	return {
		requireExpansionForTrend:
			overrides.requireExpansionForTrend ??
			DEFAULT_ATR_GATING.requireExpansionForTrend,
		minAtr1m: overrides.minAtr1m ?? DEFAULT_ATR_GATING.minAtr1m,
		minAtr5m: overrides.minAtr5m ?? DEFAULT_ATR_GATING.minAtr5m,
	};
};

const evaluateAtrTrend = (
	atr: AtrContext,
	rules: AtrTrendRules
): { ok: boolean; reason: string | null } => {
	const atr1m = atr.atr1m ?? 0;
	const atr5m = atr.atr5m ?? 0;

	if (rules.minAtr1m > 0 && atr1m < rules.minAtr1m) {
		return { ok: false, reason: "atr1m_below_min" };
	}
	if (rules.minAtr5m > 0 && atr5m < rules.minAtr5m) {
		return { ok: false, reason: "atr5m_below_min" };
	}

	if (rules.requireExpansionForTrend) {
		if (atr.low) {
			return { ok: false, reason: "atr_low" };
		}
		if (!atr.expanding) {
			return { ok: false, reason: "atr_not_expanding" };
		}
	}

	return { ok: true, reason: null };
};

export const computeDeltaHistory = (
	candles: Candle[],
	reference: number | null,
	lookback = 3
): Array<number | null> => {
	if (reference === null) {
		return [];
	}
	const slice = candles.slice(-lookback);
	return slice.map((candle) => candle.close - reference);
};

const isDeltaWeakening = (
	history: Array<number | null>,
	side: "long" | "short"
): boolean => {
	if (history.length < 3 || history.some((value) => value === null)) {
		return false;
	}
	const [a, b, c] = history as number[];
	if (side === "long") {
		return a > b && b > c;
	}
	return a < b && b < c;
};

const computeLongExitSignals = (
	vwap: VwapContext,
	atr: AtrContext,
	price: number,
	deltaWeakening: boolean
): LongExitSignals => {
	return {
		trendVwap50Break:
			vwap.rolling50.value !== null && price < vwap.rolling50.value,
		trendGamma50FlipDown:
			vwap.rolling50.delta.gammaSign === "negative" &&
			vwap.rolling50.delta.gammaFlipped,
		trendDailyDeltaWeakening: deltaWeakening,
		breakoutCompleted:
			vwap.daily.value !== null && price >= vwap.daily.value && atr.collapsed,
	};
};

const computeShortExitSignals = (
	vwap: VwapContext,
	atr: AtrContext,
	price: number,
	deltaStrengthening: boolean
): ShortExitSignals => {
	return {
		trendVwap50Break:
			vwap.rolling50.value !== null && price > vwap.rolling50.value,
		trendGamma50FlipUp:
			vwap.rolling50.delta.gammaSign === "positive" &&
			vwap.rolling50.delta.gammaFlipped,
		trendDailyDeltaStrengthening: deltaStrengthening,
		breakoutCompleted:
			vwap.daily.value !== null && price <= vwap.daily.value && atr.collapsed,
	};
};

export const pickLongExitReason = (signals: LongExitSignals): string | null => {
	if (signals.trendVwap50Break) {
		return "trend_vwap50_break";
	}
	if (signals.trendGamma50FlipDown) {
		return "trend_gamma50_flip_down";
	}
	if (signals.trendDailyDeltaWeakening) {
		return "trend_daily_delta_weakening";
	}
	if (signals.breakoutCompleted) {
		return "breakout_completed";
	}
	return null;
};

export const pickShortExitReason = (
	signals: ShortExitSignals
): string | null => {
	if (signals.trendVwap50Break) {
		return "trend_vwap50_break";
	}
	if (signals.trendGamma50FlipUp) {
		return "trend_gamma50_flip_up";
	}
	if (signals.trendDailyDeltaStrengthening) {
		return "trend_daily_delta_strengthening";
	}
	if (signals.breakoutCompleted) {
		return "breakout_completed";
	}
	return null;
};

export const pickLongEntryReason = (setups: StrategySetups): string | null => {
	if (setups.trendLong) {
		return "trend_long";
	}
	if (setups.breakoutLong) {
		return "breakout_long";
	}
	if (setups.meanRevLong) {
		return "mean_reversion_long";
	}
	return null;
};

export const pickShortEntryReason = (setups: StrategySetups): string | null => {
	if (setups.trendShort) {
		return "trend_short";
	}
	if (setups.breakoutShort) {
		return "breakout_short";
	}
	if (setups.meanRevShort) {
		return "mean_reversion_short";
	}
	return null;
};

const isAbove = (price: number, reference: number | null): boolean => {
	return reference !== null ? price > reference : false;
};

const isBelow = (price: number, reference: number | null): boolean => {
	return reference !== null ? price < reference : false;
};

const isBetween = (
	price: number,
	first: number | null,
	second: number | null
): boolean => {
	if (first === null || second === null) {
		return false;
	}
	const low = Math.min(first, second);
	const high = Math.max(first, second);
	return price >= low && price <= high;
};

const average = (values: number[]): number => {
	if (!values.length) {
		return 0;
	}
	return values.reduce((acc, value) => acc + value, 0) / values.length;
};
