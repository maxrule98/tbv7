import { describe, expect, it, vi } from "vitest";
import type {
	AccountConfig,
	AgenaiConfig,
	Candle,
	StrategyConfig,
	TradeIntent,
	UltraAggressiveBtcUsdtConfig,
} from "@agenai/core";
import type { MexcClient } from "@agenai/exchange-mexc";
import { runBacktest } from "./backtestRunner";
import type { BacktestConfig } from "./backtestTypes";
import type { TraderStrategy } from "../types";

const symbol = "BTC/USDT";
const timeframe = "1m";
const baseTimestamp = Date.UTC(2024, 0, 1, 0, 0, 0);
const defaultInitialBalance = 10_000;

const scriptedStrategy = (intents: TradeIntent[]): TraderStrategy => {
	let cursor = 0;
	return {
		decide: async () => {
			const intent = intents[cursor];
			if (cursor < intents.length) {
				cursor += 1;
			}
			return (
				intent ?? { symbol, intent: "NO_ACTION", reason: "script_exhausted" }
			);
		},
	};
};

const buildCandles = (
	tf: string,
	closes: number[],
	start = baseTimestamp,
	intervalMs = 60_000
): Candle[] =>
	closes.map((close, idx) => ({
		symbol,
		timeframe: tf,
		timestamp: start + idx * intervalMs,
		open: close - 1,
		high: close + 1,
		low: close - 1.5,
		close,
		volume: 100 + idx,
	}));

const buildBacktestConfig = (
	overrides: Partial<BacktestConfig> = {}
): BacktestConfig => ({
	symbol,
	timeframe,
	strategyId: "ultra_aggressive_btc_usdt",
	startTimestamp: baseTimestamp,
	endTimestamp: baseTimestamp + 3 * 60_000,
	initialBalance: defaultInitialBalance,
	...overrides,
});

const createAgenaiConfig = (): AgenaiConfig => {
	const strategyConfig: StrategyConfig = {
		id: "ultra_aggressive_btc_usdt",
		name: "Ultra Aggressive BTC/USDT",
		symbol,
		timeframes: {
			execution: timeframe,
			confirming: "5m",
			context: "15m",
		},
		cacheTTLms: 1500,
		atrPeriod1m: 14,
		atrPeriod5m: 14,
		emaFastPeriod: 9,
		emaSlowPeriod: 21,
		rsiPeriod: 14,
		lookbacks: {
			executionBars: 5,
			breakoutRange: 5,
			rangeDetection: 5,
			trendCandles: 5,
			volatility: 5,
			cvd: 5,
		},
		thresholds: {
			vwapStretchPct: 0.0035,
			breakoutVolumeMultiple: 1.2,
			breakoutAtrMultiple: 0.8,
			meanRevStretchAtr: 0.6,
			liquiditySweepWickMultiple: 1.1,
			trapVolumeMaxMultiple: 1.05,
			cvdDivergenceThreshold: 2,
			rsiOverbought: 70,
			rsiOversold: 30,
		},
		risk: {
			riskPerTradePct: 0.01,
			atrStopMultiple: 1.1,
			partialTpRR: 0.8,
			finalTpRR: 2,
			trailingAtrMultiple: 1,
		},
		maxTradeDurationMinutes: 60,
	} as UltraAggressiveBtcUsdtConfig & { id: "ultra_aggressive_btc_usdt" };

	return {
		env: {
			exchangeId: "mexc",
			executionMode: "paper",
			mexcApiKey: "",
			mexcApiSecret: "",
			defaultSymbol: symbol,
			defaultTimeframe: timeframe,
		},
		exchange: {
			id: "mexc",
			exchange: "mexc",
			market: "futures",
			testnet: true,
			restEndpoint: "https://testnet.mexc.com",
			wsEndpoint: "wss://testnet.mexc.com/ws",
			defaultSymbol: symbol,
			credentials: { apiKey: "", apiSecret: "" },
		},
		strategy: strategyConfig,
		risk: {
			maxLeverage: 5,
			riskPerTradePercent: 0.01,
			maxPositions: 1,
			slPct: 1,
			tpPct: 2,
			minPositionSize: 0.001,
			maxPositionSize: 10,
			trailingActivationPct: 0.01,
			trailingTrailPct: 0.005,
		},
	};
};

const accountConfig: AccountConfig = { startingBalance: defaultInitialBalance };

const createMockClient = () =>
	({
		fetchOHLCV: vi.fn(),
	}) as unknown as MexcClient;

