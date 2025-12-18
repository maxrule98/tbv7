import {
	ExecutionEngine,
	ExecutionResult,
	PaperAccount,
	PaperAccountSnapshot,
	PaperPositionSnapshot,
} from "@agenai/execution-engine";
import { TradePlan } from "@agenai/risk-engine";
import { AccountConfig, ExecutionMode } from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
import { StrategyRuntimeMode } from "../runtimeShared";

export interface ExecutionProvider {
	readonly venue: string;
	readonly mode: StrategyRuntimeMode;
	getPosition(symbol: string): PaperPositionSnapshot;
	execute(
		plan: TradePlan,
		context: { price: number }
	): Promise<ExecutionResult>;
	updatePosition(symbol: string, updates: Partial<PaperPositionSnapshot>): void;
	snapshotAccount(unrealizedPnl: number): PaperAccountSnapshot | null;
}

interface MexcExecutionProviderOptions {
	client: MexcClient;
	mode: ExecutionMode;
	accountConfig: AccountConfig;
}

export class MexcExecutionProvider implements ExecutionProvider {
	readonly venue = "mexc";
	readonly mode: StrategyRuntimeMode;
	private readonly engine: ExecutionEngine;
	private readonly paperAccount?: PaperAccount;

	constructor(options: MexcExecutionProviderOptions) {
		this.mode = options.mode === "live" ? "live" : "paper";
		this.paperAccount =
			options.mode === "paper"
				? new PaperAccount(options.accountConfig.startingBalance ?? 0)
				: undefined;
		this.engine = new ExecutionEngine({
			client: options.client,
			mode: options.mode,
			paperAccount: this.paperAccount,
		});
	}

	getPosition(symbol: string): PaperPositionSnapshot {
		return this.engine.getPosition(symbol);
	}

	updatePosition(
		symbol: string,
		updates: Partial<PaperPositionSnapshot>
	): void {
		this.engine.updatePosition(symbol, updates);
	}

	snapshotAccount(unrealizedPnl: number): PaperAccountSnapshot | null {
		return this.engine.snapshotPaperAccount(unrealizedPnl);
	}

	execute(
		plan: TradePlan,
		context: { price: number }
	): Promise<ExecutionResult> {
		return this.engine.execute(plan, context);
	}
}
