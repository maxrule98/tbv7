import { PerformanceReport, TradeDiagnostic } from "./metricsSchema";

export type CsvMode = "summary" | "trades" | "grouped";
export type CsvGroupKey = "playType" | "day" | "hour";

export interface FormatCsvOptions {
	mode?: CsvMode;
	groupBy?: CsvGroupKey;
	includeHeader?: boolean;
}

export const formatMetricsCsv = (
	report: PerformanceReport,
	options: FormatCsvOptions = {}
): string => {
	const mode = options.mode ?? "trades";
	switch (mode) {
		case "summary":
			return toCsv([buildSummaryRow(report)], options.includeHeader ?? true);
		case "grouped":
			return toCsv(
				buildGroupedRows(report, options.groupBy ?? "playType"),
				options.includeHeader ?? true
			);
		case "trades":
		default:
			return toCsv(
				buildTradeRows(report.trades, report),
				options.includeHeader ?? true
			);
	}
};

const buildSummaryRow = (
	report: PerformanceReport
): Record<string, unknown> => {
	const { summary } = report;
	return {
		strategyId: summary.metadata.strategyId,
		symbol: summary.metadata.symbol,
		timeframe: summary.metadata.timeframe,
		start: new Date(summary.metadata.startTimestamp).toISOString(),
		end: new Date(summary.metadata.endTimestamp).toISOString(),
		configFingerprint: summary.metadata.configFingerprint,
		tradeCount: summary.metadata.tradeCount,
		netProfit: summary.netProfit,
		grossProfit: summary.grossProfit,
		grossLoss: summary.grossLoss,
		winRate: summary.winRate,
		lossRate: summary.lossRate,
		payoffRatio: summary.payoffRatio,
		expectancy: summary.expectancy,
		avgRMultiple: summary.avgRMultiple,
		sharpeEquity: summary.sharpe.equity,
		sortinoEquity: summary.sortino.equity,
		cagr: summary.cagr,
		calmarRatio: summary.calmarRatio,
		maxDrawdown: summary.maxDrawdown,
		maxDrawdownPct: summary.maxDrawdownPct,
		timeInMarketPct: summary.timeInMarketPct,
	};
};

const buildTradeRows = (
	trades: TradeDiagnostic[],
	report: PerformanceReport
): Record<string, unknown>[] => {
	return trades.map((trade) => ({
		strategyId: report.summary.metadata.strategyId,
		configFingerprint: report.summary.metadata.configFingerprint,
		symbol: trade.symbol,
		side: trade.side,
		playType: trade.playType,
		entry: new Date(trade.entryTimestamp).toISOString(),
		exit: new Date(trade.exitTimestamp).toISOString(),
		durationMs: trade.durationMs,
		quantity: trade.quantity,
		entryPrice: trade.entryPrice,
		exitPrice: trade.exitPrice,
		pnl: trade.pnl,
		returnPct: trade.returnPct,
		rMultiple: trade.rMultiple,
		isWin: trade.isWin,
		isLoss: trade.isLoss,
		isBreakEven: trade.isBreakEven,
		dayBucket: trade.dayBucket,
		hourBucket: trade.hourBucket,
		session: trade.sessionLabel,
	}));
};

const buildGroupedRows = (
	report: PerformanceReport,
	groupBy: CsvGroupKey
): Record<string, unknown>[] => {
	const grouped = new Map<string, { trades: TradeDiagnostic[] }>();
	for (const trade of report.trades) {
		const key =
			groupBy === "day"
				? trade.dayBucket
				: groupBy === "hour"
					? trade.hourBucket
					: trade.playType;
		const bucket = grouped.get(key) ?? { trades: [] };
		bucket.trades.push(trade);
		grouped.set(key, bucket);
	}

	return Array.from(grouped.entries()).map(([key, value]) => {
		const wins = value.trades.filter((trade) => trade.isWin).length;
		const losses = value.trades.filter((trade) => trade.isLoss).length;
		const pnl = value.trades.reduce((sum, trade) => sum + trade.pnl, 0);
		const avgDuration = value.trades.length
			? value.trades.reduce((sum, trade) => sum + trade.durationMs, 0) /
				value.trades.length
			: 0;
		return {
			strategyId: report.summary.metadata.strategyId,
			configFingerprint: report.summary.metadata.configFingerprint,
			group: key,
			groupMode: groupBy,
			tradeCount: value.trades.length,
			winRate: value.trades.length ? wins / value.trades.length : 0,
			lossRate: value.trades.length ? losses / value.trades.length : 0,
			netProfit: pnl,
			avgDurationMs: avgDuration,
		};
	});
};

const toCsv = (
	rows: Record<string, unknown>[],
	includeHeader: boolean
): string => {
	if (!rows.length) {
		return "";
	}
	const headers = Object.keys(rows[0]);
	const lines: string[] = [];
	if (includeHeader) {
		lines.push(headers.join(","));
	}
	for (const row of rows) {
		lines.push(headers.map((header) => formatValue(row[header])).join(","));
	}
	return lines.join("\n");
};

const formatValue = (value: unknown): string => {
	if (value === null || value === undefined) {
		return "";
	}
	if (typeof value === "string") {
		if (value.includes(",")) {
			return `"${value}"`;
		}
		return value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value.toString() : "";
	}
	return String(value);
};
