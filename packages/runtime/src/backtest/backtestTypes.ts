import { StrategyId } from "@agenai/core";
import { PaperAccountSnapshot } from "@agenai/execution-engine";

export interface BacktestConfig {
	symbol?: string;
	timeframe?: string;
	strategyId?: StrategyId;
	useTestnet?: boolean;
	startTimestamp: number;
	endTimestamp: number;
	maxCandles?: number;
	initialBalance?: number;
}

export interface BacktestResolvedConfig extends BacktestConfig {
	symbol: string;
	timeframe: string;
	strategyId: StrategyId;
}

export type BacktestTradeAction = "OPEN" | "CLOSE";
export type BacktestTradeSide = "LONG" | "SHORT";

export interface BacktestTrade {
	symbol: string;
	action: BacktestTradeAction;
	side: BacktestTradeSide;
	quantity: number;
	entryPrice: number;
	exitPrice?: number;
	realizedPnl?: number;
	timestamp: number;
}

export interface BacktestResult {
	config: BacktestResolvedConfig;
	trades: BacktestTrade[];
	equitySnapshots: PaperAccountSnapshot[];
}
