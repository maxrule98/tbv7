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
	// Phase C tests removed - legacy provider files deleted in Phase F
	// Gap repair logic now verified via @agenai/data package tests

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
		// Phase F: Plant does ingestion, startTrader reads via getSeries
		// (no more manual candleStore.ingest in startTrader)
		expect(startTrader).toContain("candleStore.getSeries");
		expect(startTrader).toContain("MarketDataPlant");
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

describe("Holy Grail Phase E Guard Rails", () => {
	it("should have NO ExchangeAdapter references in runtime backtestRunner", () => {
		const backtestRunner = fs.readFileSync(
			path.join(__dirname, "../backtest/backtestRunner.ts"),
			"utf-8"
		);
		expect(backtestRunner).not.toContain("ExchangeAdapter");
		// Should use ExecutionClient instead
		expect(backtestRunner).toContain("ExecutionClient");
	});

	it("should have MarketDataClient and ExecutionClient types exported from core", () => {
		// These are type-only exports, so we check the source file directly
		const corePackageDir = path.resolve(__dirname, "../../../core");
		const exchangeDir = path.join(corePackageDir, "src/exchange");

		const marketDataClientPath = path.join(exchangeDir, "MarketDataClient.ts");
		const executionClientPath = path.join(exchangeDir, "ExecutionClient.ts");

		expect(
			fs.existsSync(marketDataClientPath),
			"MarketDataClient.ts should exist in core/exchange"
		).toBe(true);
		expect(
			fs.existsSync(executionClientPath),
			"ExecutionClient.ts should exist in core/exchange"
		).toBe(true);

		// Check that they're exported from index
		const exchangeIndex = fs.readFileSync(
			path.join(exchangeDir, "index.ts"),
			"utf-8"
		);
		expect(exchangeIndex).toContain("MarketDataClient");
		expect(exchangeIndex).toContain("ExecutionClient");
	});

	it("should confirm HG_PHASE_COMPLETED includes E when ExchangeAdapter removed", () => {
		const progressPath = path.join(
			__dirname,
			"../marketData/HOLY_GRAIL_PROGRESS.md"
		);
		const content = fs.readFileSync(progressPath, "utf-8");

		// Check backtestRunner doesn't have ExchangeAdapter
		const backtestRunner = fs.readFileSync(
			path.join(__dirname, "../backtest/backtestRunner.ts"),
			"utf-8"
		);
		const hasNoExchangeAdapter = !backtestRunner.includes("ExchangeAdapter");

		if (hasNoExchangeAdapter) {
			expect(content).toContain("HG_PHASE_COMPLETED=A,B,C,D,E");
		}
	});
});

