import {
	ActivePositionSide,
	PositionSide,
	TradeAction,
	TradeIntent,
	TradeOrderSide,
} from "@agenai/core";

export interface TradePlan {
	symbol: string;
	action: TradeAction;
	positionSide: ActivePositionSide;
	side: TradeOrderSide;
	type: "market";
	quantity: number;
	stopLossPrice: number;
	takeProfitPrice: number;
	reason: string;
}

export interface PositionSnapshotLike {
	side: PositionSide;
	size: number;
}

export interface RiskConfig {
	riskPerTradePercent: number;
	slPct: number;
	tpPct: number;
	minPositionSize: number;
	maxPositionSize: number;
	trailingActivationPct: number;
	trailingTrailPct: number;
}

export class RiskManager {
	constructor(private readonly config: RiskConfig) {}

	plan(
		intent: TradeIntent,
		lastPrice: number,
		accountEquity: number,
		positionState: PositionSnapshotLike
	): TradePlan | null {
		if (intent.intent === "NO_ACTION") {
			return null;
		}

		switch (intent.intent) {
			case "OPEN_LONG":
				return this.buildOpenPlan("LONG", intent, lastPrice, accountEquity);
			case "OPEN_SHORT":
				return this.buildOpenPlan("SHORT", intent, lastPrice, accountEquity);
			case "CLOSE_LONG":
				return this.buildClosePlan("LONG", intent, lastPrice, positionState);
			case "CLOSE_SHORT":
				return this.buildClosePlan("SHORT", intent, lastPrice, positionState);
			default:
				return null;
		}
	}

	private buildOpenPlan(
		positionSide: ActivePositionSide,
		intent: TradeIntent,
		entryPrice: number,
		accountEquity: number
	): TradePlan | null {
		const stopLossPrice = this.calculateStopLoss(entryPrice, positionSide);
		const takeProfitPrice = this.calculateTakeProfit(entryPrice, positionSide);
		const quantity = this.calculatePositionSize(
			accountEquity,
			entryPrice,
			stopLossPrice
		);
		if (quantity === null) {
			return null;
		}
		return {
			symbol: intent.symbol,
			action: "OPEN",
			positionSide,
			side: this.getOrderSide(positionSide, "OPEN"),
			type: "market",
			quantity,
			stopLossPrice,
			takeProfitPrice,
			reason: intent.reason,
		};
	}

	private buildClosePlan(
		positionSide: ActivePositionSide,
		intent: TradeIntent,
		lastPrice: number,
		positionState: PositionSnapshotLike
	): TradePlan | null {
		if (positionState.side !== positionSide || positionState.size <= 0) {
			return null;
		}
		return {
			symbol: intent.symbol,
			action: "CLOSE",
			positionSide,
			side: this.getOrderSide(positionSide, "CLOSE"),
			type: "market",
			quantity: positionState.size,
			stopLossPrice: lastPrice,
			takeProfitPrice: lastPrice,
			reason: intent.reason,
		};
	}

	private calculateStopLoss(
		price: number,
		positionSide: ActivePositionSide
	): number {
		const pct = this.config.slPct / 100;
		const multiplier = positionSide === "LONG" ? 1 - pct : 1 + pct;
		return this.round(price * multiplier);
	}

	private calculateTakeProfit(
		price: number,
		positionSide: ActivePositionSide
	): number {
		const pct = this.config.tpPct / 100;
		const multiplier = positionSide === "LONG" ? 1 + pct : 1 - pct;
		return this.round(price * multiplier);
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

	private getOrderSide(
		positionSide: ActivePositionSide,
		action: TradeAction
	): TradeOrderSide {
		if (action === "OPEN") {
			return positionSide === "LONG" ? "buy" : "sell";
		}
		return positionSide === "LONG" ? "sell" : "buy";
	}

	private round(price: number): number {
		return parseFloat(price.toFixed(2));
	}
}
