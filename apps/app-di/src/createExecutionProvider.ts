import { ExecutionClient } from "@agenai/core";
import {
	ExecutionProvider,
	MexcExecutionProvider,
	RuntimeSnapshot,
} from "@agenai/runtime";
import { PaperAccount, ExecutionEngine } from "@agenai/execution-engine";
import { RiskManager } from "@agenai/risk-engine";

export const createExecutionProvider = (
	runtimeSnapshot: RuntimeSnapshot,
	executionClient: ExecutionClient
): MexcExecutionProvider => {
	const executionMode = runtimeSnapshot.config.agenaiConfig.env.executionMode;
	const accountConfig = runtimeSnapshot.config.accountConfig;
	return new MexcExecutionProvider({
		client: executionClient,
		mode: executionMode,
		accountConfig,
	});
};

// Backtest uses backtestRunner's internal ExecutionProvider; this helper builds
// a paper ExecutionEngine mirroring live wiring for consistency in tests.
export const createBacktestExecution = (
	runtimeSnapshot: RuntimeSnapshot,
	executionClient: ExecutionClient
): ExecutionProvider => {
	const accountConfig = runtimeSnapshot.config.accountConfig;
	const risk = runtimeSnapshot.config.agenaiConfig.risk;
	const riskManager = new RiskManager(risk);
	void riskManager;
	const paperAccount = new PaperAccount(accountConfig.startingBalance ?? 0);
	const engine = new ExecutionEngine({
		client: executionClient,
		mode: "paper",
		paperAccount,
	});
	return {
		venue: "backtest-di",
		mode: "backtest",
		getPosition: (symbol) => engine.getPosition(symbol),
		updatePosition: (symbol, updates) => engine.updatePosition(symbol, updates),
		snapshotAccount: (unrealized) => engine.snapshotPaperAccount(unrealized),
		execute: (plan, context) => engine.execute(plan, context),
	};
};
