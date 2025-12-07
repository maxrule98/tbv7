import { describe, expect, it, vi } from "vitest";
import { Candle } from "../../types";
import { MultiTimeframeCache } from "../../data/multiTimeframeCache";
import { UltraAggressiveBtcUsdtConfig } from "./config";
import { UltraAggressiveBtcUsdtStrategy } from "./index";

vi.mock("@agenai/indicators", () => ({
	calculateATRSeries: () => Array(20).fill(2),
	calculateDailyVWAP: () => 100,
	calculateRSI: () => 30,
	ema: () => 100,
}));

class StubCache implements MultiTimeframeCache {
	constructor(private readonly frames: Record<string, Candle[]>) {}

	async getCandles(timeframe: string): Promise<Candle[]> {
		const candles = this.frames[timeframe] ?? [];
		return candles.map((candle) => ({ ...candle }));
	}

	async getLatestCandle(timeframe: string): Promise<Candle | undefined> {
		const candles = this.frames[timeframe] ?? [];
		const latest = candles[candles.length - 1];
		return latest ? { ...latest } : undefined;
	}

	async refreshAll(): Promise<void> {
		// no-op for tests
	}
}

const baseTimestamp = Date.UTC(2025, 0, 1, 0, 0, 0);

const makeCandle = (
	index: number,
	timeframe: string,
	intervalMs: number,
	overrides: Partial<Candle> = {}
): Candle => {
	return {
		symbol: "BTC/USDT",
		timeframe,
		timestamp: baseTimestamp + index * intervalMs,
		open: 100 + index,
		high: 101 + index,
		low: 99 + index,
		close: 100 + index,
		volume: 100 + index,
		...overrides,
	};
};

const buildExecutionCandles = (): Candle[] => {
	const candles = Array.from({ length: 12 }, (_, idx) =>
		makeCandle(idx, "1m", 60_000)
	);

	candles[8] = makeCandle(8, "1m", 60_000, {
		open: 112,
		close: 110,
		high: 113,
		low: 109,
		volume: 150,
	});
	candles[9] = makeCandle(9, "1m", 60_000, {
		open: 94,
		close: 96,
		high: 101,
		low: 95,
		volume: 210,
	});
	candles[10] = makeCandle(10, "1m", 60_000, {
		open: 96,
		close: 98,
		high: 102,
		low: 97,
		volume: 215,
	});
	candles[11] = makeCandle(11, "1m", 60_000, {
		open: 95,
		close: 96,
		high: 99,
		low: 90,
		volume: 220,
	});

	return candles;
};

const cloneCandles = (
	source: Candle[],
	timeframe: string,
	intervalMs: number
): Candle[] =>
	source.map((candle, idx) => ({
		...candle,
		timeframe,
		timestamp: baseTimestamp + idx * intervalMs,
	}));

const buildTestConfig = (): UltraAggressiveBtcUsdtConfig => ({
	name: "test-ultra",
	symbol: "BTC/USDT",
	timeframes: {
		execution: "1m",
		confirming: "5m",
		context: "15m",
	},
	historyWindowCandles: 400,
	warmupPeriods: {
		default: 60,
		"1m": 120,
		"5m": 60,
		"15m": 60,
	},
	cacheTTLms: 1000,
	atrPeriod1m: 5,
	atrPeriod5m: 5,
	emaFastPeriod: 3,
	emaSlowPeriod: 5,
	rsiPeriod: 14,
	lookbacks: {
		executionBars: 6,
		breakoutRange: 6,
		rangeDetection: 6,
		trendCandles: 6,
		volatility: 6,
		cvd: 10,
	},
	playTypePriority: [
		"liquiditySweep",
		"breakout",
		"meanReversion",
		"breakoutTrap",
	],
	thresholds: {
		vwapStretchPct: 0.0001,
		breakoutVolumeMultiple: 1,
		breakoutAtrMultiple: 0.1,
		meanRevStretchAtr: 0.1,
		liquiditySweepWickMultiple: 0.1,
		trapVolumeMaxMultiple: 2,
		cvdDivergenceThreshold: 0.1,
		rsiOverbought: 60,
		rsiOversold: 40,
	},
	risk: {
		riskPerTradePct: 0.01,
		atrStopMultiple: 1,
		partialTpRR: 1,
		finalTpRR: 2,
		trailingAtrMultiple: 1,
	},
	maxTradeDurationMinutes: 60,
	enableVolatilityFadeExit: true,
	allowBreakoutsWhenRSIOverbought: false,
	reversionNeedsTwoOfThreeConditions: true,
	maxDrawdownPerTradePct: 0.01,
	cooldownAfterStopoutBars: 5,
	dailyDrawdownLimitPct: 0.03,
});

describe("UltraAggressiveBtcUsdtStrategy", () => {
	it("emits a liquidity sweep long intent when conditions align", async () => {
		const execution = buildExecutionCandles();
		const confirming = cloneCandles(execution, "5m", 300_000);
		const context = cloneCandles(execution, "15m", 900_000);
		const cache = new StubCache({
			"1m": execution,
			"5m": confirming,
			"15m": context,
		});
		const strategy = new UltraAggressiveBtcUsdtStrategy(buildTestConfig(), {
			cache,
		});

		const intent = await strategy.decide("FLAT");

		expect(intent.intent).toBe("OPEN_LONG");
		expect(intent.reason).toBe("liquidity_sweep_long");
		expect(intent.metadata).toMatchObject({
			stop: expect.any(Number),
			tp1: expect.any(Number),
			tp2: expect.any(Number),
			confidence: expect.any(Number),
		});
	});
});
