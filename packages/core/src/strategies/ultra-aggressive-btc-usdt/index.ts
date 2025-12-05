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
	RiskControlState,
	StrategyContextSnapshot,
	buildStrategyContext,
	selectEntryDecision,
	evaluateRiskBlocks,
} from "./entryLogic";
import { evaluateExitDecision, PositionMemoryState } from "./exitLogic";
import { UltraAggressiveMetrics } from "./metrics";

export class UltraAggressiveBtcUsdtStrategy {
	private positionMemory: PositionMemoryState | null = null;
	private readonly metrics = new UltraAggressiveMetrics();
	private cooldownBarsRemaining = 0;
	private lastExitReason: string | null = null;
	private lastRealizedPnLPct: number | null = null;
	private sessionDate: string | null = null;
	private sessionPnLPct = 0;
	private lastContextTimestamp: number | null = null;

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

		const latest = executionCandles[executionCandles.length - 1];
		this.syncPositionWithRuntime(position, latest);
		this.handleNewTimestamp(latest.timestamp);
		this.ensureSessionDate(latest.timestamp);
		const ctx = buildStrategyContext(
			executionCandles,
			confirmingCandles,
			contextCandles,
			this.config,
			this.getRiskControlState()
		);

		this.metrics.emitContext(ctx);
		this.metrics.emitDiagnostics(ctx);

		const atrSnapshot = ctx.indicator.atr1m ?? null;
		if (this.positionMemory && this.positionMemory.atrOnEntry === null) {
			this.positionMemory.atrOnEntry = atrSnapshot;
		}
		this.updateFavorablePrice(latest.close);

		if (position === "FLAT") {
			const blockReason = evaluateRiskBlocks(ctx, this.config);
			if (blockReason) {
				return this.noAction(blockReason, executionCandles);
			}
			const entryDecision = selectEntryDecision(ctx, this.config);
			if (!entryDecision) {
				return this.noAction("no_signal", executionCandles);
			}
			this.positionMemory = {
				side: entryDecision.intent === "OPEN_LONG" ? "LONG" : "SHORT",
				openedAt: latest.timestamp,
				entryPrice: latest.close,
				stop: entryDecision.stop,
				atrOnEntry: atrSnapshot,
				bestFavorablePrice: latest.close,
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
			const exitReason = exitResult.reason ?? "exit";
			this.metrics.emitExit(ctx, position, exitReason);
			this.recordExitStats(exitReason, ctx.timestamp, ctx.price);
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

	private syncPositionWithRuntime(
		position: PositionSide,
		latest: Candle
	): void {
		if (position === this.positionMemory?.side) {
			return;
		}
		if (position === "FLAT") {
			if (this.positionMemory) {
				this.recordExitStats("external_exit", latest.timestamp, latest.close);
			}
			this.positionMemory = null;
			return;
		}
		this.positionMemory = {
			side: position,
			openedAt: latest.timestamp,
			entryPrice: latest.close,
			stop: null,
			atrOnEntry: null,
			bestFavorablePrice: latest.close,
		};
	}

	private handleNewTimestamp(timestamp: number): void {
		if (
			this.lastContextTimestamp !== null &&
			timestamp <= this.lastContextTimestamp
		) {
			return;
		}
		this.lastContextTimestamp = timestamp;
		if (this.cooldownBarsRemaining > 0) {
			this.cooldownBarsRemaining = Math.max(0, this.cooldownBarsRemaining - 1);
		}
	}

	private ensureSessionDate(timestamp: number): void {
		const dayKey = new Date(timestamp).toISOString().slice(0, 10);
		if (this.sessionDate === dayKey) {
			return;
		}
		this.sessionDate = dayKey;
		this.sessionPnLPct = 0;
	}

	private getRiskControlState(): RiskControlState {
		return {
			lastExitReason: this.lastExitReason,
			lastRealizedPnLPct: this.lastRealizedPnLPct,
			cooldownBarsRemaining: this.cooldownBarsRemaining,
			sessionPnLPct: this.sessionPnLPct,
		};
	}

	private updateFavorablePrice(price: number): void {
		if (!this.positionMemory) {
			return;
		}
		if (this.positionMemory.side === "LONG") {
			this.positionMemory.bestFavorablePrice = Math.max(
				this.positionMemory.bestFavorablePrice,
				price
			);
			return;
		}
		this.positionMemory.bestFavorablePrice = Math.min(
			this.positionMemory.bestFavorablePrice,
			price
		);
	}

	private recordExitStats(
		reason: string,
		timestamp: number,
		exitPrice: number
	): void {
		if (!this.positionMemory) {
			this.lastExitReason = reason;
			this.lastRealizedPnLPct = null;
			return;
		}
		this.ensureSessionDate(timestamp);
		const pnlPct = this.computePnLPct(exitPrice, this.positionMemory);
		this.lastExitReason = reason;
		this.lastRealizedPnLPct = pnlPct;
		this.sessionPnLPct += pnlPct;
		if (
			reason === "perTradeDrawdown" &&
			this.config.cooldownAfterStopoutBars > 0
		) {
			this.cooldownBarsRemaining = this.config.cooldownAfterStopoutBars;
		}
		this.positionMemory = null;
	}

	private computePnLPct(price: number, memory: PositionMemoryState): number {
		if (memory.entryPrice === 0) {
			return 0;
		}
		const raw =
			memory.side === "LONG"
				? (price - memory.entryPrice) / memory.entryPrice
				: (memory.entryPrice - price) / memory.entryPrice;
		return Number(raw.toFixed(6));
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
	dependencies: {
		createCache: createUltraAggressiveCache,
	},
};

export default ultraAggressiveModule;
