import { MultiTimeframeCache } from "../../data/multiTimeframeCache";
import type { StrategyId } from "../types";

export const ULTRA_AGGRESSIVE_ID: StrategyId = "ultra_aggressive_btc_usdt";

export type UltraAggressivePlayType =
	| "liquiditySweep"
	| "breakoutTrap"
	| "breakout"
	| "meanReversion";

export type UltraAggressiveSessionLabel = "asia" | "eu" | "us";

export interface UltraAggressiveSessionFilters {
	enabled: boolean;
	allowedSessions?: UltraAggressiveSessionLabel[];
	blockedSessions?: UltraAggressiveSessionLabel[];
	allowedLongSessions?: UltraAggressiveSessionLabel[];
	allowedShortSessions?: UltraAggressiveSessionLabel[];
	blockedLongSessions?: UltraAggressiveSessionLabel[];
	blockedShortSessions?: UltraAggressiveSessionLabel[];
	allowLongsWhenTrendingUp?: UltraAggressiveSessionLabel[];
}

export interface UltraAggressiveQualityFilters {
	minConfidence: number;
	playTypeMinConfidence?: Partial<Record<UltraAggressivePlayType, number>>;
	requireCvdAlignment?: boolean;
	maxTrendSlopePctForCounterTrend?: number;
	maxVolatilityForMeanReversion?: "low" | "balanced" | "high";
	requireStrongLongCvd?: boolean;
	allowShortsAgainstCvd?: boolean;
	minLongTrendSlopePct?: number;
	minShortTrendSlopePct?: number;
	requireLongDiscountToVwapPct?: number;
	requireShortPremiumToVwapPct?: number;
}

export interface UltraAggressiveEquityThrottleConfig {
	enabled: boolean;
	lookbackTrades: number;
	maxDrawdownPct: number;
}

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
	trackedTimeframes?: string[];
	playTypePriority: UltraAggressivePlayType[];
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
	enableVolatilityFadeExit: boolean;
	allowBreakoutsWhenRSIOverbought: boolean;
	reversionNeedsTwoOfThreeConditions: boolean;
	maxDrawdownPerTradePct: number;
	cooldownAfterStopoutBars: number;
	dailyDrawdownLimitPct: number;
	sessionFilters?: UltraAggressiveSessionFilters;
	qualityFilters?: UltraAggressiveQualityFilters;
	equityThrottle?: UltraAggressiveEquityThrottleConfig;
	historyWindowCandles?: number;
	warmupPeriods: Record<string, number>;
}

export interface UltraAggressiveDeps {
	cache: MultiTimeframeCache;
}

export interface UltraAggressiveRiskRulesSummary {
	maxTradeDurationMinutes: number;
	stopLossAtrMultiple: number;
	partialTakeProfitRR: number;
	finalTakeProfitRR: number;
	trailingAtrMultiple: number;
	maxDrawdownPerTradePct: number;
	dailyDrawdownLimitPct: number;
}

export interface UltraAggressiveStrategyManifest {
	strategyId: StrategyId;
	name: string;
	defaultPair: string;
	timeframes: UltraAggressiveBtcUsdtConfig["timeframes"];
	riskRules: UltraAggressiveRiskRulesSummary;
}

export const ultraAggressiveManifest: UltraAggressiveStrategyManifest = {
	strategyId: ULTRA_AGGRESSIVE_ID,
	name: "Ultra Aggressive BTC/USDT",
	defaultPair: "BTC/USDT",
	timeframes: {
		execution: "1m",
		confirming: "5m",
		context: "15m",
	},
	riskRules: {
		maxTradeDurationMinutes: 90,
		stopLossAtrMultiple: 1.2,
		partialTakeProfitRR: 0.8,
		finalTakeProfitRR: 2,
		trailingAtrMultiple: 1,
		maxDrawdownPerTradePct: 0.01,
		dailyDrawdownLimitPct: 0.03,
	},
};
