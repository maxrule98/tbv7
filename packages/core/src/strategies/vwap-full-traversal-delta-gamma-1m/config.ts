import type { StrategyId } from "../types";

export const VWAP_FULL_TRAVERSAL_ID: StrategyId =
	"vwap_full_traversal_delta_gamma_1m";

export interface VWAPFullTraversalConfig {
	id: StrategyId;
	name: string;
	symbol: string;
	timeframes: {
		execution: string;
	};
	historyWindowCandles: number;
	warmupPeriods: {
		default: number;
		"1m": number;
	};
	cacheTTLms: number;
	sdMultiplier: number;
	stopMultiplier: number;
	enableDeltaMagnitudeGate?: boolean;
	deltaAbsSmaPeriod?: number;
	deltaAbsMultiplier?: number;
}

export interface VWAPFullTraversalDeps {
	cache: {
		getCandles(timeframe: string): Promise<any[]>;
	};
	deltaProvider: {
		getDelta(timestamp: number): number | null;
		getGamma(timestamp: number): number | null;
	};
}

export const DEFAULT_CONFIG: VWAPFullTraversalConfig = {
	id: VWAP_FULL_TRAVERSAL_ID,
	name: "VWAP Full Traversal Delta Gamma 1m",
	symbol: "BTC/USDT",
	timeframes: {
		execution: "1m",
	},
	historyWindowCandles: 500,
	warmupPeriods: {
		default: 100,
		"1m": 100,
	},
	cacheTTLms: 1500,
	sdMultiplier: 1.5,
	stopMultiplier: 0.25,
	enableDeltaMagnitudeGate: false,
	deltaAbsSmaPeriod: 20,
	deltaAbsMultiplier: 1.0,
};
