import { TradeIntent } from "@agenai/core";

export interface TradePlan {
	symbol: string;
	side: "buy" | "sell";
	type: "market";
	quantity: number;
	stopLossPrice: number;
	takeProfitPrice: number;
	reason: string;
}

export interface RiskConfig {
	riskPerTradePercent: number;
	slPct: number;
	tpPct: number;
	minPositionSize: number;
	maxPositionSize: number;
}

export class RiskManager {
	constructor(private readonly config: RiskConfig) {}

	plan(
		intent: TradeIntent,
		lastPrice: number,
		accountEquity: number,
		currentPositionQuantity = 0
	): TradePlan | null {
		if (intent.intent === "NO_ACTION") {
			return null;
		}

		if (intent.intent === "OPEN_LONG") {
			const stopLossPrice = this.calculateStopLoss(lastPrice);
			const takeProfitPrice = this.calculateTakeProfit(lastPrice);
			const quantity = this.calculatePositionSize(
				accountEquity,
				lastPrice,
				stopLossPrice
			);
			if (quantity === null) {
				return null;
			}
			return {
				symbol: intent.symbol,
				side: "buy",
				type: "market",
				quantity,
				stopLossPrice,
				takeProfitPrice,
				reason: intent.reason,
			};
		}

		if (intent.intent === "CLOSE_LONG") {
			if (currentPositionQuantity <= 0) {
				return null;
			}
			return {
				symbol: intent.symbol,
				side: "sell",
				type: "market",
				quantity: currentPositionQuantity,
				stopLossPrice: lastPrice,
				takeProfitPrice: lastPrice,
				reason: intent.reason,
			};
		}

		return null;
	}

	private calculateStopLoss(price: number): number {
		return parseFloat((price * (1 - this.config.slPct / 100)).toFixed(2));
	}

	private calculateTakeProfit(price: number): number {
		return parseFloat((price * (1 + this.config.tpPct / 100)).toFixed(2));
	}

	private calculatePositionSize(
		accountEquity: number,
		entryPrice: number,
		stopLossPrice: number
	): number | null {
		const stopDistance = Math.abs(entryPrice - stopLossPrice);
		if (stopDistance <= 0) {
			return null;
		}

		const riskAmount = accountEquity * this.config.riskPerTradePercent;
		if (riskAmount <= 0) {
			return null;
		}

		let size = riskAmount / stopDistance;
		if (!Number.isFinite(size) || size <= 0) {
			return null;
		}

		size = Math.min(
			Math.max(size, this.config.minPositionSize),
			this.config.maxPositionSize
		);
		return parseFloat(size.toFixed(6));
	}
}
