import type { StrategyId } from "@agenai/core";

export interface DrawdownSpan {
	peakTimestamp: number | null;
	troughTimestamp: number | null;
	recoveryTimestamp: number | null;
	depth: number;
	depthPct: number;
	durationMs: number | null;
	recoveryMs: number | null;
}

export interface EquityCurveStats {
	newHighCount: number;
	averageRecoveryMs: number;
	longestRecoveryMs: number;
	volatility: number;
	meanReturn: number;
	returnSampleCount: number;
	maxEquity: number;
	minEquity: number;
	finalEquity: number;
}

export interface TradeDiagnostic {
	index: number;
	symbol: string;
	side: "LONG" | "SHORT";
	entryTimestamp: number;
	exitTimestamp: number;
	durationMs: number;
	quantity: number;
	entryPrice: number;
	exitPrice: number;
	pnl: number;
	returnPct: number;
	rMultiple: number;
	isWin: boolean;
	isLoss: boolean;
	isBreakEven: boolean;
	playType: string;
	dayBucket: string;
	hourBucket: string;
	sessionLabel: string;
}

export interface SharpeBreakdown {
	equity: number;
	percent: number;
	rMultiple: number;
}

export interface SortinoBreakdown extends SharpeBreakdown {}

export interface PerformanceMetadata {
	strategyId: StrategyId;
	symbol: string;
	timeframe: string;
	startTimestamp: number;
	endTimestamp: number;
	runDurationMs: number;
	initialBalance: number;
	finalBalance: number;
	tradeCount: number;
	configFingerprint: string;
}

export interface MetricsSummary {
	netProfit: number;
	grossProfit: number;
	grossLoss: number;
	profitFactor: number;
	maxDrawdown: number;
	maxDrawdownPct: number;
	winRate: number;
	lossRate: number;
	payoffRatio: number;
	expectancy: number;
	avgRMultiple: number;
	avgTradeDurationMs: number;
	timeInMarketMs: number;
	timeInMarketPct: number;
	tradesPerDay: number;
	sharpe: SharpeBreakdown;
	sortino: SortinoBreakdown;
	cagr: number;
	rAdjustedCagr: number;
	calmarRatio: number;
	equityCurve: EquityCurveStats;
	drawdowns: DrawdownSpan[];
	metadata: PerformanceMetadata;
}

export interface StreakDiagnostics {
	longestWinStreak: number;
	longestLossStreak: number;
	currentWinStreak: number;
	currentLossStreak: number;
}

export interface PlayTypeInsight {
	count: number;
	netProfit: number;
	winRate: number;
	averageDurationMs: number;
}

export interface SessionHeatmapBin {
	bucket: string;
	count: number;
	netProfit: number;
	winRate: number;
}

export interface DurationClusterInsight {
	rangeLabel: string;
	count: number;
	avgReturnPct: number;
}

export interface VolatilityReactionInsight {
	bucket: string;
	count: number;
	netProfit: number;
}

export interface PostStopWinInsight {
	gapTrades: number;
	gapDurationMs: number;
}

export interface DiagnosticsReport {
	streaks: StreakDiagnostics;
	playTypeSkew: Record<string, PlayTypeInsight>;
	sessionHeatmap: Record<string, SessionHeatmapBin>;
	durationClusters: DurationClusterInsight[];
	volatilityReactions: VolatilityReactionInsight[];
	postStopWins: PostStopWinInsight[];
}

export interface PerformanceReport {
	summary: MetricsSummary;
	trades: TradeDiagnostic[];
	diagnostics: DiagnosticsReport;
}
