import { createHash } from "node:crypto";
import type { BacktestResult, BacktestTrade } from "@agenai/runtime";
import { buildDiagnosticsReport } from "./diagnostics";
import {
	DrawdownSpan,
	EquityCurveStats,
	MetricsSummary,
	PerformanceReport,
	TradeDiagnostic,
} from "./metricsSchema";

const MS_IN_DAY = 86_400_000;
const MS_IN_YEAR = 365 * MS_IN_DAY;

export interface CalcPerformanceOptions {
	riskFreeRate?: number;
	defaultRiskPct?: number;
	riskUnitUsd?: number;
}

interface EquityPoint {
	timestamp: number;
	equity: number;
}

interface BacktestResultMetadata {
	strategyConfigFingerprint?: string;
	runtimeContextFingerprint?: string;
}

type BacktestResultWithMetadata = BacktestResult & {
	metadata?: BacktestResultMetadata;
};

export const calculatePerformance = (
	result: BacktestResultWithMetadata,
	options: CalcPerformanceOptions = {}
): PerformanceReport => {
	const { config, trades } = result;
	const totalDurationMs = Math.max(
		config.endTimestamp - config.startTimestamp,
		1
	);
	const years = totalDurationMs / MS_IN_YEAR;

	const startingSnapshot = result.equitySnapshots[0];
	const initialBalance =
		startingSnapshot?.equity ?? config.initialBalance ?? 1000;
	const riskUnitUsd = Math.max(
		options.riskUnitUsd ?? initialBalance * (options.defaultRiskPct ?? 0.01),
		1
	);

	const diagnostics = buildTradeDiagnostics(trades, riskUnitUsd);
	const netProfit = diagnostics.reduce((sum, trade) => sum + trade.pnl, 0);
	const finalEquitySnapshot = result.equitySnapshots.at(-1)?.equity;
	const finalEquity = finalEquitySnapshot ?? initialBalance + netProfit;
	const grossProfit = diagnostics
		.filter((trade) => trade.pnl > 0)
		.reduce((sum, trade) => sum + trade.pnl, 0);
	const grossLossMagnitude = diagnostics
		.filter((trade) => trade.pnl < 0)
		.reduce((sum, trade) => sum + Math.abs(trade.pnl), 0);
	const grossLoss = grossLossMagnitude;

	const tradeCount = diagnostics.length;
	const wins = diagnostics.filter((trade) => trade.isWin).length;
	const losses = diagnostics.filter((trade) => trade.isLoss).length;
	const avgWin = wins ? grossProfit / wins : 0;
	const avgLoss = losses ? -(grossLossMagnitude / losses) : 0;
	const winRate = tradeCount ? wins / tradeCount : 0;
	const lossRate = tradeCount ? losses / tradeCount : 0;
	const payoffRatio = Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : 0;
	const expectancy = winRate * avgWin + lossRate * avgLoss;
	const timeInMarketMs = diagnostics.reduce(
		(sum, trade) => sum + trade.durationMs,
		0
	);
	const avgTradeDurationMs = tradeCount ? timeInMarketMs / tradeCount : 0;
	const timeInMarketPct = Math.min(
		100,
		(timeInMarketMs / totalDurationMs) * 100
	);
	const days = totalDurationMs / MS_IN_DAY;
	const tradesPerDay = days > 0 ? tradeCount / days : tradeCount;
	const tradesPerYear = years > 0 ? tradeCount / years : tradeCount;
	const avgRMultiple = tradeCount
		? diagnostics.reduce((sum, trade) => sum + trade.rMultiple, 0) / tradeCount
		: 0;

	const equitySeries = buildEquitySeries(
		diagnostics,
		config.startTimestamp,
		config.endTimestamp,
		initialBalance
	);
	const { equityReturns, drawdowns, maxDrawdown, maxDrawdownPct, equityStats } =
		analyzeEquitySeries(equitySeries);

	const percentReturns = diagnostics.map((trade) => trade.returnPct);
	const rMultipleReturns = diagnostics.map((trade) => trade.rMultiple);

	const riskFreeRate = options.riskFreeRate ?? 0.02;
	const sharpeEquity = computeSharpe(
		equityReturns,
		riskFreeRate,
		periodsPerYear(equityReturns.length, years)
	);
	const sharpePercent = computeSharpe(
		percentReturns,
		riskFreeRate,
		tradesPerYear
	);
	const sharpeR = computeSharpe(rMultipleReturns, riskFreeRate, tradesPerYear);

	const sortinoEquity = computeSortino(
		equityReturns,
		riskFreeRate,
		periodsPerYear(equityReturns.length, years)
	);
	const sortinoPercent = computeSortino(
		percentReturns,
		riskFreeRate,
		tradesPerYear
	);
	const sortinoR = computeSortino(
		rMultipleReturns,
		riskFreeRate,
		tradesPerYear
	);

	const cagr =
		years > 0 && initialBalance > 0
			? Math.pow(finalEquity / initialBalance, 1 / years) - 1
			: 0;
	const rAdjustedCagr =
		tradesPerYear > 0
			? Math.pow(Math.max(0, 1 + avgRMultiple), tradesPerYear) - 1
			: 0;
	const calmarRatio = maxDrawdownPct > 0 ? cagr / maxDrawdownPct : 0;

	const fallbackFingerprint = createHash("sha1")
		.update(
			JSON.stringify({
				strategyId: config.strategyId,
				timeframe: config.timeframe,
				totalTrades: tradeCount,
				netProfit,
			})
		)
		.digest("hex")
		.slice(0, 12);

	const strategyConfigFingerprint =
		result.metadata?.strategyConfigFingerprint ?? fallbackFingerprint;

	const summary: MetricsSummary = {
		netProfit,
		grossProfit,
		grossLoss,
		profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
		maxDrawdown,
		maxDrawdownPct,
		winRate,
		lossRate,
		payoffRatio,
		expectancy,
		avgRMultiple,
		avgTradeDurationMs,
		timeInMarketMs,
		timeInMarketPct,
		tradesPerDay,
		sharpe: {
			equity: sharpeEquity,
			percent: sharpePercent,
			rMultiple: sharpeR,
		},
		sortino: {
			equity: sortinoEquity,
			percent: sortinoPercent,
			rMultiple: sortinoR,
		},
		cagr,
		rAdjustedCagr,
		calmarRatio,
		equityCurve: equityStats,
		drawdowns,
		metadata: {
			strategyId: config.strategyId,
			symbol: config.symbol,
			timeframe: config.timeframe,
			startTimestamp: config.startTimestamp,
			endTimestamp: config.endTimestamp,
			runDurationMs: totalDurationMs,
			initialBalance,
			finalBalance: finalEquity,
			tradeCount,
			strategyConfigFingerprint,
		},
	};

	return {
		summary,
		trades: diagnostics,
		diagnostics: buildDiagnosticsReport(diagnostics),
	};
};

