import { describe, it, expect } from "vitest";
import {
	timeframeToMs,
	parseTimeframe,
	bucketTimestamp,
	isBucketAligned,
	assertBucketAligned,
} from "./time";

describe("time utilities", () => {
	describe("timeframeToMs", () => {
		it("should parse minute timeframes", () => {
			expect(timeframeToMs("1m")).toBe(60_000);
			expect(timeframeToMs("5m")).toBe(300_000);
			expect(timeframeToMs("15m")).toBe(900_000);
			expect(timeframeToMs("30m")).toBe(1_800_000);
		});

		it("should parse hour timeframes", () => {
			expect(timeframeToMs("1h")).toBe(3_600_000);
			expect(timeframeToMs("4h")).toBe(14_400_000);
			expect(timeframeToMs("12h")).toBe(43_200_000);
		});

		it("should parse day timeframes", () => {
			expect(timeframeToMs("1d")).toBe(86_400_000);
			expect(timeframeToMs("7d")).toBe(604_800_000);
		});

		it("should be case-insensitive", () => {
			expect(timeframeToMs("1M")).toBe(60_000);
			expect(timeframeToMs("1H")).toBe(3_600_000);
			expect(timeframeToMs("1D")).toBe(86_400_000);
		});

		it("should handle whitespace", () => {
			expect(timeframeToMs(" 5m ")).toBe(300_000);
			expect(timeframeToMs("\t1h\n")).toBe(3_600_000);
		});

		it("should throw on invalid format", () => {
			expect(() => timeframeToMs("")).toThrow();
			expect(() => timeframeToMs("5")).toThrow("Invalid timeframe format");
			expect(() => timeframeToMs("m5")).toThrow("Invalid timeframe format");
			expect(() => timeframeToMs("5x")).toThrow("Invalid timeframe format");
			expect(() => timeframeToMs("abc")).toThrow("Invalid timeframe format");
		});

		it("should throw on zero or negative periods", () => {
			expect(() => timeframeToMs("0m")).toThrow(
				"period must be positive, got 0"
			);
			expect(() => timeframeToMs("-5m")).toThrow("Invalid timeframe format");
		});

		it("should throw on non-string input", () => {
			expect(() => timeframeToMs(null as any)).toThrow(
				"expected string, got object"
			);
			expect(() => timeframeToMs(123 as any)).toThrow(
				"expected string, got number"
			);
		});
	});

	describe("parseTimeframe", () => {
		it("should parse and return structured format", () => {
			expect(parseTimeframe("5m")).toEqual({
				unit: "m",
				n: 5,
				ms: 300_000,
			});
			expect(parseTimeframe("1h")).toEqual({
				unit: "h",
				n: 1,
				ms: 3_600_000,
			});
			expect(parseTimeframe("7d")).toEqual({
				unit: "d",
				n: 7,
				ms: 604_800_000,
			});
		});

		it("should throw on invalid format", () => {
			expect(() => parseTimeframe("invalid")).toThrow(
				"Invalid timeframe format"
			);
		});
	});

	describe("bucketTimestamp", () => {
		it("should bucket to 1-minute boundaries", () => {
			const tfMs = 60_000; // 1m
			expect(bucketTimestamp(1735690260000, tfMs)).toBe(1735690260000); // Already aligned
			expect(bucketTimestamp(1735690261234, tfMs)).toBe(1735690260000); // Round down
			expect(bucketTimestamp(1735690319999, tfMs)).toBe(1735690260000); // Just before next
		});

		it("should bucket to 5-minute boundaries", () => {
			const tfMs = 300_000; // 5m
			expect(bucketTimestamp(1735690200000, tfMs)).toBe(1735690200000); // Aligned
			expect(bucketTimestamp(1735690261234, tfMs)).toBe(1735690200000);
			expect(bucketTimestamp(1735690499999, tfMs)).toBe(1735690200000);
		});

		it("should bucket to 15-minute boundaries", () => {
			const tfMs = 900_000; // 15m
			// Use a timestamp that is actually aligned to 15min boundary
			const alignedTs = 1735689900000;
			const bucketedAligned = Math.floor(alignedTs / tfMs) * tfMs;
			expect(bucketTimestamp(alignedTs, tfMs)).toBe(bucketedAligned);
			expect(bucketTimestamp(1735690261234, tfMs)).toBe(bucketedAligned);
		});

		it("should bucket to 1-hour boundaries", () => {
			const tfMs = 3_600_000; // 1h
			expect(bucketTimestamp(1735689600000, tfMs)).toBe(1735689600000); // Aligned
			expect(bucketTimestamp(1735690261234, tfMs)).toBe(1735689600000);
			expect(bucketTimestamp(1735693199999, tfMs)).toBe(1735689600000);
		});

		it("should handle epoch start", () => {
			expect(bucketTimestamp(0, 60_000)).toBe(0);
			expect(bucketTimestamp(1, 60_000)).toBe(0);
		});

		it("should throw on invalid timestamp", () => {
			expect(() => bucketTimestamp(-1, 60_000)).toThrow("Invalid timestamp");
			expect(() => bucketTimestamp(NaN, 60_000)).toThrow("Invalid timestamp");
			expect(() => bucketTimestamp(Infinity, 60_000)).toThrow(
				"Invalid timestamp"
			);
		});

		it("should throw on invalid timeframe ms", () => {
			expect(() => bucketTimestamp(1735690261234, 0)).toThrow(
				"Invalid timeframe ms"
			);
			expect(() => bucketTimestamp(1735690261234, -1)).toThrow(
				"Invalid timeframe ms"
			);
			expect(() => bucketTimestamp(1735690261234, NaN)).toThrow(
				"Invalid timeframe ms"
			);
		});
	});

	describe("isBucketAligned", () => {
		it("should return true for aligned timestamps", () => {
			expect(isBucketAligned(1735690260000, 60_000)).toBe(true);
			expect(isBucketAligned(1735690200000, 300_000)).toBe(true);
			expect(isBucketAligned(1735689600000, 3_600_000)).toBe(true);
			expect(isBucketAligned(0, 60_000)).toBe(true);
		});

		it("should return false for misaligned timestamps", () => {
			expect(isBucketAligned(1735690261234, 60_000)).toBe(false);
			expect(isBucketAligned(1735690261000, 300_000)).toBe(false);
			expect(isBucketAligned(1735690261234, 3_600_000)).toBe(false);
		});

		it("should handle edge cases", () => {
			expect(isBucketAligned(59_999, 60_000)).toBe(false);
			expect(isBucketAligned(60_000, 60_000)).toBe(true);
			expect(isBucketAligned(60_001, 60_000)).toBe(false);
		});
	});

	describe("assertBucketAligned", () => {
		it("should not throw for aligned timestamps", () => {
			expect(() => assertBucketAligned(1735690260000, 60_000)).not.toThrow();
			expect(() =>
				assertBucketAligned(1735690200000, 300_000, "test context")
			).not.toThrow();
		});

		it("should throw for misaligned timestamps", () => {
			expect(() => assertBucketAligned(1735690261234, 60_000)).toThrow(
				"Timestamp not aligned to timeframe bucket"
			);
		});

		it("should include context in error message", () => {
			expect(() =>
				assertBucketAligned(1735690261234, 60_000, "executionCandle")
			).toThrow("context: executionCandle");
		});

		it("should include timestamp details in error", () => {
			const ts = 1735690261234;
			const tfMs = 60_000;
			const bucketed = 1735690260000;
			const offset = 1234;

			try {
				assertBucketAligned(ts, tfMs, "test");
				throw new Error("Should have thrown");
			} catch (error: any) {
				expect(error.message).toContain(`ts=${ts}`);
				expect(error.message).toContain(`tfMs=${tfMs}`);
				expect(error.message).toContain(`bucketed=${bucketed}`);
				expect(error.message).toContain(`offset=${offset}ms`);
			}
		});
	});
});
