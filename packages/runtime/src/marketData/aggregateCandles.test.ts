import { describe, it, expect } from "vitest";
import type { Candle } from "@agenai/core";
import {
	aggregateCandle,
	detectClosedBuckets,
	aggregateNewlyClosed,
} from "./aggregateCandles";

const symbol = "BTC/USDT";

const buildCandle = (
	timestamp: number,
	open: number,
	high: number,
	low: number,
	close: number,
	volume: number,
	timeframe = "1m"
): Candle => ({
	symbol,
	timeframe,
	timestamp,
	open,
	high,
	low,
	close,
	volume,
});

describe("aggregateCandle", () => {
	it("should aggregate 1m candles into 5m candle", () => {
		const baseCandles: Candle[] = [
			buildCandle(0, 100, 102, 99, 101, 10),
			buildCandle(60_000, 101, 103, 100, 102, 15),
			buildCandle(120_000, 102, 105, 101, 104, 20),
			buildCandle(180_000, 104, 106, 103, 105, 25),
			buildCandle(240_000, 105, 107, 104, 106, 30),
		];

		const aggregated = aggregateCandle(baseCandles, "5m", 0, symbol);

		expect(aggregated).toEqual({
			symbol,
			timeframe: "5m",
			timestamp: 0,
			open: 100, // First open
			high: 107, // Max high
			low: 99, // Min low
			close: 106, // Last close
			volume: 100, // Sum of volumes
		});
	});

	it("should aggregate 1m candles into 15m candle", () => {
		const baseCandles: Candle[] = Array.from({ length: 15 }, (_, i) =>
			buildCandle(i * 60_000, 100 + i, 102 + i, 99 + i, 101 + i, 10 + i)
		);

		const aggregated = aggregateCandle(baseCandles, "15m", 0, symbol);

		expect(aggregated).toEqual({
			symbol,
			timeframe: "15m",
			timestamp: 0,
			open: 100,
			high: 116, // 102 + 14
			low: 99,
			close: 115, // 101 + 14
			volume: 255, // 10+11+...+24 = 255
		});
	});

	it("should return null when no base candles in bucket", () => {
		const baseCandles: Candle[] = [buildCandle(0, 100, 102, 99, 101, 10)];

		// Asking for 5m bucket at 300_000 (5 minutes later)
		const aggregated = aggregateCandle(baseCandles, "5m", 300_000, symbol);

		expect(aggregated).toBeNull();
	});

	it("should only include candles within bucket boundaries", () => {
		const baseCandles: Candle[] = [
			buildCandle(0, 100, 102, 99, 101, 10),
			buildCandle(60_000, 101, 103, 100, 102, 15),
			buildCandle(300_000, 102, 105, 101, 104, 20), // Outside 5m bucket [0, 300_000)
		];

		const aggregated = aggregateCandle(baseCandles, "5m", 0, symbol);

		// Should only use first 2 candles (within [0, 300_000))
		expect(aggregated).toEqual({
			symbol,
			timeframe: "5m",
			timestamp: 0,
			open: 100,
			high: 103,
			low: 99,
			close: 102,
			volume: 25,
		});
	});
});

describe("detectClosedBuckets", () => {
	it("should detect 5m bucket closed when crossing boundary", () => {
		const previousTs = 240_000; // 4 minutes
		const currentTs = 300_000; // 5 minutes

		const closed = detectClosedBuckets(previousTs, currentTs, ["5m"]);

		expect(closed).toEqual([{ timeframe: "5m", bucketTimestamp: 0 }]);
	});

	it("should detect multiple timeframe buckets closed", () => {
		const previousTs = 240_000; // 4 minutes
		const currentTs = 900_000; // 15 minutes

		const closed = detectClosedBuckets(previousTs, currentTs, ["5m", "15m"]);

		expect(closed).toContainEqual({ timeframe: "5m", bucketTimestamp: 0 });
		expect(closed).toContainEqual({ timeframe: "15m", bucketTimestamp: 0 });
	});

	it("should not detect bucket closed within same bucket", () => {
		const previousTs = 60_000; // 1 minute
		const currentTs = 120_000; // 2 minutes

		const closed = detectClosedBuckets(previousTs, currentTs, ["5m"]);

		expect(closed).toEqual([]);
	});

	it("should handle first candle (previousTs = 0)", () => {
		const previousTs = 0;
		const currentTs = 60_000; // 1 minute

		const closed = detectClosedBuckets(previousTs, currentTs, ["1m", "5m"]);

		// 1m bucket at 0 is closed
		expect(closed).toContainEqual({ timeframe: "1m", bucketTimestamp: 0 });
		// 5m bucket at 0 is not yet closed (need to reach 300_000)
		expect(closed).not.toContainEqual({ timeframe: "5m", bucketTimestamp: 0 });
	});
});

describe("aggregateNewlyClosed", () => {
	it("should aggregate and return newly closed higher timeframe candles", () => {
		const baseCandles: Candle[] = [
			buildCandle(0, 100, 102, 99, 101, 10),
			buildCandle(60_000, 101, 103, 100, 102, 15),
			buildCandle(120_000, 102, 105, 101, 104, 20),
			buildCandle(180_000, 104, 106, 103, 105, 25),
			buildCandle(240_000, 105, 107, 104, 106, 30),
		];

		const lastBaseTsMs = 180_000;
		const currentBaseTsMs = 300_000; // Cross 5m boundary

		const aggregated = aggregateNewlyClosed(
			baseCandles,
			["5m"],
			lastBaseTsMs,
			currentBaseTsMs,
			symbol
		);

		expect(aggregated).toHaveLength(1);
		expect(aggregated[0].timeframe).toBe("5m");
		expect(aggregated[0].candle).toEqual({
			symbol,
			timeframe: "5m",
			timestamp: 0,
			open: 100,
			high: 107,
			low: 99,
			close: 106,
			volume: 100,
		});
	});

	it("should return empty array when no buckets closed", () => {
		const baseCandles: Candle[] = [buildCandle(0, 100, 102, 99, 101, 10)];

		const lastBaseTsMs = 0;
		const currentBaseTsMs = 60_000; // Still within same 5m bucket

		const aggregated = aggregateNewlyClosed(
			baseCandles,
			["5m"],
			lastBaseTsMs,
			currentBaseTsMs,
			symbol
		);

		expect(aggregated).toEqual([]);
	});

	it("should aggregate multiple timeframes when multiple buckets close", () => {
		const baseCandles: Candle[] = Array.from({ length: 15 }, (_, i) =>
			buildCandle(i * 60_000, 100 + i, 102 + i, 99 + i, 101 + i, 10 + i)
		);

		const lastBaseTsMs = 840_000; // 14 minutes
		const currentBaseTsMs = 900_000; // 15 minutes (crosses both 5m and 15m boundaries)

		const aggregated = aggregateNewlyClosed(
			baseCandles,
			["5m", "15m"],
			lastBaseTsMs,
			currentBaseTsMs,
			symbol
		);

		// Should have closed 5m bucket at 600_000 and 15m bucket at 0
		expect(aggregated.length).toBeGreaterThan(0);
		expect(aggregated.some((a) => a.timeframe === "5m")).toBe(true);
		expect(aggregated.some((a) => a.timeframe === "15m")).toBe(true);
	});
});
