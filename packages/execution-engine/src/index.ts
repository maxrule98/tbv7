import { PositionSide } from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
import { TradePlan } from "@agenai/risk-engine";
import {
	ClosedTrade,
	PaperAccount,
	PaperAccountSnapshot,
} from "./paperAccount";

export type ExecutionMode = "paper" | "live";

export interface ExecutionEngineOptions {
	client: MexcClient;
	mode?: ExecutionMode;
	paperAccount?: PaperAccount;
}

export { PaperAccount } from "./paperAccount";
export type { PaperAccountSnapshot, ClosedTrade } from "./paperAccount";

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
	entryPrice: number;
	peakPrice: number;
	trailingStopPrice: number;
	isTrailingActive: boolean;
	stopLossPrice?: number;
	takeProfitPrice?: number;
}

interface PaperPosition extends PaperPositionSnapshot {}

export class ExecutionEngine {
	private readonly mode: ExecutionMode;
	private readonly paperPositions = new Map<string, PaperPosition>();
	private readonly paperAccount?: PaperAccount;

	constructor(private readonly options: ExecutionEngineOptions) {
		this.mode = options.mode ?? "paper";
		this.paperAccount = options.paperAccount;
	}

	getPosition(symbol: string): PaperPositionSnapshot {
		return { ...this.ensurePaperPosition(symbol) };
	}

	getPaperPosition(symbol: string): PaperPositionSnapshot {
		return this.getPosition(symbol);
	}

	updatePosition(
		symbol: string,
		updates: Partial<PaperPosition>
	): PaperPositionSnapshot {
		const position = this.ensurePaperPosition(symbol);
		Object.assign(position, updates);
		return { ...position };
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

	hasPaperAccount(): boolean {
		return Boolean(this.paperAccount);
	}

	snapshotPaperAccount(unrealizedPnl: number): PaperAccountSnapshot | null {
		if (!this.paperAccount) {
			return null;
		}

		return this.paperAccount.snapshot(unrealizedPnl);
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
			position.entryPrice = fillPrice;
			position.peakPrice = fillPrice;
			position.trailingStopPrice = plan.stopLossPrice;
			position.isTrailingActive = false;
			position.stopLossPrice = plan.stopLossPrice;
			position.takeProfitPrice = plan.takeProfitPrice;
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
		const entryPrice = position.avgEntryPrice!;
		const realizedPnl = (fillPrice - entryPrice) * closedQuantity;
		position.realizedPnl += realizedPnl;

		if (this.paperAccount) {
			const closedTrade: ClosedTrade = {
				symbol: plan.symbol,
				side: "LONG",
				size: closedQuantity,
				entryPrice,
				exitPrice: fillPrice,
				realizedPnl,
				timestamp: new Date().toISOString(),
			};
			const snapshot = this.paperAccount.registerClosedTrade(closedTrade);
			this.logPaperAccountUpdate(plan.symbol, snapshot);
		}

		position.side = "FLAT";
		position.size = 0;
		position.avgEntryPrice = null;
		position.entryPrice = 0;
		position.peakPrice = 0;
		position.trailingStopPrice = 0;
		position.isTrailingActive = false;
		position.stopLossPrice = undefined;
		position.takeProfitPrice = undefined;

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
				entryPrice: 0,
				peakPrice: 0,
				trailingStopPrice: 0,
				isTrailingActive: false,
				stopLossPrice: undefined,
				takeProfitPrice: undefined,
			});
		}

		return this.paperPositions.get(symbol)!;
	}

	private logPaperAccountUpdate(
		symbol: string,
		snapshot: PaperAccountSnapshot
	): void {
		console.log(
			JSON.stringify({
				event: "paper_account_update",
				symbol,
				snapshot,
			})
		);
	}
}
