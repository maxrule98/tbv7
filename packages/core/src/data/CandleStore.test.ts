import { describe, it, expect, beforeEach } from "vitest";
import { CandleStore } from "./CandleStore";
import type { Candle } from "../types";

const createCandle = (timestamp: number, close = 100): Candle => ({
	symbol: "BTC/USDT",
	timeframe: "1m",
	timestamp,
	open: close,
	high: close + 1,
	low: close - 1,
	close,
	volume: 1000,
});

describe("CandleStore", () => {
	let store: CandleStore;

	beforeEach(() => {
		store = new CandleStore({ defaultMaxCandles: 100 });
	});

	describe("ingest()", () => {
		it("should store a single candle", () => {
			const candle = createCandle(60_000);
			store.ingest("1m", candle);

			const series = store.getSeries("1m");
			expect(series).toHaveLength(1);
			expect(series[0]?.timestamp).toBe(60_000);
		});

		it("should normalize misaligned timestamps to bucket boundaries", () => {
			const misaligned = createCandle(60_123); // Off by 123ms
			store.ingest("1m", misaligned);

			const series = store.getSeries("1m");
			expect(series[0]?.timestamp).toBe(60_000); // Normalized
		});

		it("should maintain sorted ascending order", () => {
			store.ingest("1m", createCandle(180_000, 103));
			store.ingest("1m", createCandle(60_000, 101));
			store.ingest("1m", createCandle(120_000, 102));

			const series = store.getSeries("1m");
			expect(series.map((c) => c.timestamp)).toEqual([
				60_000, 120_000, 180_000,
			]);
		});

		it("should deduplicate by timestamp (last write wins)", () => {
			store.ingest("1m", createCandle(60_000, 100));
			store.ingest("1m", createCandle(60_000, 200)); // Replace

			const series = store.getSeries("1m");
			expect(series).toHaveLength(1);
			expect(series[0]?.close).toBe(200); // Last write
		});

		it("should respect per-timeframe window limits", () => {
			store = new CandleStore({
				defaultMaxCandles: 100,
				maxCandlesByTimeframe: { "1m": 3 },
			});

			store.ingest("1m", createCandle(60_000, 101));
			store.ingest("1m", createCandle(120_000, 102));
			store.ingest("1m", createCandle(180_000, 103));
			store.ingest("1m", createCandle(240_000, 104)); // Should trim oldest

			const series = store.getSeries("1m");
			expect(series).toHaveLength(3);
			expect(series.map((c) => c.timestamp)).toEqual([
				120_000, 180_000, 240_000,
			]);
		});

		it("should respect default window limit", () => {
			store = new CandleStore({ defaultMaxCandles: 2 });

			store.ingest("1m", createCandle(60_000));
			store.ingest("1m", createCandle(120_000));
			store.ingest("1m", createCandle(180_000)); // Trim oldest

			const series = store.getSeries("1m");
			expect(series).toHaveLength(2);
			expect(series.map((c) => c.timestamp)).toEqual([120_000, 180_000]);
		});

		it("should handle different timeframes independently", () => {
			store.ingest("1m", createCandle(60_000, 101));
			store.ingest("5m", createCandle(300_000, 102));

			expect(store.getSeries("1m")).toHaveLength(1);
			expect(store.getSeries("5m")).toHaveLength(1);
			expect(store.getSeries("1m")[0]?.close).toBe(101);
			expect(store.getSeries("5m")[0]?.close).toBe(102);
		});
	});

	describe("ingestMany()", () => {
		it("should ingest multiple candles efficiently", () => {
			const candles = [
				createCandle(60_000, 101),
				createCandle(120_000, 102),
				createCandle(180_000, 103),
			];
			store.ingestMany("1m", candles);

			const series = store.getSeries("1m");
			expect(series).toHaveLength(3);
			expect(series.map((c) => c.close)).toEqual([101, 102, 103]);
		});

		it("should handle out-of-order input", () => {
			const candles = [
				createCandle(180_000, 103),
				createCandle(60_000, 101),
				createCandle(120_000, 102),
			];
			store.ingestMany("1m", candles);

			const series = store.getSeries("1m");
			expect(series.map((c) => c.timestamp)).toEqual([
				60_000, 120_000, 180_000,
			]);
		});

		it("should deduplicate within input batch", () => {
			const candles = [
				createCandle(60_000, 100),
				createCandle(120_000, 102),
				createCandle(60_000, 101), // Duplicate timestamp
			];
			store.ingestMany("1m", candles);

			const series = store.getSeries("1m");
			expect(series).toHaveLength(2);
			expect(series[0]?.close).toBe(101); // Last write wins
		});

		it("should merge with existing candles", () => {
			store.ingest("1m", createCandle(60_000, 101));
			store.ingest("1m", createCandle(180_000, 103));

			store.ingestMany("1m", [
				createCandle(120_000, 102),
				createCandle(240_000, 104),
			]);

			const series = store.getSeries("1m");
			expect(series.map((c) => c.timestamp)).toEqual([
				60_000, 120_000, 180_000, 240_000,
			]);
		});

		it("should handle duplicates between existing and new candles", () => {
			store.ingest("1m", createCandle(60_000, 100));

			store.ingestMany("1m", [
				createCandle(60_000, 200), // Replace
				createCandle(120_000, 102),
			]);

			const series = store.getSeries("1m");
			expect(series).toHaveLength(2);
			expect(series[0]?.close).toBe(200); // New value wins
		});

		it("should normalize all timestamps", () => {
			const candles = [
				createCandle(60_123, 101), // Misaligned
				createCandle(120_456, 102), // Misaligned
			];
			store.ingestMany("1m", candles);

			const series = store.getSeries("1m");
			expect(series[0]?.timestamp).toBe(60_000);
			expect(series[1]?.timestamp).toBe(120_000);
		});

		it("should handle empty input gracefully", () => {
			store.ingestMany("1m", []);
			expect(store.getSeries("1m")).toHaveLength(0);
		});

		it("should trim after merge", () => {
			store = new CandleStore({ defaultMaxCandles: 3 });

			store.ingest("1m", createCandle(60_000));
			store.ingest("1m", createCandle(120_000));

			store.ingestMany("1m", [createCandle(180_000), createCandle(240_000)]);

			const series = store.getSeries("1m");
			expect(series).toHaveLength(3);
			expect(series.map((c) => c.timestamp)).toEqual([
				120_000, 180_000, 240_000,
			]);
		});
	});

	describe("getSeries()", () => {
		it("should return empty array for unknown timeframe", () => {
			expect(store.getSeries("1m")).toEqual([]);
		});

		it("should return defensive copy", () => {
			store.ingest("1m", createCandle(60_000));

			const series1 = store.getSeries("1m");
			const series2 = store.getSeries("1m");

			expect(series1).not.toBe(series2); // Different arrays
			expect(series1).toEqual(series2); // Same content
		});

		it("should not allow mutation of internal state", () => {
			store.ingest("1m", createCandle(60_000));

			const series = store.getSeries("1m");
			series.push(createCandle(120_000)); // Mutate copy

			expect(store.getSeries("1m")).toHaveLength(1); // Original unchanged
		});
	});

	describe("getLatestCandle()", () => {
		it("should return undefined for empty timeframe", () => {
			expect(store.getLatestCandle("1m")).toBeUndefined();
		});

		it("should return most recent candle", () => {
			store.ingest("1m", createCandle(60_000, 101));
			store.ingest("1m", createCandle(120_000, 102));
			store.ingest("1m", createCandle(180_000, 103));

			const latest = store.getLatestCandle("1m");
			expect(latest?.timestamp).toBe(180_000);
			expect(latest?.close).toBe(103);
		});

		it("should update as new candles are ingested", () => {
			store.ingest("1m", createCandle(60_000));
			expect(store.getLatestCandle("1m")?.timestamp).toBe(60_000);

			store.ingest("1m", createCandle(120_000));
			expect(store.getLatestCandle("1m")?.timestamp).toBe(120_000);
		});
	});

	describe("hasCandles()", () => {
		it("should return false for empty timeframe", () => {
			expect(store.hasCandles("1m")).toBe(false);
		});

		it("should return true after ingesting candles", () => {
			store.ingest("1m", createCandle(60_000));
			expect(store.hasCandles("1m")).toBe(true);
		});

		it("should return false after clearing timeframe", () => {
			store.ingest("1m", createCandle(60_000));
			store.clearTimeframe("1m");
			expect(store.hasCandles("1m")).toBe(false);
		});
	});

	describe("getTimeframes()", () => {
		it("should return empty array initially", () => {
			expect(store.getTimeframes()).toEqual([]);
		});

		it("should return all tracked timeframes", () => {
			store.ingest("1m", createCandle(60_000));
			store.ingest("5m", createCandle(300_000));
			store.ingest("15m", createCandle(900_000));

			const timeframes = store.getTimeframes();
			expect(timeframes).toHaveLength(3);
			expect(timeframes).toContain("1m");
			expect(timeframes).toContain("5m");
			expect(timeframes).toContain("15m");
		});
	});

	describe("clear()", () => {
		it("should remove all candles from all timeframes", () => {
			store.ingest("1m", createCandle(60_000));
			store.ingest("5m", createCandle(300_000));

			store.clear();

			expect(store.getSeries("1m")).toHaveLength(0);
			expect(store.getSeries("5m")).toHaveLength(0);
			expect(store.getTimeframes()).toHaveLength(0);
		});
	});

	describe("clearTimeframe()", () => {
		it("should remove candles only from specified timeframe", () => {
			store.ingest("1m", createCandle(60_000));
			store.ingest("5m", createCandle(300_000));

			store.clearTimeframe("1m");

			expect(store.getSeries("1m")).toHaveLength(0);
			expect(store.getSeries("5m")).toHaveLength(1);
		});
	});

	describe("window trimming", () => {
		it("should enforce minimum limit of 1", () => {
			store = new CandleStore({ defaultMaxCandles: 0 }); // Try to set 0

			store.ingest("1m", createCandle(60_000));
			store.ingest("1m", createCandle(120_000));

			expect(store.getSeries("1m")).toHaveLength(1); // Min 1
		});

		it("should handle per-timeframe overrides", () => {
			store = new CandleStore({
				defaultMaxCandles: 5,
				maxCandlesByTimeframe: {
					"1m": 2,
					"5m": 10,
				},
			});

			// 1m should trim to 2
			store.ingestMany("1m", [
				createCandle(60_000),
				createCandle(120_000),
				createCandle(180_000),
			]);
			expect(store.getSeries("1m")).toHaveLength(2);

			// 15m should use default (5)
			store.ingestMany("15m", [
				createCandle(900_000),
				createCandle(1_800_000),
				createCandle(2_700_000),
				createCandle(3_600_000),
				createCandle(4_500_000),
				createCandle(5_400_000),
			]);
			expect(store.getSeries("15m")).toHaveLength(5);
		});
	});

	describe("edge cases", () => {
		it("should handle single candle at timestamp 0", () => {
			store.ingest("1m", createCandle(0));
			expect(store.getSeries("1m")).toHaveLength(1);
			expect(store.getSeries("1m")[0]?.timestamp).toBe(0);
		});

		it("should handle large timestamp values", () => {
			const largeTs = Date.now();
			store.ingest("1m", createCandle(largeTs));
			expect(store.getLatestCandle("1m")?.timestamp).toBeLessThanOrEqual(
				largeTs
			);
		});

		it("should handle rapid sequential ingests", () => {
			for (let i = 0; i < 100; i++) {
				store.ingest("1m", createCandle(i * 60_000, i));
			}
			const series = store.getSeries("1m");
			expect(series).toHaveLength(100);
			// Verify sorted
			for (let i = 1; i < series.length; i++) {
				expect(series[i]!.timestamp).toBeGreaterThan(series[i - 1]!.timestamp);
			}
		});

		it("should handle ingesting same candle multiple times", () => {
			const candle = createCandle(60_000, 100);
			store.ingest("1m", candle);
			store.ingest("1m", candle);
			store.ingest("1m", candle);

			expect(store.getSeries("1m")).toHaveLength(1);
		});
	});
});
