import { MultiTimeframeCache } from "../../data/multiTimeframeCache";
import type { StrategyId } from "../types";

export const DEBUG_4C_PIPELINE_ID: StrategyId = "debug_4c_pipeline";

export interface Debug4cPipelineConfig {
	name: string;
	symbol: string;
	timeframes: {
		execution: string;
	};
	historyWindowCandles?: number;
	cacheTTLms?: number;
	warmupPeriods?: Record<string, number>;
}

export interface Debug4cPipelineDeps {
	cache: MultiTimeframeCache;
}

export interface Debug4cPipelineManifest {
	strategyId: StrategyId;
	name: string;
	defaultPair: string;
	defaultTimeframes: {
		execution: string;
	};
	sequence: string[];
}

export const debug4cPipelineManifest: Debug4cPipelineManifest = {
	strategyId: DEBUG_4C_PIPELINE_ID,
	name: "Debug 4C Pipeline",
	defaultPair: "BTC/USDT",
	defaultTimeframes: {
		execution: "1m",
	},
	sequence: ["OPEN_LONG", "CLOSE_LONG", "OPEN_SHORT", "CLOSE_SHORT"],
};
