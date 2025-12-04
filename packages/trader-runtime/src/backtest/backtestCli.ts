import { StrategyId } from "@agenai/core";
import { runtimeLogger } from "../runtimeShared";
import { runBacktest } from "./backtestRunner";
import { BacktestConfig } from "./backtestTypes";

const requireEnv = (name: string): string => {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable ${name}`);
	}
	return value;
};

const parseNumberEnv = (name: string): number | undefined => {
	const raw = process.env[name];
	if (!raw) {
		return undefined;
	}
	const parsed = Number(raw);
	if (Number.isNaN(parsed)) {
		throw new Error(`Environment variable ${name} must be a number`);
	}
	return parsed;
};

(async () => {
	try {
		const startTimestamp = Number(requireEnv("BACKTEST_START_TS"));
		const endTimestamp = Number(requireEnv("BACKTEST_END_TS"));
		if (Number.isNaN(startTimestamp) || Number.isNaN(endTimestamp)) {
			throw new Error(
				"BACKTEST_START_TS and BACKTEST_END_TS must be valid numbers"
			);
		}

		const config: BacktestConfig = {
			symbol: requireEnv("BACKTEST_SYMBOL"),
			timeframe: requireEnv("BACKTEST_TIMEFRAME"),
			strategyId: requireEnv("BACKTEST_STRATEGY_ID") as StrategyId,
			startTimestamp,
			endTimestamp,
			maxCandles: parseNumberEnv("BACKTEST_MAX_CANDLES"),
			initialBalance: parseNumberEnv("BACKTEST_INITIAL_BALANCE"),
			useTestnet: process.env.BACKTEST_USE_TESTNET === "true",
		};

		const result = await runBacktest(config);
		const closingTrades = result.trades.filter(
			(trade) => trade.action === "CLOSE"
		);
		const finalEquity =
			result.equitySnapshots[result.equitySnapshots.length - 1]?.equity ??
			config.initialBalance;
		const summary = {
			tradesExecuted: result.trades.length,
			positionsClosed: closingTrades.length,
			finalEquity,
		};

		runtimeLogger.info("backtest_cli_summary", summary);
		console.log("Backtest complete", summary);
		process.exit(0);
	} catch (error) {
		console.error("Backtest failed", error);
		process.exit(1);
	}
})();
