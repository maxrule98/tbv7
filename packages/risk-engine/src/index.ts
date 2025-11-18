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
	riskPerTradePct: number;
	slPct: number;
	tpPct: number;
	minNotional?: number;
}

export class RiskManager {
	private readonly minNotional: number;
	private readonly minQuantity = 0.001; // TODO: fetch from exchange limits when exchange metadata is wired in.

	constructor(private readonly config: RiskConfig) {
		this.minNotional = config.minNotional ?? 50;
	}

	plan(
		intent: TradeIntent,
		lastPrice: number,
		equity: number,
		currentPositionQuantity = 0
	): TradePlan | null {
		if (intent.intent === "NO_ACTION") {
			return null;
		}

		const notional = Math.max(
			(equity * this.config.riskPerTradePct) / 100,
			this.minNotional
		);
		const computedQuantity = parseFloat((notional / lastPrice).toFixed(4));

		if (intent.intent === "OPEN_LONG") {
			const quantity = this.ensureMinQuantity(computedQuantity);
			return {
				symbol: intent.symbol,
				side: "buy",
				type: "market",
				quantity,
				stopLossPrice: this.calculateStopLoss(lastPrice),
				takeProfitPrice: this.calculateTakeProfit(lastPrice),
				reason: intent.reason,
			};
		}

		if (intent.intent === "CLOSE_LONG") {
			if (currentPositionQuantity <= 0) {
				return null;
			}

			const quantity = this.ensureMinQuantity(currentPositionQuantity);
			return {
				symbol: intent.symbol,
				side: "sell",
				type: "market",
				quantity,
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

	private ensureMinQuantity(quantity: number): number {
		return quantity < this.minQuantity ? this.minQuantity : quantity;
	}
}
