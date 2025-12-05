import {
	DiagnosticsReport,
	DurationClusterInsight,
	PlayTypeInsight,
	PostStopWinInsight,
	SessionHeatmapBin,
	StreakDiagnostics,
	TradeDiagnostic,
	VolatilityReactionInsight,
} from "./metricsSchema";

export const buildDiagnosticsReport = (
	trades: TradeDiagnostic[]
): DiagnosticsReport => {
	return {
		streaks: buildStreakDiagnostics(trades),
		playTypeSkew: buildPlayTypeSkew(trades),
		sessionHeatmap: buildSessionHeatmap(trades),
		durationClusters: buildDurationClusters(trades),
		volatilityReactions: buildVolatilityReactions(trades),
		postStopWins: buildPostStopWins(trades),
	};
};

const buildStreakDiagnostics = (
	trades: TradeDiagnostic[]
): StreakDiagnostics => {
	let longestWinStreak = 0;
	let longestLossStreak = 0;
	let currentWinStreak = 0;
	let currentLossStreak = 0;

	for (const trade of trades) {
		if (trade.isWin) {
			currentWinStreak += 1;
			currentLossStreak = 0;
			longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
		} else if (trade.isLoss) {
			currentLossStreak += 1;
			currentWinStreak = 0;
			longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
		} else {
			currentLossStreak = 0;
			currentWinStreak = 0;
		}
	}

	return {
		longestWinStreak,
		longestLossStreak,
		currentWinStreak,
		currentLossStreak,
	};
};

const buildPlayTypeSkew = (
	trades: TradeDiagnostic[]
): Record<string, PlayTypeInsight> => {
	const groups: Record<string, PlayTypeInsight> = {};
	for (const trade of trades) {
		const key = trade.playType;
		if (!groups[key]) {
			groups[key] = {
				count: 0,
				netProfit: 0,
				winRate: 0,
				averageDurationMs: 0,
			};
		}
		const group = groups[key];
		group.count += 1;
		group.netProfit += trade.pnl;
		group.averageDurationMs += trade.durationMs;
		group.winRate += trade.isWin ? 1 : 0;
	}

	Object.values(groups).forEach((group) => {
		if (group.count) {
			group.averageDurationMs = group.averageDurationMs / group.count;
			group.winRate = group.winRate / group.count;
		}
	});

	return groups;
};

const buildSessionHeatmap = (
	trades: TradeDiagnostic[]
): Record<string, SessionHeatmapBin> => {
	const bins: Record<string, SessionHeatmapBin> = {};
	for (const trade of trades) {
		const bucket = trade.sessionLabel;
		if (!bins[bucket]) {
			bins[bucket] = {
				bucket,
				count: 0,
				netProfit: 0,
				winRate: 0,
			};
		}
		const bin = bins[bucket];
		bin.count += 1;
		bin.netProfit += trade.pnl;
		bin.winRate += trade.isWin ? 1 : 0;
	}

	Object.values(bins).forEach((bin) => {
		bin.winRate = bin.count ? bin.winRate / bin.count : 0;
	});

	return bins;
};

const buildDurationClusters = (
	trades: TradeDiagnostic[]
): DurationClusterInsight[] => {
	const buckets: DurationClusterInsight[] = [
		{ rangeLabel: "<5m", count: 0, avgReturnPct: 0 },
		{ rangeLabel: "5m-30m", count: 0, avgReturnPct: 0 },
		{ rangeLabel: "30m-2h", count: 0, avgReturnPct: 0 },
		{ rangeLabel: ">2h", count: 0, avgReturnPct: 0 },
	];

	for (const trade of trades) {
		const minutes = trade.durationMs / 60000;
		let bucketIndex = 0;
		if (minutes < 5) {
			bucketIndex = 0;
		} else if (minutes < 30) {
			bucketIndex = 1;
		} else if (minutes < 120) {
			bucketIndex = 2;
		} else {
			bucketIndex = 3;
		}
		const bucket = buckets[bucketIndex];
		bucket.count += 1;
		bucket.avgReturnPct += trade.returnPct;
	}

	return buckets.map((bucket) => ({
		...bucket,
		avgReturnPct: bucket.count ? bucket.avgReturnPct / bucket.count : 0,
	}));
};

const buildVolatilityReactions = (
	trades: TradeDiagnostic[]
): VolatilityReactionInsight[] => {
	const bands: VolatilityReactionInsight[] = [
		{ bucket: "low", count: 0, netProfit: 0 },
		{ bucket: "medium", count: 0, netProfit: 0 },
		{ bucket: "high", count: 0, netProfit: 0 },
	];

	for (const trade of trades) {
		const absPct = Math.abs(trade.returnPct);
		const bucketIndex = absPct < 0.005 ? 0 : absPct < 0.02 ? 1 : 2;
		const bucket = bands[bucketIndex];
		bucket.count += 1;
		bucket.netProfit += trade.pnl;
	}

	return bands;
};

const buildPostStopWins = (trades: TradeDiagnostic[]): PostStopWinInsight[] => {
	const insights: PostStopWinInsight[] = [];
	let pendingLossIndex: number | null = null;
	let pendingLossTimestamp: number | null = null;

	trades.forEach((trade, index) => {
		if (trade.isLoss) {
			pendingLossIndex = index;
			pendingLossTimestamp = trade.exitTimestamp;
			return;
		}

		if (
			trade.isWin &&
			pendingLossIndex !== null &&
			pendingLossTimestamp !== null
		) {
			insights.push({
				gapTrades: index - pendingLossIndex,
				gapDurationMs: trade.exitTimestamp - pendingLossTimestamp,
			});
			pendingLossIndex = null;
			pendingLossTimestamp = null;
		}
	});

	return insights;
};
