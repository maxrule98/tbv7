import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRoot } from "../../config";
import {
	MultiTimeframeCache,
	MultiTimeframeCacheOptions,
	createMTFCache,
} from "../../data/multiTimeframeCache";
import { Candle, PositionSide, TradeIntent } from "../../types";
import {
	VWAPDeltaGammaConfig,
	VWAPDeltaGammaStrategyDependencies,
	VWAP_DELTA_GAMMA_ID,
	vwapManifest,
} from "./config";
import {
	AtrContext,
	BiasSummary,
	StrategyContextSnapshot,
	StrategyEvaluation,
	StrategyRecommendations,
	StrategySetups,
	buildAtrContext,
	buildVwapContext,
	computeBiasSummary,
	computeDeltaHistory,
	computeMacdForecast,
	computeRecommendations,
	computeSetups,
	evaluateStrategy,
	pickLongEntryReason,
	pickShortEntryReason,
	VwapContext,
} from "./entryLogic";
import { resolveExitReason } from "./exitLogic";
import { VwapDeltaGammaMetrics } from "./metrics";

export class VWAPDeltaGammaStrategy {
	private readonly metrics = new VwapDeltaGammaMetrics();

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

		const latest = executionCandles.at(-1) as Candle;
		const prev = executionCandles.length > 1 ? executionCandles.at(-2)! : null;
		const vwapContext = buildVwapContext(
			executionCandles,
			trendCandles,
			this.config
		);
		const atrContext = buildAtrContext(
			executionCandles,
			trendCandles,
			this.config
		);
		const mtfBias = computeBiasSummary(trendCandles, biasCandles, macroCandles);
		const macdForecast = computeMacdForecast(executionCandles);
		const deltaHistory = computeDeltaHistory(
			executionCandles,
			vwapContext.daily.value
		);
		const evaluation = evaluateStrategy(
			latest,
			prev,
			vwapContext,
			atrContext,
			mtfBias,
			macdForecast,
			deltaHistory,
			position,
			this.config
		);
		const recommendations = computeRecommendations(
			latest,
			vwapContext,
			atrContext
		);
		const setups = computeSetups({
			setupChecks: evaluation.setupChecks,
			bias: mtfBias,
			trendRegime: evaluation.flags.trendRegime,
		});
		const ctx: StrategyContextSnapshot = {
			latest,
			position,
			bias: mtfBias,
			regime: {
				trend: evaluation.flags.trendRegime,
				volatility: evaluation.flags.volatilityRegime,
			},
			setupChecks: evaluation.setupChecks,
			setups,
			exits: evaluation.exits,
		};

		this.metrics.emitContext(latest, {
			vwapContext,
			atrContext,
			mtfBias,
			macdForecast,
			flags: evaluation.flags,
			setupChecks: evaluation.setupChecks,
			setups,
		});
		this.metrics.emitSetups(latest, setups);

		const intent = this.resolveIntent(ctx, recommendations);
		this.metrics.emitDecision(latest, intent, ctx);
		return intent;
	}

	private resolveIntent(
		ctx: StrategyContextSnapshot,
		recommendations: StrategyRecommendations
	): TradeIntent {
		const { latest, position, setups } = ctx;
		if (position === "FLAT") {
			const longReason = pickLongEntryReason(setups);
			if (longReason) {
				return this.tradeIntent(
					latest,
					"OPEN_LONG",
					longReason,
					recommendations
				);
			}
			const shortReason = pickShortEntryReason(setups);
			if (shortReason) {
				return this.tradeIntent(
					latest,
					"OPEN_SHORT",
					shortReason,
					recommendations
				);
			}
			return this.noAction([latest], "no_signal");
		}

		const exitReason = resolveExitReason(ctx, position);
		if (exitReason) {
			return this.tradeIntent(
				latest,
				position === "LONG" ? "CLOSE_LONG" : "CLOSE_SHORT",
				exitReason,
				recommendations
			);
		}

		return this.noAction(
			[latest],
			position === "LONG" ? "hold_long" : "hold_short"
		);
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
}

export { VWAP_DELTA_GAMMA_ID, vwapManifest } from "./config";
export type {
	VWAPDeltaGammaConfig,
	VWAPDeltaGammaStrategyDependencies,
	VWAPRiskRulesSummary,
	VWAPStrategyManifest,
} from "./config";

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
		"config",
		"strategies",
		"vwap-delta-gamma.json"
	)
): VWAPDeltaGammaConfig => {
	const contents = fs.readFileSync(configPath, "utf-8");
	return JSON.parse(contents) as VWAPDeltaGammaConfig;
};

export const vwapDeltaGammaModule = {
	id: VWAP_DELTA_GAMMA_ID,
	manifest: vwapManifest,
	createStrategy: (
		config: VWAPDeltaGammaConfig,
		deps: VWAPDeltaGammaStrategyDependencies
	) => new VWAPDeltaGammaStrategy(config, deps),
	loadConfig: loadVWAPDeltaGammaConfig,
};

export default vwapDeltaGammaModule;