describe("runBacktest", () => {
	it("replays provided candle data with a scripted strategy", async () => {
		const agenaiConfig = createAgenaiConfig();
		const backtestConfig = buildBacktestConfig();
		const candles1m = buildCandles("1m", [100, 102, 105, 110]);
		const candles5m = buildCandles(
			"5m",
			[100, 103, 106, 109],
			baseTimestamp,
			5 * 60_000
		);
		const candles15m = buildCandles(
			"15m",
			[100, 108, 112],
			baseTimestamp,
			15 * 60_000
		);
		const timeframeData = {
			"1m": candles1m,
			"5m": candles5m,
			"15m": candles15m,
		};
		const strategy = scriptedStrategy([
			{ symbol, intent: "OPEN_LONG", reason: "enter" },
			{ symbol, intent: "NO_ACTION", reason: "hold" },
			{ symbol, intent: "CLOSE_LONG", reason: "exit" },
		]);

		const mockClient = createMockClient();

		const result = await runBacktest(backtestConfig, {
			agenaiConfig,
			accountConfig,
			strategyOverride: strategy,
			client: mockClient,
			timeframeData,
		});

		expect(mockClient.fetchOHLCV).not.toHaveBeenCalled();
		expect(result.trades).toHaveLength(2);
		expect(result.trades[0]).toMatchObject({ action: "OPEN", side: "LONG" });
		expect(result.trades[1]).toMatchObject({ action: "CLOSE", side: "LONG" });
		expect(result.trades[1].realizedPnl).toBeGreaterThan(0);
		expect(result.equitySnapshots.length).toBeGreaterThan(0);
		expect(result.equitySnapshots.at(-1)?.equity).toBeGreaterThan(
			defaultInitialBalance
		);
	});

	it("falls back to strategy config symbol/timeframe when omitted", async () => {
		const agenaiConfig = createAgenaiConfig();
		const backtestConfig = buildBacktestConfig({
			symbol: undefined,
			timeframe: undefined,
		});
		const timeframeData = {
			"1m": buildCandles("1m", [100, 101, 102, 103]),
			"5m": buildCandles("5m", [100, 101], baseTimestamp, 5 * 60_000),
			"15m": buildCandles("15m", [100, 101], baseTimestamp, 15 * 60_000),
		};
		const mockClient = createMockClient();
		const strategy = scriptedStrategy([
			{ symbol, intent: "NO_ACTION", reason: "noop" },
		]);

		const result = await runBacktest(backtestConfig, {
			agenaiConfig,
			accountConfig,
			client: mockClient,
			strategyOverride: strategy,
			timeframeData,
		});

		expect(result.config.symbol).toBe(symbol);
		expect(result.config.timeframe).toBe(timeframe);
	});

	it("throws when execution timeframe candles are missing", async () => {
		const agenaiConfig = createAgenaiConfig();
		const backtestConfig = buildBacktestConfig();
		const mockClient = createMockClient();

		await expect(
			runBacktest(backtestConfig, {
				agenaiConfig,
				accountConfig,
				client: mockClient,
				timeframeData: { "5m": [] },
			})
		).rejects.toThrow("No candles loaded for execution timeframe");
	});

	it("emits diagnostics for the ultra strategy when debug mode is enabled", async () => {
		const originalDebug = process.env.ULTRA_DEBUG_MODE;
		const originalDiagnostics = process.env.ULTRA_DIAGNOSTICS;
		process.env.ULTRA_DEBUG_MODE = "1";
		process.env.ULTRA_DIAGNOSTICS = "1";
		const logs: any[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((value?: unknown) => {
				if (typeof value === "string") {
					try {
						logs.push(JSON.parse(value));
					} catch {
						// ignore non-JSON output
					}
				}
			});

		try {
			const candleCount = 400;
			const ramp = (count: number, start: number, step: number): number[] =>
				Array.from({ length: count }, (_, idx) => start + idx * step);
			const closes1m = ramp(candleCount, 100, 0.4);
			const closes5m = ramp(Math.ceil(candleCount / 5), 100, 2);
			const closes15m = ramp(Math.ceil(candleCount / 15), 100, 4);
			const timeframeData = {
				"1m": buildCandles("1m", closes1m),
				"5m": buildCandles("5m", closes5m, baseTimestamp, 5 * 60_000),
				"15m": buildCandles("15m", closes15m, baseTimestamp, 15 * 60_000),
			};
			const startTimestamp = baseTimestamp;
			const endTimestamp = baseTimestamp + (candleCount - 1) * 60_000;
			const agenaiConfig = createAgenaiConfig();
			const mockClient = createMockClient();
			const backtestConfig = buildBacktestConfig({
				startTimestamp,
				endTimestamp,
				maxCandles: candleCount,
			});

			const result = await runBacktest(backtestConfig, {
				agenaiConfig,
				accountConfig,
				client: mockClient,
				timeframeData,
			});

			const diagEvents = logs.filter(
				(entry) =>
					entry.event === "ultra_diagnostics" ||
					entry.event === "strategy_diagnostics"
			);
			const contextEvents = logs.filter(
				(entry) => entry.event === "strategy_context"
			);
			const diagContainsChecks = diagEvents.some(
				(event) =>
					Array.isArray(event.checks) &&
					(event.checks as Array<Record<string, unknown>>).some(
						(check) => typeof check.active === "boolean"
					)
			);
			expect(contextEvents.length).toBeGreaterThan(0);
			expect(diagEvents.length).toBeGreaterThan(0);
			expect(diagContainsChecks).toBe(true);
			expect(result.equitySnapshots.length).toBeGreaterThan(0);
		} finally {
			consoleSpy.mockRestore();
			if (originalDebug === undefined) {
				delete process.env.ULTRA_DEBUG_MODE;
			} else {
				process.env.ULTRA_DEBUG_MODE = originalDebug;
			}
			if (originalDiagnostics === undefined) {
				delete process.env.ULTRA_DIAGNOSTICS;
			} else {
				process.env.ULTRA_DIAGNOSTICS = originalDiagnostics;
			}
		}
	});
});
