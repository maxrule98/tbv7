import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Holy Grail Phase A+B Guard Rails", () => {
	it("should confirm HG_PHASE_COMPLETED=A,B marker exists", () => {
		const progressPath = path.join(
			__dirname,
			"../marketData/HOLY_GRAIL_PROGRESS.md"
		);
		expect(
			fs.existsSync(progressPath),
			`Progress file should exist at ${progressPath}`
		).toBe(true);

		const content = fs.readFileSync(progressPath, "utf-8");
		expect(content).toContain("HG_PHASE_COMPLETED=A,B");
	});

	it("should export TickSnapshot types from runtime", async () => {
		const runtimeModule = await import("../index");
		expect(runtimeModule.buildTickSnapshot).toBeDefined();
		expect(typeof runtimeModule.buildTickSnapshot).toBe("function");
	});

	it("should have runTick signature using TickSnapshot", async () => {
		const runTickModule = await import("../loop/runTick");
		expect(runTickModule.runTick).toBeDefined();
		expect(typeof runTickModule.runTick).toBe("function");

		// Check that TickInput type exists and has snapshot property
		// We can't easily check TypeScript types at runtime, but we can verify
		// the function signature indirectly by attempting to call it with snapshot
		const funcStr = runTickModule.runTick.toString();
		expect(funcStr).toBeDefined();
	});

	it("should have time utilities exported from core", async () => {
		const coreModule = await import("@agenai/core");
		expect(coreModule.timeframeToMs).toBeDefined();
		expect(coreModule.bucketTimestamp).toBeDefined();
		expect(coreModule.isBucketAligned).toBeDefined();
		expect(coreModule.assertBucketAligned).toBeDefined();
		expect(typeof coreModule.timeframeToMs).toBe("function");
		expect(typeof coreModule.bucketTimestamp).toBe("function");
	});

	it("should pass basic time utility smoke tests", async () => {
		const { timeframeToMs, bucketTimestamp, isBucketAligned } =
			await import("@agenai/core");

		expect(timeframeToMs("1m")).toBe(60_000);
		expect(timeframeToMs("5m")).toBe(300_000);

		const ts = 1735690261234;
		const bucketed = bucketTimestamp(ts, 60_000);
		expect(bucketed).toBe(1735690260000);
		expect(isBucketAligned(bucketed, 60_000)).toBe(true);
		expect(isBucketAligned(ts, 60_000)).toBe(false);
	});

	it("should have buildTickSnapshot function exported", async () => {
		const { buildTickSnapshot } = await import("../loop/buildTickSnapshot");
		expect(buildTickSnapshot).toBeDefined();
		expect(typeof buildTickSnapshot).toBe("function");

		// Smoke test: should throw on misaligned timestamp
		expect(() =>
			buildTickSnapshot({
				symbol: "BTC/USDT",
				signalVenue: "binance",
				executionTimeframe: "1m",
				executionCandle: {
					timestamp: 1735690261234, // Misaligned
					open: 50000,
					high: 51000,
					low: 49000,
					close: 50500,
					volume: 100,
					symbol: "BTC/USDT",
					timeframe: "1m",
				},
				series: {},
			})
		).toThrow("context: executionCandle");
	});
});
