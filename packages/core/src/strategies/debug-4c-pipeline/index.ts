import fs from "node:fs";
import { getDefaultStrategyDir, resolveStrategyConfigPath } from "../../config";
import {
	MultiTimeframeCache,
	MultiTimeframeCacheOptions,
	createMTFCache,
} from "../../data/multiTimeframeCache";
import { Candle, PositionSide, TradeIntent } from "../../types";
import {
	DEBUG_4C_PIPELINE_ID,
	Debug4cPipelineConfig,
	Debug4cPipelineDeps,
	debug4cPipelineManifest,
} from "./config";
import { Debug4cPipelineSequencer } from "./entryLogic";
import { Debug4cPipelineMetrics } from "./metrics";

export class Debug4cPipelineStrategy {
	private readonly sequencer = new Debug4cPipelineSequencer();
	private readonly metrics = new Debug4cPipelineMetrics();

	constructor(
		private readonly config: Debug4cPipelineConfig,
		private readonly deps: Debug4cPipelineDeps
	) {
		if (this.config.timeframes.execution !== "1m") {
			throw new Error(
				"debug_4c_pipeline requires the execution timeframe to be exactly 1m"
			);
		}
	}

	async decide(position: PositionSide = "FLAT"): Promise<TradeIntent> {
		const executionTf = this.config.timeframes.execution;
		const candles = await this.deps.cache.getCandles(executionTf);
		if (!candles.length) {
			return this.noAction("no_candles");
		}

		const latest = candles[candles.length - 1] as Candle;
		const intent = this.sequencer.nextIntent(latest, position);
		this.metrics.emitEvent({
			intent: intent.intent,
			timestamp: latest.timestamp,
		});
		return intent;
	}

	private noAction(reason: string): TradeIntent {
		return {
			symbol: this.config.symbol,
			intent: "NO_ACTION",
			reason,
		};
	}
}

export const createDebug4cPipelineCache = (
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
		limit: 10,
	});

export const loadDebug4cPipelineConfig = (
	configPath = resolveStrategyConfigPath(
		getDefaultStrategyDir(),
		"debug-4c-pipeline"
	)
): Debug4cPipelineConfig => {
	const contents = fs.readFileSync(configPath, "utf-8");
	return JSON.parse(contents) as Debug4cPipelineConfig;
};

export const debug4cPipelineModule = {
	id: DEBUG_4C_PIPELINE_ID,
	manifest: debug4cPipelineManifest,
	defaultProfile: "debug-4c-pipeline",
	createStrategy: (config: Debug4cPipelineConfig, deps: Debug4cPipelineDeps) =>
		new Debug4cPipelineStrategy(config, deps),
	loadConfig: loadDebug4cPipelineConfig,
	dependencies: {
		createCache: createDebug4cPipelineCache,
		buildBacktestDeps: (
			_config: Debug4cPipelineConfig,
			{ cache }: { cache: MultiTimeframeCache }
		): Debug4cPipelineDeps => ({ cache }),
	},
};

export default debug4cPipelineModule;
