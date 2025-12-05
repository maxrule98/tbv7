import { Candle, TradeIntent } from "../../types";
import { createLogger } from "../../utils/logger";
import {
	AtrContext,
	BiasSummary,
	StrategyContextSnapshot,
	StrategyFlags,
	StrategySetups,
	StrategySetupChecks,
	VwapContext,
} from "./entryLogic";

export class VwapDeltaGammaMetrics {
	private readonly logger = createLogger("vwap-delta-gamma");

	emitContext(
		latest: Candle,
		payload: {
			vwapContext: VwapContext;
			atrContext: AtrContext;
			mtfBias: BiasSummary;
			macdForecast: number | null;
			flags: StrategyFlags;
			setupChecks: StrategySetupChecks;
			setups: StrategySetups;
		}
	): void {
		this.logger.info("strategy_context", {
			strategy: "VWAPDeltaGamma",
			symbol: latest.symbol,
			timeframe: latest.timeframe,
			timestamp: new Date(latest.timestamp).toISOString(),
			price: latest.close,
			vwap: {
				daily: payload.vwapContext.daily.value,
				weekly: payload.vwapContext.weekly.value,
				monthly: payload.vwapContext.monthly.value,
				rolling50: payload.vwapContext.rolling50.value,
				rolling200: payload.vwapContext.rolling200.value,
			},
			delta: {
				daily: payload.vwapContext.daily.delta,
				weekly: payload.vwapContext.weekly.delta,
				monthly: payload.vwapContext.monthly.delta,
				rolling50: payload.vwapContext.rolling50.delta,
				rolling200: payload.vwapContext.rolling200.delta,
			},
			atr: {
				atr1m: payload.atrContext.atr1m,
				atr5m: payload.atrContext.atr5m,
				low: payload.atrContext.low,
				expanding: payload.atrContext.expanding,
			},
			bias: payload.mtfBias,
			flags: payload.flags,
			macdForecast: payload.macdForecast,
			setupChecks: payload.setupChecks,
			setups: payload.setups,
		});
	}

	emitSetups(latest: Candle, setups: StrategySetups): void {
		if (!Object.values(setups).some(Boolean)) {
			return;
		}
		this.logger.info("setups_eval", {
			strategy: "VWAPDeltaGamma",
			symbol: latest.symbol,
			timeframe: latest.timeframe,
			timestamp: new Date(latest.timestamp).toISOString(),
			setups,
		});
	}

	emitDecision(
		latest: Candle,
		intent: TradeIntent,
		ctx: StrategyContextSnapshot
	): void {
		this.logger.info("setups_decision", {
			strategy: "VWAPDeltaGamma",
			symbol: latest.symbol,
			timeframe: latest.timeframe,
			timestamp: new Date(latest.timestamp).toISOString(),
			position: ctx.position,
			intent: intent.intent,
			reason: intent.reason,
			setups: ctx.setups,
		});
	}
}