const buildTradeDiagnostics = (
	trades: BacktestTrade[],
	riskUnitUsd: number
): TradeDiagnostic[] => {
	const diagnostics: TradeDiagnostic[] = [];
	const openBySide = new Map<string, BacktestTrade>();

	const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

	for (const trade of sorted) {
		if (trade.action === "OPEN") {
			openBySide.set(trade.side, trade);
			continue;
		}

		if (trade.action !== "CLOSE") {
			continue;
		}

		const entry = openBySide.get(trade.side);
		if (!entry) {
			continue;
		}

		const durationMs = Math.max(trade.timestamp - entry.timestamp, 0);
		const pnl = trade.realizedPnl ?? 0;
		const notional = entry.entryPrice * entry.quantity;
		const returnPct = notional !== 0 ? pnl / notional : 0;
		const rMultiple = riskUnitUsd > 0 ? pnl / riskUnitUsd : 0;

		diagnostics.push({
			index: diagnostics.length,
			symbol: trade.symbol,
			side: trade.side,
			entryTimestamp: entry.timestamp,
			exitTimestamp: trade.timestamp,
			durationMs,
			quantity: entry.quantity,
			entryPrice: entry.entryPrice,
			exitPrice: trade.exitPrice ?? entry.entryPrice,
			pnl,
			returnPct,
			rMultiple,
			isWin: pnl > 0,
			isLoss: pnl < 0,
			isBreakEven: pnl === 0,
			playType: `${trade.side}_${trade.symbol}`,
			dayBucket: formatDay(entry.timestamp),
			hourBucket: formatHour(entry.timestamp),
			sessionLabel: formatSession(entry.timestamp),
		});

		openBySide.delete(trade.side);
	}

	return diagnostics;
};

