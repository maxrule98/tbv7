import { PositionSide } from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
import { TradePlan } from "@agenai/risk-engine";

export type ExecutionMode = "paper" | "live";

export interface ExecutionEngineOptions {
	client: MexcClient;
	mode?: ExecutionMode;
}

export interface ExecutionContext {
	price: number;
}

export interface ExecutionResult {
	symbol: string;
	side: "buy" | "sell";
	quantity: number;
	status: "paper_filled" | "paper_closed" | "submitted" | "unknown" | "skipped";
	price?: number | null;
	mode: ExecutionMode;
	reason?: string;
	realizedPnl?: number;
	totalRealizedPnl?: number;
}

export interface PaperPositionSnapshot {
	side: PositionSide;
	size: number;
	avgEntryPrice: number | null;
	realizedPnl: number;
}

interface PaperPosition extends PaperPositionSnapshot {}

export class ExecutionEngine {
	private readonly mode: ExecutionMode;
	private readonly paperPositions = new Map<string, PaperPosition>();

	constructor(private readonly options: ExecutionEngineOptions) {
		this.mode = options.mode ?? "paper";
	}

	getPaperPosition(symbol: string): PaperPositionSnapshot {
		return { ...this.ensurePaperPosition(symbol) };
	}

	async execute(
		plan: TradePlan,
		context: ExecutionContext
	): Promise<ExecutionResult> {
		if (this.mode === "paper") {
			return this.handlePaperExecution(plan, context);
		}

		const order = await this.options.client.createMarketOrder(
			plan.symbol,
			plan.side,
			plan.quantity
		);
		return {
			symbol: plan.symbol,
			side: plan.side,
			quantity: plan.quantity,
			status: "submitted",
			price: order?.average ?? order?.price ?? context.price ?? null,
			mode: this.mode,
		};
	}

	private handlePaperExecution(
		plan: TradePlan,
		context: ExecutionContext
	): ExecutionResult {
		const position = this.ensurePaperPosition(plan.symbol);
		const fillPrice = context.price;

		if (plan.side === "buy") {
			position.side = "LONG";
			position.size = plan.quantity;
			position.avgEntryPrice = fillPrice;
			return {
				symbol: plan.symbol,
				side: plan.side,
				quantity: plan.quantity,
				status: "paper_filled",
				price: fillPrice,
				mode: this.mode,
				totalRealizedPnl: position.realizedPnl,
			};
		}

		if (
			position.side !== "LONG" ||
			position.size <= 0 ||
			position.avgEntryPrice === null
		) {
			return {
				symbol: plan.symbol,
				side: plan.side,
				quantity: 0,
				status: "skipped",
				price: fillPrice,
				mode: this.mode,
				reason: "no_long_to_close",
			};
		}

		const closedQuantity = position.size;
		const realizedPnl = (fillPrice - position.avgEntryPrice) * closedQuantity;
		position.realizedPnl += realizedPnl;
		position.side = "FLAT";
		position.size = 0;
		position.avgEntryPrice = null;

		return {
			symbol: plan.symbol,
			side: plan.side,
			quantity: closedQuantity,
			status: "paper_closed",
			price: fillPrice,
			mode: this.mode,
			realizedPnl,
			totalRealizedPnl: position.realizedPnl,
		};
	}

	private ensurePaperPosition(symbol: string): PaperPosition {
		if (!this.paperPositions.has(symbol)) {
			this.paperPositions.set(symbol, {
				side: "FLAT",
				size: 0,
				avgEntryPrice: null,
				realizedPnl: 0,
			});
		}

		return this.paperPositions.get(symbol)!;
	}
}
