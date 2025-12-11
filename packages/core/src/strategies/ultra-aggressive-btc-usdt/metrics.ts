import { PositionSide } from "../../types";
import { summarizeCandles } from "../../utils/fingerprint";
import { createLogger } from "../../utils/logger";
import { StrategyContextSnapshot, SetupDecision } from "./entryLogic";

export class UltraAggressiveMetrics {
	private readonly logger = createLogger("ultra-agg-btc-usdt");

	emitContext(snapshot: StrategyContextSnapshot): void {
		this.logger.info("strategy_context", {
			strategy: "UltraAggressiveBtcUsdt",
			symbol: snapshot.symbol,
			timeframe: snapshot.timeframe,
			price: snapshot.price,
			timestamp: new Date(snapshot.timestamp).toISOString(),
			trend: snapshot.trendDirection,
			volatility: snapshot.volRegime,
			vwap: snapshot.indicator.vwap,
			vwapDeviationPct: snapshot.indicator.vwapDeviationPct,
			atr1m: snapshot.indicator.atr1m,
			atr5m: snapshot.indicator.atr5m,
			emaFast: snapshot.indicator.emaFast,
			emaSlow: snapshot.indicator.emaSlow,
			rsi: snapshot.indicator.rsi,
			cvdTrend: snapshot.indicator.cvdTrend,
			cvdDivergence: snapshot.indicator.cvdDivergence,
			levels: snapshot.levels,
			setups: snapshot.setups,
			riskState: snapshot.riskState,
		});
	}

	emitDiagnostics(snapshot: StrategyContextSnapshot): void {
		if (!snapshot.setupDiagnostics.length) {
			return;
		}
		const recentWindow = summarizeCandles(snapshot.recentExecutionCandles, 15);
		this.logger.info("strategy_diagnostics", {
			strategy: "UltraAggressiveBtcUsdt",
			symbol: snapshot.symbol,
			timeframe: snapshot.timeframe,
			timestamp: new Date(snapshot.timestamp).toISOString(),
			price: snapshot.price,
			trend: snapshot.trendDirection,
			volatility: snapshot.volRegime,
			indicator: {
				vwapDeviationPct: snapshot.indicator.vwapDeviationPct,
				rsi: snapshot.indicator.rsi,
				atr1m: snapshot.indicator.atr1m,
				atr5m: snapshot.indicator.atr5m,
				cvdTrend: snapshot.indicator.cvdTrend,
				cvdDivergence: snapshot.indicator.cvdDivergence,
			},
			levels: snapshot.levels,
			setups: snapshot.setups,
			checks: snapshot.setupDiagnostics,
			recentWindow,
		});
	}

	emitEntry(snapshot: StrategyContextSnapshot, decision: SetupDecision): void {
		this.logger.info("strategy_signal", {
			strategy: "UltraAggressiveBtcUsdt",
			symbol: snapshot.symbol,
			intent: decision.intent,
			reason: decision.reason,
			price: snapshot.price,
			timeframe: snapshot.timeframe,
			timestamp: new Date(snapshot.timestamp).toISOString(),
			trend: snapshot.trendDirection,
			volatility: snapshot.volRegime,
			confidence: decision.confidence,
			stop: decision.stop,
			tp1: decision.tp1,
			tp2: decision.tp2,
		});
	}

	emitExit(
		snapshot: StrategyContextSnapshot,
		side: PositionSide,
		reason: string
	): void {
		if (side === "FLAT") {
			return;
		}
		this.logger.info("strategy_exit", {
			reason,
			side,
			price: snapshot.price,
			timestamp: new Date(snapshot.timestamp).toISOString(),
			trend: snapshot.trendDirection,
			volatility: snapshot.volRegime,
		});
	}
}