const formatDay = (timestamp: number): string => {
	return new Date(timestamp).toISOString().slice(0, 10);
};

const formatHour = (timestamp: number): string => {
	return new Date(timestamp).toISOString().slice(11, 13);
};

const formatSession = (timestamp: number): string => {
	const hour = Number(formatHour(timestamp));
	if (hour < 8) {
		return "asia";
	}
	if (hour < 16) {
		return "eu";
	}
	return "us";
};

const buildEquitySeries = (
	trades: TradeDiagnostic[],
	startTimestamp: number,
	endTimestamp: number,
	initialBalance: number
): EquityPoint[] => {
	const series: EquityPoint[] = [
		{ timestamp: startTimestamp, equity: initialBalance },
	];
	let running = initialBalance;

	for (const trade of trades.sort(
		(a, b) => a.exitTimestamp - b.exitTimestamp
	)) {
		running += trade.pnl;
		series.push({ timestamp: trade.exitTimestamp, equity: running });
	}

	if (series[series.length - 1]?.timestamp !== endTimestamp) {
		series.push({ timestamp: endTimestamp, equity: running });
	}

	return series;
};

const analyzeEquitySeries = (series: EquityPoint[]) => {
	if (!series.length) {
		return {
			equityReturns: [],
			drawdowns: [],
			maxDrawdown: 0,
			maxDrawdownPct: 0,
			equityStats: {
				newHighCount: 0,
				averageRecoveryMs: 0,
				longestRecoveryMs: 0,
				volatility: 0,
				meanReturn: 0,
				returnSampleCount: 0,
				maxEquity: 0,
				minEquity: 0,
				finalEquity: 0,
			},
		};
	}

	const returns: number[] = [];
	const drawdowns: DrawdownSpan[] = [];
	let peakEquity = series[0].equity;
	let peakTimestamp = series[0].timestamp;
	let maxDrawdown = 0;
	let maxDrawdownPct = 0;
	let newHighCount = 1;
	let activeSpan: {
		peakTimestamp: number;
		peakEquity: number;
		troughTimestamp: number;
		troughEquity: number;
	} | null = null;

	for (let i = 1; i < series.length; i += 1) {
		const prev = series[i - 1];
		const point = series[i];
		const denominator = Math.max(prev.equity, 1);
		returns.push((point.equity - prev.equity) / denominator);

		if (point.equity > peakEquity) {
			if (activeSpan) {
				finalizeDrawdown(drawdowns, activeSpan, point.timestamp);
				activeSpan = null;
			}
			peakEquity = point.equity;
			peakTimestamp = point.timestamp;
			newHighCount += 1;
			continue;
		}

		if (!activeSpan) {
			activeSpan = {
				peakTimestamp,
				peakEquity,
				troughTimestamp: point.timestamp,
				troughEquity: point.equity,
			};
		} else if (point.equity < activeSpan.troughEquity) {
			activeSpan.troughEquity = point.equity;
			activeSpan.troughTimestamp = point.timestamp;
		}

		const depth = peakEquity - point.equity;
		const depthPct = peakEquity > 0 ? depth / peakEquity : 0;
		if (depth > maxDrawdown) {
			maxDrawdown = depth;
			maxDrawdownPct = depthPct;
		}
	}

	if (activeSpan) {
		finalizeDrawdown(drawdowns, activeSpan, null);
	}

	const recoveryDurations = drawdowns
		.map((span) => span.recoveryMs)
		.filter((value): value is number => typeof value === "number");
	const averageRecoveryMs = recoveryDurations.length
		? recoveryDurations.reduce((sum, value) => sum + value, 0) /
			recoveryDurations.length
		: 0;
	const longestRecoveryMs = recoveryDurations.length
		? Math.max(...recoveryDurations)
		: 0;

	const equities = series.map((point) => point.equity);
	const equityStats: EquityCurveStats = {
		newHighCount,
		averageRecoveryMs,
		longestRecoveryMs,
		volatility: standardDeviation(returns),
		meanReturn: returns.length
			? returns.reduce((sum, value) => sum + value, 0) / returns.length
			: 0,
		returnSampleCount: returns.length,
		maxEquity: Math.max(...equities),
		minEquity: Math.min(...equities),
		finalEquity: equities.at(-1) ?? 0,
	};

	return {
		equityReturns: returns,
		drawdowns,
		maxDrawdown,
		maxDrawdownPct,
		equityStats,
	};
};

