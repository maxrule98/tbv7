/**
 * Smoke tests for strategy loading and basic operation.
 * These tests verify that each registered strategy can:
 * 1. Load its configuration
 * 2. Build with dependencies
 * 3. Produce a decision for sample data
 * 4. Not throw exceptions during basic operation
 */

import { describe, it, expect } from "vitest";
import { getRegisteredStrategyIds, getStrategyDefinition } from "../registry";
import type { Candle } from "../../types";

const createMockCandle = (
	idx: number,
	symbol: string = "BTC/USDT",
	timeframe: string = "1m"
): Candle => ({
	symbol,
	timeframe,
	timestamp: Date.UTC(2025, 0, 1, 0, idx, 0),
	open: 100 + idx,
	high: 101 + idx,
	low: 99 + idx,
	close: 100 + idx,
	volume: 1000,
});

const createMockCandles = (
	count: number,
	symbol: string = "BTC/USDT",
	timeframe: string = "1m"
): Candle[] => {
	return Array.from({ length: count }, (_, i) =>
		createMockCandle(i, symbol, timeframe)
	);
};

describe("Strategy Registry Smoke Tests", () => {
	it("should list all registered strategies", () => {
		const ids = getRegisteredStrategyIds();
		expect(ids.length).toBeGreaterThan(0);
		expect(ids).toContain("ultra_aggressive_btc_usdt");
		expect(ids).toContain("vwap_delta_gamma");
		expect(ids).toContain("debug_4c_pipeline");
	});

	const strategyIds = getRegisteredStrategyIds();

	strategyIds.forEach((strategyId) => {
		describe(`Strategy: ${strategyId}`, () => {
			it("should load strategy definition", () => {
				const definition = getStrategyDefinition(strategyId);
				expect(definition).toBeDefined();
				expect(definition.id).toBe(strategyId);
				expect(definition.manifest).toBeDefined();
			});

			it("should have loadConfig function", () => {
				const definition = getStrategyDefinition(strategyId);
				expect(typeof definition.loadConfig).toBe("function");
			});

			it("should have createStrategy function", () => {
				const definition = getStrategyDefinition(strategyId);
				expect(typeof definition.createStrategy).toBe("function");
			});

			it("should load config from default path", () => {
				const definition = getStrategyDefinition(strategyId);
				const config = definition.loadConfig() as any;
				expect(config).toBeDefined();
				expect(config.id).toBe(strategyId);
			});
		});
	});
});

describe("Strategy Basic Operation Smoke Tests", () => {
	it("should create ultra_aggressive_btc_usdt strategy and call decide", async () => {
		const definition = getStrategyDefinition("ultra_aggressive_btc_usdt");
		const config = definition.loadConfig();

		// Mock candles for execution timeframe
		const candles1m = createMockCandles(120, "BTC/USDT", "1m");
		const candles5m = createMockCandles(30, "BTC/USDT", "5m");
		const candles15m = createMockCandles(20, "BTC/USDT", "15m");

		const mockCache = {
			getCandles: async (timeframe: string) => {
				if (timeframe === "1m") return candles1m;
				if (timeframe === "5m") return candles5m;
				if (timeframe === "15m") return candles15m;
				return [];
			},
			getLatestCandle: async (timeframe: string) => {
				const candles = await mockCache.getCandles(timeframe);
				return candles[candles.length - 1];
			},
			refreshAll: async () => {},
		};

		const strategy = definition.createStrategy(config, {
			cache: mockCache,
		}) as any;
		expect(strategy).toBeDefined();

		// Should be able to call decide without throwing
		const intent = await strategy.decide("FLAT");
		expect(intent).toBeDefined();
		expect(intent.intent).toBeDefined();
		expect(intent.symbol).toBe("BTC/USDT");
	});

	it("should create vwap_delta_gamma strategy and call decide", async () => {
		const definition = getStrategyDefinition("vwap_delta_gamma");
		const config = definition.loadConfig();

		const candles1m = createMockCandles(300, "BTC/USDT", "1m");
		const candles5m = createMockCandles(150, "BTC/USDT", "5m");
		const candles15m = createMockCandles(180, "BTC/USDT", "15m");
		const candles1h = createMockCandles(120, "BTC/USDT", "1h");

		const mockCache = {
			getCandles: async (timeframe: string) => {
				if (timeframe === "1m") return candles1m;
				if (timeframe === "5m") return candles5m;
				if (timeframe === "15m") return candles15m;
				if (timeframe === "1h") return candles1h;
				return [];
			},
			getLatestCandle: async (timeframe: string) => {
				const candles = await mockCache.getCandles(timeframe);
				return candles[candles.length - 1];
			},
			refreshAll: async () => {},
		};

		const strategy = definition.createStrategy(config, {
			cache: mockCache,
		}) as any;
		expect(strategy).toBeDefined();

		const intent = await strategy.decide("FLAT");
		expect(intent).toBeDefined();
		expect(intent.intent).toBeDefined();
	});

	it("should create debug_4c_pipeline strategy and call decide", async () => {
		const definition = getStrategyDefinition("debug_4c_pipeline");
		const config = definition.loadConfig();

		const candles1m = createMockCandles(20, "BTC/USDT", "1m");

		const mockCache = {
			getCandles: async () => candles1m,
			getLatestCandle: async () => candles1m[candles1m.length - 1],
			refreshAll: async () => {},
		};

		const strategy = definition.createStrategy(config, {
			cache: mockCache,
		}) as any;
		expect(strategy).toBeDefined();

		const intent = await strategy.decide("FLAT");
		expect(intent).toBeDefined();
		expect(intent.intent).toBeDefined();
	});
});
