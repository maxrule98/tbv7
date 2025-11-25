import { PositionSide, TradeIntent } from "../../types";
import {
	MultiTimeframeCache,
	MultiTimeframeCacheOptions,
} from "../../data/multiTimeframeCache";
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
	atr?: {
		requireExpansionForTrend?: boolean;
		minAtr1m?: number;
		minAtr5m?: number;
	};
}
export interface VWAPDeltaGammaStrategyDependencies {
	cache: MultiTimeframeCache;
}
export declare class VWAPDeltaGammaStrategy {
	private readonly config;
	private readonly deps;
	constructor(
		config: VWAPDeltaGammaConfig,
		deps: VWAPDeltaGammaStrategyDependencies
	);
	decide(position?: PositionSide): Promise<TradeIntent>;
	private buildVwapContext;
	private buildVwapDelta;
	private buildAtrContext;
	private computeBiasSummary;
	private computeMacdForecast;
	private buildHistogramSeries;
	private calculateEmaSeries;
	private calculateSignalSeries;
	private evaluateSetups;
	private evaluateTrendLong;
	private evaluateTrendShort;
	private evaluateMeanRevLong;
	private evaluateMeanRevShort;
	private evaluateBreakoutLong;
	private evaluateBreakoutShort;
	private normalizeAtrTrendRules;
	private evaluateAtrTrend;
	private computeDeltaHistory;
	private isDeltaWeakening;
	private pickLongExitReason;
	private pickShortExitReason;
	private computeRecommendations;
	private isAbove;
	private isBelow;
	private isBetween;
	private average;
	private tradeIntent;
	private noAction;
	private logContext;
}
export declare const createVWAPDeltaGammaCache: (
	clientFetcher: MultiTimeframeCacheOptions["fetcher"],
	symbol: string,
	timeframes: string[],
	maxAgeMs: number
) => MultiTimeframeCache;
export declare const loadVWAPDeltaGammaConfig: (
	configPath?: string
) => VWAPDeltaGammaConfig;
