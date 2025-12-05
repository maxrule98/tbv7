import { MultiTimeframeCache } from "../../data/multiTimeframeCache";
import { StrategyId } from "../ids";

export const VWAP_DELTA_GAMMA_ID: StrategyId = "vwap_delta_gamma";

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

export interface VWAPRiskRulesSummary {
	trendEntryRequiresAtr: boolean;
	minAtr1m?: number;
	minAtr5m?: number;
	breakoutNeedsExpansion: boolean;
}

export interface VWAPStrategyManifest {
	strategyId: StrategyId;
	name: string;
	defaultPair: string;
	defaultTimeframes: VWAPDeltaGammaConfig["timeframes"];
	riskRules: VWAPRiskRulesSummary;
}

export const vwapManifest: VWAPStrategyManifest = {
	strategyId: VWAP_DELTA_GAMMA_ID,
	name: "VWAP Delta Gamma",
	defaultPair: "BTC/USDT",
	defaultTimeframes: {
		execution: "1m",
		trend: "5m",
		bias: "15m",
		macro: "1h",
	},
	riskRules: {
		trendEntryRequiresAtr: true,
		minAtr1m: 0,
		minAtr5m: 0,
		breakoutNeedsExpansion: true,
	},
};
