import { PositionSide, TradeIntent } from "../../types";
import { StrategyContextSnapshot } from "./entryLogic";
import { UltraAggressiveBtcUsdtConfig } from "./config";

export interface PositionMemoryState {
	side: PositionSide;
	openedAt: number;
	entryPrice: number;
	stop: number | null;
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
	const latestTs = ctx.timestamp;
	const maxDuration = config.maxTradeDurationMinutes * 60 * 1000;
	if (memory && latestTs - memory.openedAt >= maxDuration) {
		return {
			intent: buildCloseIntent(ctx, position, "max_duration_exit"),
			reason: "max_duration_exit",
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