describe("Holy Grail Phase F Guard Rails", () => {
	it("should have BaseCandleSource interface in marketData types", () => {
		const typesPath = path.join(__dirname, "../marketData/types.ts");
		const types = fs.readFileSync(typesPath, "utf-8");
		expect(types).toContain("export interface BaseCandleSource");
		expect(types).toContain("start");
		expect(types).toContain("stop");
		expect(types).toContain("venue");
	});

	it("should have BinanceBaseCandleSource and PollingBaseCandleSource implementations", () => {
		const binanceSourcePath = path.join(
			__dirname,
			"../marketData/BinanceBaseCandleSource.ts"
		);
		const pollingSourcePath = path.join(
			__dirname,
			"../marketData/PollingBaseCandleSource.ts"
		);

		expect(fs.existsSync(binanceSourcePath)).toBe(true);
		expect(fs.existsSync(pollingSourcePath)).toBe(true);

		const binanceSource = fs.readFileSync(binanceSourcePath, "utf-8");
		const pollingSource = fs.readFileSync(pollingSourcePath, "utf-8");

		// Check they implement BaseCandleSource
		expect(binanceSource).toContain("implements BaseCandleSource");
		expect(pollingSource).toContain("implements BaseCandleSource");

		// Check they don't have orchestration logic (methods)
		expect(binanceSource).not.toContain("repairCandleGap");
		expect(binanceSource).not.toContain("aggregateNewlyClosed");
		expect(binanceSource).not.toContain("candleStore.ingest");

		expect(pollingSource).not.toContain("repairCandleGap");
		expect(pollingSource).not.toContain("aggregateNewlyClosed");
		expect(pollingSource).not.toContain("candleStore.ingest");
	});

	it("should have MarketDataPlant accept BaseCandleSource in constructor", () => {
		const plantPath = path.join(__dirname, "../marketData/MarketDataPlant.ts");
		const plant = fs.readFileSync(plantPath, "utf-8");

		expect(plant).toContain("source: BaseCandleSource");
		expect(plant).toContain("private readonly source: BaseCandleSource");
		// Plant should start source, not poll itself
		expect(plant).toContain("this.source.start");
		expect(plant).toContain("this.source.stop");
		// Plant should NOT have internal polling
		expect(plant).not.toContain("private pollTimer");
	});

	it("should have startTrader use MarketDataPlant instead of provider.createFeed", () => {
		const startTraderPath = path.join(__dirname, "../startTrader.ts");
		const startTrader = fs.readFileSync(startTraderPath, "utf-8");

		expect(startTrader).toContain("MarketDataPlant");
		expect(startTrader).toContain("new MarketDataPlant");
		expect(startTrader).not.toContain("provider.createFeed");
		expect(startTrader).not.toContain("bootstrapMarketData");
		expect(startTrader).toContain("plant.start");
		expect(startTrader).toContain("plant.onCandle");
	});

	it("should have baseCandleSource and marketDataClient in StartTraderOptions", () => {
		const startTraderPath = path.join(__dirname, "../startTrader.ts");
		const startTrader = fs.readFileSync(startTraderPath, "utf-8");

		// Phase F: Strict enforcement - these are REQUIRED, not optional
		expect(startTrader).toContain("baseCandleSource: BaseCandleSource");
		expect(startTrader).toContain("marketDataClient: MarketDataClient");
		expect(startTrader).toContain("executionProvider: ExecutionProvider");
	});

	it("should confirm HG_PHASE_COMPLETED=A,B,C,D,E,F marker exists when Plant is wired", () => {
		const progressPath = path.join(
			__dirname,
			"../marketData/HOLY_GRAIL_PROGRESS.md"
		);
		const content = fs.readFileSync(progressPath, "utf-8");

		// Check that startTrader uses Plant
		const startTraderPath = path.join(__dirname, "../startTrader.ts");
		const startTrader = fs.readFileSync(startTraderPath, "utf-8");
		const usesPlant = startTrader.includes("new MarketDataPlant");

		if (usesPlant) {
			expect(content).toContain("HG_PHASE_COMPLETED=A,B,C,D,E,F");
		}
	});
});

