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
	UltraAggressiveBtcUsdtConfig,
	UltraAggressiveDeps,
	ULTRA_AGGRESSIVE_ID,
	ultraAggressiveManifest,
} from "./config";
import {
	StrategyContextSnapshot,
	buildStrategyContext,
	selectEntryDecision,
} from "./entryLogic";
import { evaluateExitDecision, PositionMemoryState } from "./exitLogic";
import { UltraAggressiveMetrics } from "./metrics";

export class UltraAggressiveBtcUsdtStrategy {
	private positionMemory: PositionMemoryState | null = null;
	private readonly metrics = new UltraAggressiveMetrics();

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

		const ctx = buildStrategyContext(
			executionCandles,
			confirmingCandles,
			contextCandles,
			this.config
		);

		this.metrics.emitContext(ctx);
		this.metrics.emitDiagnostics(ctx);

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
			const entryDecision = selectEntryDecision(ctx, this.config.risk);
			if (!entryDecision) {
				return this.noAction("no_signal", executionCandles);
			}
			this.positionMemory = {
				side: entryDecision.intent === "OPEN_LONG" ? "LONG" : "SHORT",
				openedAt: latest.timestamp,
				entryPrice: latest.close,
				stop: entryDecision.stop,
			};
			this.metrics.emitEntry(ctx, entryDecision);
			return this.buildIntent(latest, entryDecision);
		}

		const exitResult = evaluateExitDecision(
			ctx,
			position,
			this.config,
			this.positionMemory
		);
		if (exitResult.intent) {
			this.metrics.emitExit(ctx, position, exitResult.reason ?? "exit");
			this.positionMemory = null;
			return exitResult.intent;
		}

		return this.noAction("manage_position", executionCandles);
	}

	private buildIntent(
		latest: Candle,
		decision: {
			intent: TradeIntent["intent"];
			reason: string;
			stop: number | null;
			tp1: number | null;
			tp2: number | null;
			confidence: number;
		}
	): TradeIntent {
		return {
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

export { ULTRA_AGGRESSIVE_ID, ultraAggressiveManifest } from "./config";
export type {
	UltraAggressiveBtcUsdtConfig,
	UltraAggressiveDeps,
	UltraAggressiveLookbacks,
	UltraAggressiveRiskConfig,
	UltraAggressiveRiskRulesSummary,
	UltraAggressiveStrategyManifest,
	UltraAggressiveThresholds,
} from "./config";

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
		"config",
		"strategies",
		"ultra-aggressive-btc-usdt.json"
	)
): UltraAggressiveBtcUsdtConfig => {
	const contents = fs.readFileSync(configPath, "utf-8");
	return JSON.parse(contents) as UltraAggressiveBtcUsdtConfig;
};

export const ultraAggressiveModule = {
	id: ULTRA_AGGRESSIVE_ID,
	manifest: ultraAggressiveManifest,
	createStrategy: (
		config: UltraAggressiveBtcUsdtConfig,
		deps: UltraAggressiveDeps
	) => new UltraAggressiveBtcUsdtStrategy(config, deps),
	loadConfig: loadUltraAggressiveConfig,
};

export default ultraAggressiveModule;
