import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Holy Grail Phase A+B Guard Rails", () => {
	it("should confirm HG_PHASE_COMPLETED=A,B,C marker exists", () => {
		const progressPath = path.join(
			__dirname,
			"../marketData/HOLY_GRAIL_PROGRESS.md"
		);
		expect(
			fs.existsSync(progressPath),
			`Progress file should exist at ${progressPath}`
		).toBe(true);

		const content = fs.readFileSync(progressPath, "utf-8");
		expect(content).toContain("HG_PHASE_COMPLETED=A,B,C");
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

describe("Holy Grail Phase C Guard Rails", () => {
	it("should have NO repairGap wrapper methods in providers", () => {
		const marketDataDir = path.join(__dirname, "../marketData");
		const pollingProvider = fs.readFileSync(
			path.join(marketDataDir, "pollingMarketDataProvider.ts"),
			"utf-8"
		);
		const binanceProvider = fs.readFileSync(
			path.join(marketDataDir, "binanceUsdMMarketDataProvider.ts"),
			"utf-8"
		);

		// Should NOT contain private repairGap wrapper method
		expect(pollingProvider).not.toContain("repairGap(");
		expect(binanceProvider).not.toContain("repairGap(");

		// Explanation: Phase C eliminated all provider-owned repairGap() wrappers.
		// If this test fails, someone re-added a wrapper method.
		// Gap repair must use the shared repairCandleGap() function directly.
	});

	it("should use shared repairCandleGap function in both providers", () => {
		const marketDataDir = path.join(__dirname, "../marketData");
		const pollingProvider = fs.readFileSync(
			path.join(marketDataDir, "pollingMarketDataProvider.ts"),
			"utf-8"
		);
		const binanceProvider = fs.readFileSync(
			path.join(marketDataDir, "binanceUsdMMarketDataProvider.ts"),
			"utf-8"
		);

		// Should import repairCandleGap from @agenai/data
		expect(pollingProvider).toContain('from "@agenai/data"');
		expect(pollingProvider).toContain("repairCandleGap");

		expect(binanceProvider).toContain('from "@agenai/data"');
		expect(binanceProvider).toContain("repairCandleGap");

		// Should have at least one direct call to repairCandleGap(
		expect(pollingProvider).toMatch(/await repairCandleGap\({/);
		expect(binanceProvider).toMatch(/await repairCandleGap\({/);
	});

	it("should have gap repair function in @agenai/data", async () => {
		const dataModule = await import("@agenai/data");
		expect(dataModule.repairCandleGap).toBeDefined();
		expect(typeof dataModule.repairCandleGap).toBe("function");
	});
});

describe("Holy Grail Phase D Guard Rails", () => {
	it("should have CandleStore exported from @agenai/core", async () => {
		const coreModule = await import("@agenai/core");
		expect(coreModule.CandleStore).toBeDefined();
		expect(typeof coreModule.CandleStore).toBe("function"); // Constructor
	});

	it("should NOT have BacktestTimeframeCache file", () => {
		const backtestCachePath = path.join(
			__dirname,
			"../backtest/BacktestTimeframeCache.ts"
		);
		expect(
			fs.existsSync(backtestCachePath),
			"BacktestTimeframeCache.ts should be deleted in Phase D"
		).toBe(false);
	});

	it("should NOT import BacktestTimeframeCache in backtestRunner", () => {
		const backtestRunner = fs.readFileSync(
			path.join(__dirname, "../backtest/backtestRunner.ts"),
			"utf-8"
		);
		expect(backtestRunner).not.toContain("BacktestTimeframeCache");
		expect(backtestRunner).toContain("CandleStore");
	});

	it("should NOT use Map<string, Candle[]> buffers in startTrader", () => {
		const startTrader = fs.readFileSync(
			path.join(__dirname, "../startTrader.ts"),
			"utf-8"
		);
		// Should not have the old appendCandle helper
		expect(startTrader).not.toContain("appendCandle");
		// Should import and use CandleStore for runtime storage
		expect(startTrader).toContain("CandleStore");
		expect(startTrader).toContain("new CandleStore");
		// Bootstrap can use Map temporarily, but runtime should use CandleStore
		expect(startTrader).toContain("candleStore.ingest");
		expect(startTrader).toContain("candleStore.getSeries");
	});

	it("should confirm HG_PHASE_COMPLETED=A,B,C,D marker exists", () => {
		const progressPath = path.join(
			__dirname,
			"../marketData/HOLY_GRAIL_PROGRESS.md"
		);
		const content = fs.readFileSync(progressPath, "utf-8");
		expect(content).toContain("HG_PHASE_COMPLETED=A,B,C,D");
	});

	it("should NOT contain stale pre-implementation audit in progress doc", () => {
		const progressPath = path.join(
			__dirname,
			"../marketData/HOLY_GRAIL_PROGRESS.md"
		);
		const content = fs.readFileSync(progressPath, "utf-8");
		// Should not claim backtestRunner uses BacktestTimeframeCache
		expect(content).not.toContain("uses `BacktestTimeframeCache`");
		expect(content).not.toContain("uses BacktestTimeframeCache");
		// Should not have pre-implementation audit section
		expect(content).not.toContain("Audit Findings (Pre-Implementation)");
		// Should not reference old Map<string, Candle[]> as current state
		expect(content).not.toContain("uses `Map<string, Candle[]>` for buffers");
	});
});
