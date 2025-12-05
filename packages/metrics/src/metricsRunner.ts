#!/usr/bin/env ts-node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { BacktestResult } from "@agenai/trader-runtime";
import { calculatePerformance } from "./calcPerformance";
import { formatMetricsCsv } from "./formatCSV";

interface CliOptions {
	file?: string;
	riskFreeRate?: number;
	riskUnitUsd?: number;
	mode?: "summary" | "trades" | "grouped";
}

const BACKTEST_DIR = path.resolve(process.cwd(), "output", "backtests");
const METRICS_DIR = path.resolve(process.cwd(), "output", "metrics");

const parseArgs = (): CliOptions => {
	const options: CliOptions = {};
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i += 1) {
		const token = args[i];
		if (!token.startsWith("--")) {
			continue;
		}
		const key = token.slice(2);
		const next = args[i + 1];
		switch (key) {
			case "file":
				options.file = next;
				i += 1;
				break;
			case "riskFreeRate":
				options.riskFreeRate = next ? Number(next) : undefined;
				i += 1;
				break;
			case "riskUnitUsd":
				options.riskUnitUsd = next ? Number(next) : undefined;
				i += 1;
				break;
			case "mode":
				if (next === "summary" || next === "trades" || next === "grouped") {
					options.mode = next;
				}
				i += 1;
				break;
			default:
				break;
		}
	}
	return options;
};

const resolveLatestBacktest = async (): Promise<string | null> => {
	try {
		const files = await fs.readdir(BACKTEST_DIR);
		const jsonFiles = files
			.filter((file) => file.endsWith(".json"))
			.map((file) => ({
				file,
				stats: fs.stat(path.join(BACKTEST_DIR, file)),
			}));
		const stats = await Promise.all(jsonFiles.map((entry) => entry.stats));
		const latestIndex = stats.reduce(
			(best, stat, index) => {
				if (!stat.isFile()) {
					return best;
				}
				if (best.mtimeMs < stat.mtimeMs) {
					return { index, mtimeMs: stat.mtimeMs };
				}
				return best;
			},
			{ index: -1, mtimeMs: -1 }
		);
		if (latestIndex.index === -1) {
			return null;
		}
		return path.join(BACKTEST_DIR, jsonFiles[latestIndex.index]!.file);
	} catch {
		return null;
	}
};

const ensureDir = async (dir: string): Promise<void> => {
	await fs.mkdir(dir, { recursive: true });
};

const run = async (): Promise<void> => {
	const options = parseArgs();
	const filePath = options.file ?? (await resolveLatestBacktest());
	if (!filePath) {
		console.error(
			"No backtest result found. Provide --file <path> or run a backtest first."
		);
		process.exitCode = 1;
		return;
	}

	const payload = await fs.readFile(filePath, "utf8");
	const backtestResult = JSON.parse(payload) as BacktestResult;
	const report = calculatePerformance(backtestResult, {
		riskFreeRate: options.riskFreeRate,
		riskUnitUsd: options.riskUnitUsd,
	});

	await ensureDir(METRICS_DIR);
	const baseName = path.basename(filePath, path.extname(filePath));
	const summaryPath = path.join(METRICS_DIR, `${baseName}.summary.json`);
	const csvPath = path.join(METRICS_DIR, `${baseName}.trades.csv`);
	const groupedPath = path.join(METRICS_DIR, `${baseName}.playtypes.csv`);

	await fs.writeFile(
		summaryPath,
		JSON.stringify(report.summary, null, 2),
		"utf8"
	);
	await fs.writeFile(
		csvPath,
		formatMetricsCsv(report, { mode: options.mode ?? "trades" }),
		"utf8"
	);
	await fs.writeFile(
		groupedPath,
		formatMetricsCsv(report, { mode: "grouped", groupBy: "playType" }),
		"utf8"
	);

	console.log(`Metrics summary saved to ${summaryPath}`);
	console.log(`Trade diagnostics CSV saved to ${csvPath}`);
	console.log(`Play-type CSV saved to ${groupedPath}`);
};

run().catch((error) => {
	console.error("metrics_runner_failed", error);
	process.exitCode = 1;
});
