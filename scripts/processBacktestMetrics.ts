import fs from "node:fs";
import path from "node:path";

interface CliOptions {
	file?: string;
}

interface MetricsSummary {
	file: string;
	trades: number;
	wins: number;
	losses: number;
	flat: number;
	totalPnl: number;
	startingBalance: number | null;
	finalEquity: number | null;
}

const OUTPUT_DIR = path.join(process.cwd(), "output", "backtests");

const parseArgs = (): CliOptions => {
	const args = process.argv.slice(2);
	const options: CliOptions = {};
	for (let i = 0; i < args.length; i += 1) {
		const token = args[i];
		if (token === "--file") {
			const next = args[i + 1];
			if (!next) {
				throw new Error("--file requires a path argument");
			}
			options.file = next;
			i += 1;
		} else if (token.startsWith("--file=")) {
			options.file = token.slice("--file=".length);
		} else {
			// Ignore unknown flags so the CLI stays flexible.
		}
	}
	return options;
};

const resolveTargetFile = (explicitPath?: string): string | null => {
	if (explicitPath) {
		const absolute = path.resolve(explicitPath);
		return fs.existsSync(absolute) ? absolute : null;
	}
	if (!fs.existsSync(OUTPUT_DIR)) {
		return null;
	}
	const candidates = fs
		.readdirSync(OUTPUT_DIR)
		.filter((file) => file.endsWith(".json"))
		.map((file) => {
			const fullPath = path.join(OUTPUT_DIR, file);
			const stats = fs.statSync(fullPath);
			return { file: fullPath, mtime: stats.mtimeMs };
		})
		.sort((a, b) => b.mtime - a.mtime);
	return candidates[0]?.file ?? null;
};

const summarizeResult = (result: any, filePath: string): MetricsSummary => {
	const trades = Array.isArray(result?.trades) ? result.trades : [];
	const equitySnapshots = Array.isArray(result?.equitySnapshots)
		? result.equitySnapshots
		: [];
	const wins = trades.filter(
		(trade: any) => (trade?.realizedPnl ?? 0) > 0
	).length;
	const losses = trades.filter(
		(trade: any) => (trade?.realizedPnl ?? 0) < 0
	).length;
	const totalPnl = trades.reduce(
		(acc: number, trade: Record<string, unknown>) =>
			acc + Number(trade?.realizedPnl ?? 0),
		0
	);
	const flat = trades.length - wins - losses;
	const startingBalance = extractStartingBalance(result, equitySnapshots);
	const finalEquity = extractFinalEquity(
		result,
		equitySnapshots,
		startingBalance,
		totalPnl
	);
	return {
		file: path.relative(process.cwd(), filePath),
		trades: trades.length,
		wins,
		losses,
		flat,
		totalPnl,
		startingBalance,
		finalEquity,
	};
};

const extractStartingBalance = (
	result: any,
	equitySnapshots: any[]
): number | null => {
	const firstSnapshot = equitySnapshots[0];
	if (firstSnapshot && typeof firstSnapshot.startingBalance === "number") {
		return firstSnapshot.startingBalance;
	}
	if (typeof result?.config?.initialBalance === "number") {
		return result.config.initialBalance;
	}
	return null;
};

const extractFinalEquity = (
	result: any,
	equitySnapshots: any[],
	startingBalance: number | null,
	totalPnl: number
): number | null => {
	const lastSnapshot = equitySnapshots[equitySnapshots.length - 1];
	if (lastSnapshot && typeof lastSnapshot.equity === "number") {
		return lastSnapshot.equity;
	}
	if (typeof result?.finalEquity === "number") {
		return result.finalEquity;
	}
	if (typeof startingBalance === "number") {
		return startingBalance + totalPnl;
	}
	return null;
};

const main = (): void => {
	const options = parseArgs();
	const targetFile = resolveTargetFile(options.file);
	if (!targetFile) {
		console.error(
			"No backtest metrics found. Provide --file <path> or generate output/backtests/*.json via the backtest CLI."
		);
		process.exitCode = 1;
		return;
	}

	let payload: any;
	try {
		const contents = fs.readFileSync(targetFile, "utf-8");
		payload = JSON.parse(contents);
	} catch (error) {
		console.error(`Failed to read metrics file: ${targetFile}`);
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
		return;
	}

	const summary = summarizeResult(payload, targetFile);
	console.log("Backtest metrics summary:\n");
	console.log(JSON.stringify(summary, null, 2));
	console.log(
		"\nTip: override the source file with --file <path> or pipe JSON to create processed snapshots."
	);
};

main();
