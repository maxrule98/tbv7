#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";
import {
	StrategyConfig,
	StrategyId,
	assertStrategyRuntimeParams,
	loadAgenaiConfig,
	loadStrategyConfig,
	resolveStrategyProfileName,
} from "@agenai/core";
import { BacktestConfig, runBacktest } from "@agenai/trader-runtime";

type ArgValue = string | boolean;

type BacktestResultPayload = Awaited<ReturnType<typeof runBacktest>>;

interface PersistContext {
	strategyId: StrategyId;
	symbol: string;
	timeframe: string;
	startTimestamp: number;
	endTimestamp: number;
	profiles: {
		accountProfile?: string;
		strategyProfile?: string;
		riskProfile?: string;
		exchangeProfile?: string;
	};
	strategyConfig: unknown;
}

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
	--withMetrics            Run metrics:process after saving the backtest file
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

const persistBacktestResult = (
	result: BacktestResultPayload,
	context: PersistContext
): string => {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const safeSymbol = context.symbol.replace(/[\\/]/g, "");
	const fileName = `${context.strategyId}-${safeSymbol}-${context.timeframe}-${timestamp}.json`;
	const outputDir = path.resolve(process.cwd(), "output", "backtests");
	fs.mkdirSync(outputDir, { recursive: true });
	const fingerprint = createHash("sha1")
		.update(
			JSON.stringify({
				strategyId: context.strategyId,
				symbol: context.symbol,
				timeframe: context.timeframe,
				profiles: context.profiles,
				strategyConfig: context.strategyConfig,
			})
		)
		.digest("hex")
		.slice(0, 12);
	const payload = {
		...result,
		metadata: {
			strategyId: context.strategyId,
			symbol: context.symbol,
			timeframe: context.timeframe,
			start: new Date(context.startTimestamp).toISOString(),
			end: new Date(context.endTimestamp).toISOString(),
			profiles: context.profiles,
			configFingerprint: fingerprint,
		},
	};
	const outputPath = path.join(outputDir, fileName);
	fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
	const relative = path.relative(process.cwd(), outputPath) || outputPath;
	console.log(`📤 Backtest saved to ${relative}`);
	return outputPath;
};

const runMetricsForFile = (filePath: string): void => {
	console.log("Running pnpm metrics:process ...");
	const execResult = spawnSync(
		"pnpm",
		["--workspace-root", "metrics:process", "--file", filePath],
		{
			stdio: "inherit",
		}
	);
	if (execResult.status !== 0) {
		console.error("metrics:process exited with a non-zero status");
	}
};

const main = async (): Promise<void> => {
	const argMap = parseCliArgs(process.argv.slice(2));
	const withMetrics =
		argMap.withMetrics === true || argMap.withMetrics === "true";
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
	const requestedStrategyId =
		(argMap.strategyId as string as StrategyId) ?? agenaiConfig.strategy.id;
	const strategyProfile = resolveStrategyProfileName(
		requestedStrategyId,
		profiles.strategyProfile
	);

	if (agenaiConfig.strategy.id !== requestedStrategyId) {
		agenaiConfig.strategy = loadStrategyConfig(undefined, strategyProfile);
	}
	const strategyConfig = agenaiConfig.strategy as StrategyConfig;
	const runtimeParams = assertStrategyRuntimeParams(strategyConfig);
	const symbol = (argMap.symbol as string) ?? runtimeParams.symbol;
	const timeframe =
		(argMap.timeframe as string) ?? runtimeParams.executionTimeframe;
	const maxCandles = parseNumber(argMap.maxCandles as string, "maxCandles");
	const initialBalance = parseNumber(
		argMap.initialBalance as string,
		"initialBalance"
	);

	const backtestConfig: BacktestConfig = {
		symbol,
		timeframe,
		strategyId: requestedStrategyId,
		startTimestamp,
		endTimestamp,
		maxCandles,
		initialBalance,
	};

	console.log(
		`Running backtest for ${symbol} ${timeframe} (${requestedStrategyId})...`
	);
	const result = await runBacktest(backtestConfig, {
		agenaiConfig,
		accountProfile: profiles.accountProfile,
		configDir,
		envPath,
		strategyProfile,
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
				strategyId: requestedStrategyId,
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

	const savedFile = persistBacktestResult(result, {
		strategyId: requestedStrategyId,
		symbol,
		timeframe,
		startTimestamp,
		endTimestamp,
		profiles,
		strategyConfig: agenaiConfig.strategy,
	});

	if (withMetrics) {
		runMetricsForFile(savedFile);
	}
};

main().catch((error) => {
	console.error("Backtest failed:", error.message ?? error);
	if (process.env.DEBUG) {
		console.error(error);
	}
	process.exitCode = 1;
});
