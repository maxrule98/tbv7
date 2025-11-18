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
	status: "paper_filled" | "submitted" | "unknown";
	price?: number | null;
	mode: ExecutionMode;
}

export class ExecutionEngine {
	private readonly mode: ExecutionMode;

	constructor(private readonly options: ExecutionEngineOptions) {
		this.mode = options.mode ?? "paper";
	}

	async execute(
		plan: TradePlan,
		context: ExecutionContext
	): Promise<ExecutionResult> {
		if (this.mode === "paper") {
			return {
				symbol: plan.symbol,
				side: plan.side,
				quantity: plan.quantity,
				status: "paper_filled",
				price: context.price,
				mode: this.mode,
			};
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
}
