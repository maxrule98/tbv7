import { Candle, PositionSide, TradeIntent, MINUTE_MS } from "../../types";
import { StrategyContextSnapshot } from "./entryLogic";
import { UltraAggressiveBtcUsdtConfig } from "./config";

const TRAILING_LOCK_PCT = 0.002; // 0.2%
const LATERAL_STALL_PCT = 0.001; // 0.1%
const LATERAL_STALL_BARS = 5;

export interface PositionMemoryState {
	side: PositionSide;
	openedAt: number;
	entryPrice: number;
	stop: number | null;
	atrOnEntry: number | null;
	bestFavorablePrice: number;
}

export interface ExitEvaluationResult {
	intent: TradeIntent | null;
	reason?: string;
}

export const evaluateExitDecision = (
	ctx: StrategyContextSnapshot,
	position: PositionSide,
	config: UltraAggressiveBtcUsdtConfig,
	memory: PositionMemoryState | null
): ExitEvaluationResult => {
	if (position === "FLAT") {
		return { intent: null };
	}
	if (!memory) {
		return { intent: null };
	}
	const latestTs = ctx.timestamp;
	const maxDuration = config.maxTradeDurationMinutes * MINUTE_MS;
	if (latestTs - memory.openedAt >= maxDuration) {
		return {
			intent: buildCloseIntent(ctx, position, "max_duration_exit"),
			reason: "max_duration_exit",
		};
	}
	if (shouldExitForPerTradeDrawdown(ctx.price, memory, config)) {
		return {
			intent: buildCloseIntent(ctx, position, "perTradeDrawdown"),
			reason: "perTradeDrawdown",
		};
	}
	if (shouldTriggerTrailingStop(ctx.price, memory)) {
		return {
			intent: buildCloseIntent(ctx, position, "trailingStop"),
			reason: "trailingStop",
		};
	}
	if (shouldExitForLateralStall(ctx, memory)) {
		return {
			intent: buildCloseIntent(ctx, position, "lateralStall"),
			reason: "lateralStall",
		};
	}

	if (position === "LONG") {
		if (
			ctx.indicator.vwap &&
			ctx.price < ctx.indicator.vwap &&
			ctx.trendDirection !== "TrendingUp"
		) {
			return {
				intent: buildCloseIntent(ctx, position, "lost_vwap_support"),
				reason: "lost_vwap_support",
			};
		}
		if (ctx.indicator.rsi && ctx.indicator.rsi > 80) {
			return {
				intent: buildCloseIntent(ctx, position, "rsi_extreme_exit"),
				reason: "rsi_extreme_exit",
			};
		}
	}

	if (position === "SHORT") {
		if (
			ctx.indicator.vwap &&
			ctx.price > ctx.indicator.vwap &&
			ctx.trendDirection !== "TrendingDown"
		) {
			return {
				intent: buildCloseIntent(ctx, position, "lost_vwap_resistance"),
				reason: "lost_vwap_resistance",
			};
		}
		if (ctx.indicator.rsi && ctx.indicator.rsi < 20) {
			return {
				intent: buildCloseIntent(ctx, position, "rsi_extreme_exit"),
				reason: "rsi_extreme_exit",
			};
		}
	}

	if (
		config.enableVolatilityFadeExit &&
		memory.atrOnEntry &&
		ctx.indicator.atr1m &&
		ctx.recentExecutionCandles.length >= 5
	) {
		const atrDrop = ctx.indicator.atr1m <= memory.atrOnEntry * 0.8;
		const window: Candle[] = ctx.recentExecutionCandles.slice(-5);
		const closesHigh = Math.max(...window.map((c) => c.close));
		const closesLow = Math.min(...window.map((c) => c.close));
		const stallRange = closesHigh - closesLow;
		const stallThreshold = memory.atrOnEntry * 0.3;
		if (atrDrop && stallRange <= stallThreshold) {
			return {
				intent: buildCloseIntent(ctx, position, "volatilityFade"),
				reason: "volatilityFade",
			};
		}
	}

	return { intent: null };
};

const buildCloseIntent = (
	ctx: StrategyContextSnapshot,
	position: PositionSide,
	reason: string
): TradeIntent => {
	const intent = position === "LONG" ? "CLOSE_LONG" : "CLOSE_SHORT";
	return {
		symbol: ctx.symbol,
		intent,
		reason,
		timestamp: ctx.timestamp,
		metadata: {
			price: ctx.price,
			trendDirection: ctx.trendDirection,
			volRegime: ctx.volRegime,
		},
	};
};

const shouldExitForPerTradeDrawdown = (
	price: number,
	memory: PositionMemoryState,
	config: UltraAggressiveBtcUsdtConfig
): boolean => {
	if (config.maxDrawdownPerTradePct <= 0) {
		return false;
	}
	const pnlPct = computePnLPct(price, memory);
	return pnlPct <= -config.maxDrawdownPerTradePct;
};

const shouldTriggerTrailingStop = (
	price: number,
	memory: PositionMemoryState
): boolean => {
	const threshold =
		memory.side === "LONG"
			? memory.entryPrice * (1 + TRAILING_LOCK_PCT)
			: memory.entryPrice * (1 - TRAILING_LOCK_PCT);
	const hasBuffer =
		memory.side === "LONG"
			? memory.bestFavorablePrice >= threshold
			: memory.bestFavorablePrice <= threshold;
	if (!hasBuffer) {
		return false;
	}
	return memory.side === "LONG" ? price <= threshold : price >= threshold;
};

const shouldExitForLateralStall = (
	ctx: StrategyContextSnapshot,
	memory: PositionMemoryState
): boolean => {
	if (ctx.recentExecutionCandles.length < LATERAL_STALL_BARS) {
		return false;
	}
	const window = ctx.recentExecutionCandles.slice(-LATERAL_STALL_BARS);
	const high = Math.max(...window.map((c) => c.high));
	const low = Math.min(...window.map((c) => c.low));
	const range = high - low;
	const basis = ctx.price || memory.entryPrice;
	if (basis === 0 || range <= 0) {
		return false;
	}
	const rangePct = range / basis;
	if (rangePct > LATERAL_STALL_PCT) {
		return false;
	}
	const pnlPct = computePnLPct(ctx.price, memory);
	return pnlPct >= LATERAL_STALL_PCT;
};

const computePnLPct = (price: number, memory: PositionMemoryState): number => {
	if (!price || !memory.entryPrice) {
		return 0;
	}
	const raw =
		memory.side === "LONG"
			? (price - memory.entryPrice) / memory.entryPrice
			: (memory.entryPrice - price) / memory.entryPrice;
	return Number(raw.toFixed(6));
};
