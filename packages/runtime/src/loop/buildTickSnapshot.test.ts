import { describe, it, expect } from "vitest";
import { buildTickSnapshot } from "./buildTickSnapshot";
import type { Candle } from "@agenai/core";

describe("buildTickSnapshot", () => {
	const createAlignedCandle = (timestamp: number): Candle => ({
		timestamp,
		open: 50000,
		high: 51000,
		low: 49000,
		close: 50500,
		volume: 100,
		symbol: "BTC/USDT",
		timeframe: "1m",
	});

	it("should build snapshot with aligned execution candle", () => {
		const executionCandle = createAlignedCandle(1735690260000); // Aligned to 1m
		const series = {
			"1m": [createAlignedCandle(1735690260000)],
			"5m": [createAlignedCandle(1735690200000)],
		};

		const snapshot = buildTickSnapshot({
			symbol: "BTC/USDT",
			signalVenue: "binance",
			executionTimeframe: "1m",
			executionCandle,
			series,
		});

		expect(snapshot.symbol).toBe("BTC/USDT");
		expect(snapshot.signalVenue).toBe("binance");
		expect(snapshot.executionTimeframe).toBe("1m");
		expect(snapshot.executionCandle).toBe(executionCandle);
		expect(snapshot.series).toBe(series);
		expect(snapshot.meta.asOfTs).toBe(1735690260000);
		expect(snapshot.meta.tfMs["1m"]).toBe(60_000);
		expect(snapshot.meta.tfMs["5m"]).toBe(300_000);
	});

	it("should compute tfMs for all timeframes including execution", () => {
		const executionCandle = createAlignedCandle(1735690260000);
		const series = {
			"5m": [createAlignedCandle(1735690200000)],
			"15m": [createAlignedCandle(1735689900000)],
		};

		const snapshot = buildTickSnapshot({
			symbol: "BTC/USDT",
			signalVenue: "binance",
			executionTimeframe: "1m",
			executionCandle,
			series,
		});

		expect(snapshot.meta.tfMs).toEqual({
			"1m": 60_000,
			"5m": 300_000,
			"15m": 900_000,
		});
	});

	it("should include optional metadata", () => {
		const executionCandle = createAlignedCandle(1735690260000);
		const series = {
			"1m": [createAlignedCandle(1735690260000)],
		};

		const snapshot = buildTickSnapshot({
			symbol: "BTC/USDT",
			signalVenue: "binance",
			executionTimeframe: "1m",
			executionCandle,
			series,
			arrivalDelayMs: 150,
			sourceByTf: { "1m": "ws" },
			gapFilledByTf: { "1m": false },
		});

		expect(snapshot.meta.arrivalDelayMs).toBe(150);
		expect(snapshot.meta.sourceByTf).toEqual({ "1m": "ws" });
		expect(snapshot.meta.gapFilledByTf).toEqual({ "1m": false });
	});

	it("should throw if execution candle timestamp is not aligned", () => {
		const misalignedCandle = createAlignedCandle(1735690261234); // Not aligned to 1m
		const series = {
			"1m": [misalignedCandle],
		};

		expect(() =>
			buildTickSnapshot({
				symbol: "BTC/USDT",
				signalVenue: "binance",
				executionTimeframe: "1m",
				executionCandle: misalignedCandle,
				series,
			})
		).toThrow("context: executionCandle");
	});

	it("should set asOfTs to bucketed execution candle timestamp", () => {
		const executionCandle = createAlignedCandle(1735690200000); // Aligned to 5m
		const series = {
			"5m": [createAlignedCandle(1735690200000)],
		};

		const snapshot = buildTickSnapshot({
			symbol: "BTC/USDT",
			signalVenue: "mexc",
			executionTimeframe: "5m",
			executionCandle,
			series,
		});

		expect(snapshot.meta.asOfTs).toBe(1735690200000);
	});

	it("should handle empty series", () => {
		const executionCandle = createAlignedCandle(1735690260000);
		const series = {};

		const snapshot = buildTickSnapshot({
			symbol: "BTC/USDT",
			signalVenue: "binance",
			executionTimeframe: "1m",
			executionCandle,
			series,
		});

		expect(snapshot.series).toEqual({});
		expect(snapshot.meta.tfMs).toEqual({
			"1m": 60_000,
		});
	});

	it("should not mutate input candle arrays", () => {
		const executionCandle = createAlignedCandle(1735690260000);
		const candles = [createAlignedCandle(1735690260000)];
		const series = { "1m": candles };

		const snapshot = buildTickSnapshot({
			symbol: "BTC/USDT",
			signalVenue: "binance",
			executionTimeframe: "1m",
			executionCandle,
			series,
		});

		expect(snapshot.series["1m"]).toBe(candles); // Same reference
		expect(candles.length).toBe(1); // Not mutated
	});
});
