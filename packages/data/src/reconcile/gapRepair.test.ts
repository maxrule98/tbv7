import { describe, it, expect, vi } from "vitest";
import { repairCandleGap } from "./gapRepair";
import type { Candle } from "@agenai/core";

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

describe("repairCandleGap", () => {
	describe("no gap scenarios", () => {
		it("should return empty results when no gap exists (consecutive candles)", async () => {
			const lastTs = 60_000; // 1 minute
			const nextTs = 120_000; // 2 minutes
			const fetchCandles = vi.fn().mockResolvedValue([]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.gapSize).toBe(0);
			expect(result.missing).toEqual([]);
			expect(result.fromTs).toBe(120_000);
			expect(result.toTs).toBe(120_000);
			expect(fetchCandles).not.toHaveBeenCalled();
		});

		it("should handle zero gap size", async () => {
			const lastTs = 0;
			const nextTs = 60_000;
			const fetchCandles = vi.fn();

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.gapSize).toBe(0);
			expect(result.missing).toEqual([]);
			expect(fetchCandles).not.toHaveBeenCalled();
		});
	});

	describe("single missing candle", () => {
		it("should fetch and return exactly one missing candle", async () => {
			const lastTs = 60_000;
			const nextTs = 180_000; // 2 minutes gap = 1 missing candle at 120_000
			const missingCandle = createCandle(120_000, 101);

			const fetchCandles = vi.fn().mockResolvedValue([missingCandle]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.gapSize).toBe(1);
			expect(result.missing).toHaveLength(1);
			expect(result.missing[0]).toEqual(missingCandle);
			expect(result.fromTs).toBe(120_000);
			expect(result.toTs).toBe(180_000);
			expect(fetchCandles).toHaveBeenCalledWith(120_000);
		});

		it("should normalize misaligned timestamp to bucket boundary", async () => {
			const lastTs = 60_000;
			const nextTs = 180_000;
			const misalignedCandle = createCandle(120_123, 101); // Misaligned by 123ms

			const fetchCandles = vi.fn().mockResolvedValue([misalignedCandle]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.missing).toHaveLength(1);
			expect(result.missing[0]?.timestamp).toBe(120_000); // Normalized to bucket
		});
	});

	describe("multiple missing candles", () => {
		it("should fetch and return multiple missing candles in order", async () => {
			const lastTs = 60_000;
			const nextTs = 300_000; // 4-minute gap = 3 missing candles

			const fetchCandles = vi
				.fn()
				.mockResolvedValue([
					createCandle(120_000, 101),
					createCandle(180_000, 102),
					createCandle(240_000, 103),
				]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.gapSize).toBe(3);
			expect(result.missing).toHaveLength(3);
			expect(result.missing[0]?.timestamp).toBe(120_000);
			expect(result.missing[1]?.timestamp).toBe(180_000);
			expect(result.missing[2]?.timestamp).toBe(240_000);
		});

		it("should handle larger gaps (5m timeframe)", async () => {
			const lastTs = 300_000; // 5 minutes
			const nextTs = 1_200_000; // 20 minutes = 2 missing 5m candles

			const fetchCandles = vi.fn().mockResolvedValue([
				createCandle(600_000, 101),
				createCandle(900_000, 102),
				createCandle(1_500_000, 103), // Outside range, should be filtered
			]);

			const result = await repairCandleGap({
				timeframe: "5m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.gapSize).toBe(2);
			expect(result.missing).toHaveLength(2); // Third candle filtered out
			expect(result.missing[0]?.timestamp).toBe(600_000);
			expect(result.missing[1]?.timestamp).toBe(900_000);
		});
	});

	describe("out-of-order and duplicate handling", () => {
		it("should sort out-of-order candles", async () => {
			const lastTs = 60_000;
			const nextTs = 300_000;

			const fetchCandles = vi.fn().mockResolvedValue([
				createCandle(240_000, 103), // Out of order
				createCandle(120_000, 101),
				createCandle(180_000, 102),
			]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.missing).toHaveLength(3);
			expect(result.missing[0]?.timestamp).toBe(120_000);
			expect(result.missing[1]?.timestamp).toBe(180_000);
			expect(result.missing[2]?.timestamp).toBe(240_000);
		});

		it("should deduplicate candles with same timestamp", async () => {
			const lastTs = 60_000;
			const nextTs = 240_000;

			const fetchCandles = vi.fn().mockResolvedValue([
				createCandle(120_000, 101),
				createCandle(120_000, 999), // Duplicate timestamp (different close)
				createCandle(180_000, 102),
				createCandle(180_000, 888), // Duplicate timestamp
			]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.missing).toHaveLength(2); // Deduped
			expect(result.missing[0]?.timestamp).toBe(120_000);
			expect(result.missing[0]?.close).toBe(101); // First occurrence kept
			expect(result.missing[1]?.timestamp).toBe(180_000);
			expect(result.missing[1]?.close).toBe(102); // First occurrence kept
		});

		it("should handle both out-of-order and duplicates simultaneously", async () => {
			const lastTs = 0;
			const nextTs = 300_000;

			const fetchCandles = vi.fn().mockResolvedValue([
				createCandle(180_000, 102),
				createCandle(60_000, 101),
				createCandle(180_000, 999), // Duplicate
				createCandle(240_000, 103),
				createCandle(60_000, 888), // Duplicate
			]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.missing).toHaveLength(3);
			expect(result.missing[0]?.timestamp).toBe(60_000);
			expect(result.missing[0]?.close).toBe(101); // First occurrence
			expect(result.missing[1]?.timestamp).toBe(180_000);
			expect(result.missing[1]?.close).toBe(102); // First occurrence
			expect(result.missing[2]?.timestamp).toBe(240_000);
		});
	});

	describe("boundary filtering", () => {
		it("should exclude candles before gap start (< fromTs)", async () => {
			const lastTs = 120_000;
			const nextTs = 240_000;

			const fetchCandles = vi.fn().mockResolvedValue([
				createCandle(60_000, 99), // Before gap
				createCandle(120_000, 100), // At lastTs (excluded)
				createCandle(180_000, 101), // Valid
			]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.missing).toHaveLength(1);
			expect(result.missing[0]?.timestamp).toBe(180_000);
		});

		it("should exclude candles at or after gap end (>= toTs)", async () => {
			const lastTs = 60_000;
			const nextTs = 240_000;

			const fetchCandles = vi.fn().mockResolvedValue([
				createCandle(120_000, 101), // Valid
				createCandle(180_000, 102), // Valid
				createCandle(240_000, 103), // At nextTs (excluded)
				createCandle(300_000, 104), // After gap (excluded)
			]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.missing).toHaveLength(2);
			expect(result.missing[0]?.timestamp).toBe(120_000);
			expect(result.missing[1]?.timestamp).toBe(180_000);
		});

		it("should handle fetch returning only out-of-range candles", async () => {
			const lastTs = 180_000;
			const nextTs = 300_000;

			const fetchCandles = vi.fn().mockResolvedValue([
				createCandle(60_000, 99), // Before
				createCandle(120_000, 100), // Before
				createCandle(300_000, 101), // After
				createCandle(360_000, 102), // After
			]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.missing).toHaveLength(0); // All filtered out
		});
	});

	describe("logging", () => {
		it("should call log callback when provided and candles found", async () => {
			const lastTs = 60_000;
			const nextTs = 240_000;
			const log = vi.fn();

			const fetchCandles = vi
				.fn()
				.mockResolvedValue([
					createCandle(120_000, 101),
					createCandle(180_000, 102),
				]);

			await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
				log,
			});

			expect(log).toHaveBeenCalledWith("gap_repair_fetched", {
				timeframe: "1m",
				gapSize: 2,
				fromTs: 120_000,
				toTs: 240_000,
				fetched: 2,
				valid: 2,
			});
		});

		it("should not call log callback when no candles found", async () => {
			const lastTs = 60_000;
			const nextTs = 180_000;
			const log = vi.fn();

			const fetchCandles = vi.fn().mockResolvedValue([]);

			await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
				log,
			});

			expect(log).not.toHaveBeenCalled();
		});

		it("should work without log callback", async () => {
			const lastTs = 60_000;
			const nextTs = 180_000;

			const fetchCandles = vi.fn().mockResolvedValue([createCandle(120_000)]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
				// No log callback
			});

			expect(result.missing).toHaveLength(1);
		});
	});

	describe("edge cases", () => {
		it("should handle empty fetch result", async () => {
			const lastTs = 60_000;
			const nextTs = 240_000;

			const fetchCandles = vi.fn().mockResolvedValue([]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.gapSize).toBe(2);
			expect(result.missing).toHaveLength(0);
		});

		it("should handle very large gaps", async () => {
			const lastTs = 0;
			const nextTs = 3_600_000; // 1 hour = 60 missing 1m candles

			const fetchCandles = vi.fn().mockResolvedValue([
				createCandle(60_000),
				createCandle(120_000),
				// ... partial fill
			]);

			const result = await repairCandleGap({
				timeframe: "1m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.gapSize).toBe(59);
			expect(fetchCandles).toHaveBeenCalledWith(60_000);
		});

		it("should work with 5m timeframe", async () => {
			const lastTs = 0;
			const nextTs = 900_000; // 15 minutes = 2 missing 5m candles

			const fetchCandles = vi
				.fn()
				.mockResolvedValue([
					createCandle(300_000, 101),
					createCandle(600_000, 102),
				]);

			const result = await repairCandleGap({
				timeframe: "5m",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.gapSize).toBe(2);
			expect(result.missing).toHaveLength(2);
		});

		it("should work with 1h timeframe", async () => {
			const lastTs = 0;
			const nextTs = 7_200_000; // 2 hours = 1 missing 1h candle

			const fetchCandles = vi.fn().mockResolvedValue([createCandle(3_600_000)]);

			const result = await repairCandleGap({
				timeframe: "1h",
				lastTs,
				nextTs,
				fetchCandles,
			});

			expect(result.gapSize).toBe(1);
			expect(result.missing).toHaveLength(1);
		});
	});
});