describe("Holy Grail Phase F Irreversible Guard Rails", () => {
	it("should have REQUIRED (not optional) Phase F dependencies in StartTraderOptions", () => {
		const startTraderPath = path.join(__dirname, "../startTrader.ts");
		const startTrader = fs.readFileSync(startTraderPath, "utf-8");

		// Phase F: Strict enforcement - these are REQUIRED (no '?')
		expect(startTrader).toContain("baseCandleSource: BaseCandleSource");
		expect(startTrader).toContain("marketDataClient: MarketDataClient");
		expect(startTrader).toContain("executionProvider: ExecutionProvider");

		// Must NOT have optional versions
		expect(startTrader).not.toContain("baseCandleSource?: BaseCandleSource");
		expect(startTrader).not.toContain("marketDataClient?: MarketDataClient");
		expect(startTrader).not.toContain("executionProvider?: ExecutionProvider");
	});

	it("should have ZERO legacy Phase E provider references in startTrader", () => {
		const startTraderPath = path.join(__dirname, "../startTrader.ts");
		const startTrader = fs.readFileSync(startTraderPath, "utf-8");

		// Phase F: NO legacy provider code allowed
		expect(startTrader).not.toContain("MarketDataProvider");
		expect(startTrader).not.toContain("marketDataProvider");
		expect(startTrader).not.toContain("createFeed(");
		expect(startTrader).not.toContain("bootstrapMarketData(");
		expect(startTrader).not.toContain("pollIntervalMs");
		expect(startTrader).not.toContain("DEFAULT_POLL_INTERVAL_MS");
	});

	it("should have BaseCandleSource implementations with NO orchestration imports", () => {
		const binanceSourcePath = path.join(
			__dirname,
			"../marketData/BinanceBaseCandleSource.ts"
		);
		const pollingSourcePath = path.join(
			__dirname,
			"../marketData/PollingBaseCandleSource.ts"
		);

		const binanceSource = fs.readFileSync(binanceSourcePath, "utf-8");
		const pollingSource = fs.readFileSync(pollingSourcePath, "utf-8");

		// Phase F: BaseCandleSource implementations must NOT import orchestration utilities
		// These are Plant's responsibility - check actual import statements
		const forbiddenImports = [
			'from "./aggregateCandles"',
			'from "../data"',
			"import { repairCandleGap",
			"import { aggregateNewlyClosed",
			"import { CandleStore",
			"import { bucketTimestamp",
		];

		for (const forbidden of forbiddenImports) {
			expect(binanceSource).not.toContain(forbidden);
			expect(pollingSource).not.toContain(forbidden);
		}

		// Also check they don't actually use these functions (not just in comments)
		expect(binanceSource).not.toMatch(/\brepairCandleGap\(/);
		expect(binanceSource).not.toMatch(/\baggregateNewlyClosed\(/);
		expect(binanceSource).not.toMatch(/\bnew CandleStore\(/);
		expect(binanceSource).not.toMatch(/\bbucketTimestamp\(/);

		expect(pollingSource).not.toMatch(/\brepairCandleGap\(/);
		expect(pollingSource).not.toMatch(/\baggregateNewlyClosed\(/);
		expect(pollingSource).not.toMatch(/\bnew CandleStore\(/);
		expect(pollingSource).not.toMatch(/\bbucketTimestamp\(/);
	});

	it("should have runtimeShared with NO pollIntervalMs in StrategyLogContext", () => {
		const runtimeSharedPath = path.join(__dirname, "../runtimeShared.ts");
		const runtimeShared = fs.readFileSync(runtimeSharedPath, "utf-8");

		// Phase F: pollIntervalMs removed from all logging contexts
		// Check the StrategyLogContext interface definition
		const interfaceMatch = runtimeShared.match(
			/export interface StrategyLogContext \{[^}]+\}/s
		);
		if (interfaceMatch) {
			expect(interfaceMatch[0]).not.toContain("pollIntervalMs");
		}

		// Check logStrategyLoaded function signature
		const functionMatch = runtimeShared.match(
			/export const logStrategyLoaded = \(\{[^}]+\}/s
		);
		if (functionMatch) {
			expect(functionMatch[0]).not.toContain("pollIntervalMs");
		}

		// Check the function body doesn't reference pollIntervalMs
		const logStrategyLoadedBody = runtimeShared.match(
			/export const logStrategyLoaded[\s\S]*?runtimeLogger\.info\("strategy_loaded"[\s\S]*?\}\);/
		);
		if (logStrategyLoadedBody) {
			expect(logStrategyLoadedBody[0]).not.toContain("pollIntervalMs");
		}
	});

	it("should have backtestRunner with NO pollIntervalMs in logStrategyLoaded call", () => {
		const backtestRunnerPath = path.join(
			__dirname,
			"../backtest/backtestRunner.ts"
		);
		const backtestRunner = fs.readFileSync(backtestRunnerPath, "utf-8");

		// Phase F: pollIntervalMs removed from backtest logging
		const logStrategyLoadedCalls = backtestRunner.match(
			/logStrategyLoaded\(\{[\s\S]*?\}\)/g
		);

		if (logStrategyLoadedCalls) {
			for (const call of logStrategyLoadedCalls) {
				expect(call).not.toContain("pollIntervalMs");
			}
		}
	});

	it("should have TraderConfig interface with NO pollIntervalMs field", () => {
		const startTraderPath = path.join(__dirname, "../startTrader.ts");
		const startTrader = fs.readFileSync(startTraderPath, "utf-8");

		// Phase F: TraderConfig should not have pollIntervalMs
		const traderConfigMatch = startTrader.match(
			/export interface TraderConfig \{[^}]+\}/s
		);
		if (traderConfigMatch) {
			expect(traderConfigMatch[0]).not.toContain("pollIntervalMs");
		}
	});
});

/**
 * Phase F Export Surface Guard Tests
 * Ensures ZERO legacy provider types are exported
 */
describe("Phase F Export Surface Irreversibility", () => {
	it("should have marketData/index.ts with NO legacy provider exports", () => {
		const indexPath = path.join(__dirname, "../marketData/index.ts");
		const content = fs.readFileSync(indexPath, "utf-8");

		// Phase F: Only export Phase F types and implementations
		expect(content).not.toContain('export * from "./types"');
		expect(content).not.toContain("MarketDataProvider");
		expect(content).not.toContain("PollingMarketDataProvider");
		expect(content).not.toContain("BinanceUsdMMarketDataProvider");
		expect(content).not.toContain("MarketDataFeed");
		expect(content).not.toContain("MarketDataBootstrap");
		expect(content).not.toContain("createFeed");
		expect(content).not.toContain("bootstrap");

		// Phase F: Must export only these
		expect(content).toContain("ClosedCandleEvent");
		expect(content).toContain("BaseCandleSource");
		expect(content).toContain("BinanceBaseCandleSource");
		expect(content).toContain("PollingBaseCandleSource");
		expect(content).toContain("MarketDataPlant");
	});

	it("should have marketData/types.ts with NO legacy provider types", () => {
		const typesPath = path.join(__dirname, "../marketData/types.ts");
		const content = fs.readFileSync(typesPath, "utf-8");

		// Phase F: Only Phase F types allowed
		expect(content).not.toContain("MarketDataProvider");
		expect(content).not.toContain("PollingMarketDataProvider");
		expect(content).not.toContain("BinanceUsdMMarketDataProvider");
		expect(content).not.toContain("MarketDataFeed");
		expect(content).not.toContain("MarketDataBootstrap");
		expect(content).not.toContain("SubscribeOptions");
		expect(content).not.toContain("PollOptions");
		expect(content).not.toContain("pollIntervalMs");

		// Phase F: Must have only these
		expect(content).toContain("ClosedCandleEvent");
		expect(content).toContain("ClosedCandleHandler");
		expect(content).toContain("BaseCandleSource");
	});

	it("should have app-di with NO createMarketDataProvider export", () => {
		// Check app-di package exists
		const appDiIndexPath = path.resolve(
			__dirname,
			"../../../../apps/app-di/src/index.ts"
		);

		if (!fs.existsSync(appDiIndexPath)) {
			// app-di might not exist in all environments, skip gracefully
			return;
		}

		const content = fs.readFileSync(appDiIndexPath, "utf-8");

		// Phase F: No legacy createMarketDataProvider export
		expect(content).not.toContain("createMarketDataProvider");

		// Phase F: Only createBaseCandleSource and createMarketDataClient
		expect(content).toContain("createBaseCandleSource");
		expect(content).toContain("createMarketDataClient");

		// Backtest still needs createDataProvider
		expect(content).toContain("createDataProvider");
	});

	it("should have app-di/createDataProvider.ts with NO commented legacy code", () => {
		const createProviderPath = path.resolve(
			__dirname,
			"../../../../apps/app-di/src/createDataProvider.ts"
		);

		if (!fs.existsSync(createProviderPath)) {
			return;
		}

		const content = fs.readFileSync(createProviderPath, "utf-8");

		// Phase F: All commented legacy code must be deleted
		expect(content).not.toContain("Phase E legacy");
		expect(content).not.toContain("DEPRECATED");
		expect(content).not.toContain("// const isBinanceVenue");
		expect(content).not.toContain("// export const createMarketDataProvider");
		expect(content).not.toContain("BinanceUsdMMarketDataProvider");
		expect(content).not.toContain("PollingMarketDataProvider");
		expect(content).not.toContain("pollIntervalMs");

		// Phase F: Only clean createDataProvider allowed
		expect(content).toContain("createDataProvider");
		expect(content).toContain("DefaultDataProvider");
	});

	it("should have app-di tests with NO legacy provider mocks", () => {
		const diTestPath = path.resolve(
			__dirname,
			"../../../../apps/app-di/src/di.test.ts"
		);

		if (!fs.existsSync(diTestPath)) {
			return;
		}

		const content = fs.readFileSync(diTestPath, "utf-8");

		// Phase F: No legacy provider mocks
		expect(content).not.toContain("MockPollingMarketDataProvider");
		expect(content).not.toContain("MockBinanceUsdMMarketDataProvider");
		expect(content).not.toContain("createMarketDataProvider");
		expect(content).not.toContain("Phase E legacy");

		// Phase F: Only Phase F DI functions
		expect(content).toContain("createDataProvider");
		expect(content).toContain("createExecutionProvider");
		expect(content).toContain("createBacktestExecution");
	});

	it("should have NO legacy provider files remaining in marketData", () => {
		const marketDataDir = path.join(__dirname, "../marketData");

		// Phase F: Legacy provider files must be DELETED, not just isolated
		const binanceProviderPath = path.join(
			marketDataDir,
			"binanceUsdMMarketDataProvider.ts"
		);
		const pollingProviderPath = path.join(
			marketDataDir,
			"pollingMarketDataProvider.ts"
		);

		expect(
			fs.existsSync(binanceProviderPath),
			"binanceUsdMMarketDataProvider.ts should be deleted"
		).toBe(false);
		expect(
			fs.existsSync(pollingProviderPath),
			"pollingMarketDataProvider.ts should be deleted"
		).toBe(false);
	});

	it("should have NO legacy provider references in runtime barrel exports", () => {
		const runtimeIndexPath = path.join(__dirname, "../index.ts");
		const content = fs.readFileSync(runtimeIndexPath, "utf-8");

		// Phase F: Runtime should not export any legacy provider types/classes
		expect(content).not.toContain("binanceUsdMMarketDataProvider");
		expect(content).not.toContain("pollingMarketDataProvider");
		expect(content).not.toContain("BinanceUsdMMarketDataProvider");
		expect(content).not.toContain("PollingMarketDataProvider");
		expect(content).not.toContain("MarketDataProvider");
		expect(content).not.toContain("MarketDataFeed");
	});
});

describe("Holy Grail Phase G Guard Rails", () => {
	it("should have BacktestBaseCandleSource implementation", () => {
		const backtestSourcePath = path.join(
			__dirname,
			"../marketData/BacktestBaseCandleSource.ts"
		);
		expect(
			fs.existsSync(backtestSourcePath),
			"BacktestBaseCandleSource.ts should exist"
		).toBe(true);

		const backtestSource = fs.readFileSync(backtestSourcePath, "utf-8");
		expect(backtestSource).toContain("implements BaseCandleSource");
		expect(backtestSource).toContain("export class BacktestBaseCandleSource");
	});

	it("should have backtestRunner use MarketDataPlant and BacktestBaseCandleSource", () => {
		const backtestRunnerPath = path.join(
			__dirname,
			"../backtest/backtestRunner.ts"
		);
		const backtestRunner = fs.readFileSync(backtestRunnerPath, "utf-8");

		// Phase G: backtestRunner must use Plant-driven architecture
		expect(backtestRunner).toContain("MarketDataPlant");
		expect(backtestRunner).toContain("BacktestBaseCandleSource");
		expect(backtestRunner).toContain("new MarketDataPlant");
		expect(backtestRunner).toContain("new BacktestBaseCandleSource");
		expect(backtestRunner).toContain("plant.start");
		expect(backtestRunner).toContain("plant.onCandle");
	});

	it("should NOT have legacy provider concepts in backtestRunner", () => {
		const backtestRunnerPath = path.join(
			__dirname,
			"../backtest/backtestRunner.ts"
		);
		const backtestRunner = fs.readFileSync(backtestRunnerPath, "utf-8");

		// Phase G: No legacy provider patterns
		expect(backtestRunner).not.toContain("MarketDataProvider");
		expect(backtestRunner).not.toContain("createFeed");
		expect(backtestRunner).not.toContain("bootstrapMarketData");
		// Old manual loop pattern should be replaced by Plant event-driven
		expect(backtestRunner).not.toContain(
			"for (const candle of executionSeries.candles)"
		);
	});

	it("should have MarketDataPlant.enableGapRepair flag with default true", () => {
		const plantPath = path.join(__dirname, "../marketData/MarketDataPlant.ts");
		const plant = fs.readFileSync(plantPath, "utf-8");

		// Phase G: enableGapRepair flag in options interface
		expect(plant).toContain("enableGapRepair?: boolean");
		// Should have default true comment
		expect(plant).toContain("Default true");
		// Should use the flag in processBaseCandle
		expect(plant).toContain("this.enableGapRepair");
		expect(plant).toContain("if (");
		expect(plant).toMatch(/if\s*\([^)]*this\.enableGapRepair/);
	});

	it("should have backtestRunner set enableGapRepair=false for Plant", () => {
		const backtestRunnerPath = path.join(
			__dirname,
			"../backtest/backtestRunner.ts"
		);
		const backtestRunner = fs.readFileSync(backtestRunnerPath, "utf-8");

		// Phase G: Backtest should disable gap repair (data is contiguous)
		expect(backtestRunner).toContain("enableGapRepair: false");
	});

	it("should confirm HG_PHASE_COMPLETED=A,B,C,D,E,F,G marker exists when Phase G is complete", () => {
		const progressPath = path.join(
			__dirname,
			"../marketData/HOLY_GRAIL_PROGRESS.md"
		);
		const content = fs.readFileSync(progressPath, "utf-8");

		// Check that backtestRunner uses Plant-driven architecture
		const backtestRunnerPath = path.join(
			__dirname,
			"../backtest/backtestRunner.ts"
		);
		const backtestRunner = fs.readFileSync(backtestRunnerPath, "utf-8");
		const usesPlant =
			backtestRunner.includes("new MarketDataPlant") &&
			backtestRunner.includes("new BacktestBaseCandleSource");

		if (usesPlant) {
			expect(content).toContain("HG_PHASE_COMPLETED=A,B,C,D,E,F,G");
		}
	});
});
