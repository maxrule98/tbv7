#!/usr/bin/env node

import process from "node:process";
import { StrategyId, loadAgenaiConfig } from "@agenai/core";
import { BacktestConfig, runBacktest } from "@agenai/trader-runtime";

type ArgValue = string | boolean;

const USAGE = `Usage:
  pnpm --filter @agenai/backtester-cli run dev -- --start <iso> --end <iso> [options]

Options (all optional unless noted):
  --start <iso>            ISO timestamp for first candle (required)
  --end <iso>              ISO timestamp for last candle (required)
  --symbol <symbol>        Trading pair (defaults to config default)
  --timeframe <tf>         Candle timeframe (defaults to config default)
  --strategyId <id>        Strategy id (defaults to loaded config)
  --maxCandles <number>    Limit candles for execution timeframe
  --initialBalance <usd>   Override starting balance
  --envPath <path>         Custom .env path
  --configDir <path>       Custom config directory
  --accountProfile <id>    Account profile name
  --strategyProfile <id>   Strategy profile name
  --riskProfile <id>       Risk profile name
  --exchangeProfile <id>   Exchange profile name
  --json                   Print full JSON result payload
  --help                   Show this message
`;

const parseCliArgs = (argv: string[]): Record<string, ArgValue> => {
	const args: Record<string, ArgValue> = {};
	const positionals: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}
		const eqIdx = token.indexOf("=");
		if (eqIdx !== -1) {
			const key = token.slice(2, eqIdx);
			const value = token.slice(eqIdx + 1);
			args[key] = value;
			continue;
		}
		const key = token.slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith("--")) {
			args[key] = next;
			i += 1;
		} else {
			args[key] = true;
		}
	}
	if (positionals[0] && args.start === undefined) {
		args.start = positionals[0];
	}
	if (positionals[1] && args.end === undefined) {
		args.end = positionals[1];
	}
	return args;
};

const parseTimestamp = (value: string | undefined, label: string): number => {
	if (!value) {
		throw new Error(`Missing required --${label} <iso>`);
	}
	const ts = Date.parse(value);
	if (Number.isNaN(ts)) {
		throw new Error(`Invalid ${label} timestamp: ${value}`);
	}
	return ts;
};

const parseNumber = (
	value: string | undefined,
	label: string
): number | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const num = Number(value);
	if (!Number.isFinite(num)) {
		throw new Error(`Invalid numeric value for --${label}: ${value}`);
	}
	return num;
};

const formatUsd = (value: number | undefined): string => {
	return typeof value === "number" ? `$${value.toFixed(2)}` : "n/a";
};

const main = async (): Promise<void> => {
	const argMap = parseCliArgs(process.argv.slice(2));
	if (argMap.help) {
		console.log(USAGE);
		return;
	}

	const startTimestamp = parseTimestamp(argMap.start as string, "start");
	const endTimestamp = parseTimestamp(argMap.end as string, "end");
	if (startTimestamp >= endTimestamp) {
		throw new Error("--start must be before --end");
	}

	const envPath = (argMap.envPath as string) ?? (argMap.env as string);
	const configDir = argMap.configDir as string | undefined;
	const profiles = {
		accountProfile: argMap.accountProfile as string | undefined,
		strategyProfile: argMap.strategyProfile as string | undefined,
		riskProfile: argMap.riskProfile as string | undefined,
		exchangeProfile: argMap.exchangeProfile as string | undefined,
	};

	const agenaiConfig = loadAgenaiConfig({
		envPath,
		configDir,
		strategyProfile: profiles.strategyProfile,
		riskProfile: profiles.riskProfile,
		exchangeProfile: profiles.exchangeProfile,
	});
	const symbol =
		(argMap.symbol as string) ?? agenaiConfig.exchange.defaultSymbol;
	const timeframe =
		(argMap.timeframe as string) ?? agenaiConfig.env.defaultTimeframe;
	const strategyId =
		(argMap.strategyId as string as StrategyId) ?? agenaiConfig.strategy.id;
	const maxCandles = parseNumber(argMap.maxCandles as string, "maxCandles");
	const initialBalance = parseNumber(
		argMap.initialBalance as string,
		"initialBalance"
	);

	const backtestConfig: BacktestConfig = {
		symbol,
		timeframe,
		strategyId,
		startTimestamp,
		endTimestamp,
		maxCandles,
		initialBalance,
	};

	console.log(`Running backtest for ${symbol} ${timeframe} (${strategyId})...`);
	const result = await runBacktest(backtestConfig, {
		agenaiConfig,
		accountProfile: profiles.accountProfile,
		configDir,
		envPath,
		strategyProfile: profiles.strategyProfile,
		riskProfile: profiles.riskProfile,
		exchangeProfile: profiles.exchangeProfile,
	});

	const trades = result.trades.length;
	const firstSnapshot = result.equitySnapshots[0];
	const lastSnapshot =
		result.equitySnapshots[result.equitySnapshots.length - 1];
	const startingBalance =
		firstSnapshot?.startingBalance ?? backtestConfig.initialBalance;
	const finalEquity = lastSnapshot?.equity ?? startingBalance;
	const totalPnl =
		typeof startingBalance === "number" && typeof finalEquity === "number"
			? finalEquity - startingBalance
			: undefined;

	console.log("Backtest complete:");
	console.log(
		JSON.stringify(
			{
				symbol,
				timeframe,
				strategyId,
				start: new Date(startTimestamp).toISOString(),
				end: new Date(endTimestamp).toISOString(),
				trades,
				finalEquity,
				totalPnl,
			},
			null,
			2
		)
	);

	if (argMap.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log("---- Summary ----");
		console.log(`Trades executed: ${trades}`);
		console.log(`Starting balance: ${formatUsd(startingBalance)}`);
		console.log(`Final equity: ${formatUsd(finalEquity)}`);
		console.log(`Total PnL: ${formatUsd(totalPnl)}`);
	}
};

main().catch((error) => {
	console.error("Backtest failed:", error.message ?? error);
	if (process.env.DEBUG) {
		console.error(error);
	}
	process.exitCode = 1;
});