const finalizeDrawdown = (
	drawdowns: DrawdownSpan[],
	span: {
		peakTimestamp: number;
		peakEquity: number;
		troughTimestamp: number;
		troughEquity: number;
	},
	recoveryTimestamp: number | null
): void => {
	const depth = span.peakEquity - span.troughEquity;
	const depthPct = span.peakEquity > 0 ? depth / span.peakEquity : 0;
	drawdowns.push({
		peakTimestamp: span.peakTimestamp,
		troughTimestamp: span.troughTimestamp,
		recoveryTimestamp,
		depth,
		depthPct,
		durationMs: span.troughTimestamp - span.peakTimestamp,
		recoveryMs:
			recoveryTimestamp !== null
				? recoveryTimestamp - span.peakTimestamp
				: null,
	});
};

const periodsPerYear = (samples: number, years: number): number => {
	if (!samples) {
		return 0;
	}
	return years > 0 ? samples / years : samples;
};

const computeSharpe = (
	returns: number[],
	riskFreeRate: number,
	periodsPerYearEstimate: number
): number => {
	if (returns.length < 2 || periodsPerYearEstimate <= 0) {
		return 0;
	}
	const rfPerPeriod =
		Math.pow(1 + riskFreeRate, 1 / periodsPerYearEstimate) - 1;
	const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
	const excess = mean - rfPerPeriod;
	const std = standardDeviation(returns);
	return std === 0 ? 0 : (excess / std) * Math.sqrt(periodsPerYearEstimate);
};

const computeSortino = (
	returns: number[],
	riskFreeRate: number,
	periodsPerYearEstimate: number
): number => {
	if (returns.length < 2 || periodsPerYearEstimate <= 0) {
		return 0;
	}
	const rfPerPeriod =
		Math.pow(1 + riskFreeRate, 1 / periodsPerYearEstimate) - 1;
	const downside = returns.filter((value) => value < rfPerPeriod);
	if (!downside.length) {
		return 0;
	}
	const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
	const excess = mean - rfPerPeriod;
	const downsideDeviation = Math.sqrt(
		downside.reduce((sum, value) => sum + (value - rfPerPeriod) ** 2, 0) /
			downside.length
	);
	return downsideDeviation === 0
		? 0
		: (excess / downsideDeviation) * Math.sqrt(periodsPerYearEstimate);
};

const standardDeviation = (values: number[]): number => {
	if (values.length < 2) {
		return 0;
	}
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const variance =
		values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
};
