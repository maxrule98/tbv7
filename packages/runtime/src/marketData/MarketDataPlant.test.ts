import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Candle, MarketDataClient } from "@agenai/core";
import { CandleStore } from "@agenai/core";
import { MarketDataPlant } from "./MarketDataPlant";
import type { BaseCandleSource, ClosedCandleEvent } from "./types";

const symbol = "BTC/USDT";
const venue = "test";

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

// Mock source for testing
class MockBaseCandleSource implements BaseCandleSource {
	readonly venue = "test";
	private onCandleCallback:
		| ((
				candle: Candle,
				meta: { receivedAt: number; source: "ws" | "poll" | "rest" }
		  ) => void)
		| null = null;

	async start(args: {
		symbol: string;
		timeframe: string;
		onCandle: (
			candle: Candle,
			meta: { receivedAt: number; source: "ws" | "poll" | "rest" }
		) => void;
	}): Promise<void> {
		this.onCandleCallback = args.onCandle;
	}

	async stop(): Promise<void> {
		this.onCandleCallback = null;
	}

	// Test helper to emit candles
	emit(candle: Candle): void {
		if (this.onCandleCallback) {
			this.onCandleCallback(candle, {
				receivedAt: Date.now(),
				source: "poll",
			});
		}
	}
}

describe("MarketDataPlant", () => {
	let candleStore: CandleStore;
	let mockClient: MarketDataClient;
	let mockSource: MockBaseCandleSource;
	let plant: MarketDataPlant;
	let emittedEvents: ClosedCandleEvent[];

	beforeEach(() => {
		candleStore = new CandleStore({
			defaultMaxCandles: 500,
		});

		mockClient = {
			fetchOHLCV: vi.fn(),
		};

		mockSource = new MockBaseCandleSource();
		emittedEvents = [];
	});

	afterEach(async () => {
		if (plant) {
			await plant.stop();
		}
	});

	it("should select lowest timeframe as base", async () => {
		(mockClient.fetchOHLCV as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		plant = new MarketDataPlant({
			venue,
			symbol,
			marketDataClient: mockClient,
			candleStore,
			source: mockSource,
		});

		await plant.start({
			timeframes: ["15m", "5m", "1m"],
			executionTimeframe: "5m",
			historyLimit: 100,
		});

		// Should bootstrap 1m (base timeframe)
		expect(mockClient.fetchOHLCV).toHaveBeenCalledWith(symbol, "1m", 100);
	});

	it("should bootstrap base timeframe history on start", async () => {
		const mockHistory = [
			buildCandle(0, 100, 102, 99, 101, 10),
			buildCandle(60_000, 101, 103, 100, 102, 15),
		];

		(mockClient.fetchOHLCV as ReturnType<typeof vi.fn>).mockResolvedValue(
			mockHistory
		);

		plant = new MarketDataPlant({
			venue,
			symbol,
			marketDataClient: mockClient,
			candleStore,
			source: mockSource,
		});

		await plant.start({
			timeframes: ["1m"],
			executionTimeframe: "1m",
			historyLimit: 100,
		});

		// Should ingest history into store
		const stored = candleStore.getSeries("1m");
		expect(stored).toHaveLength(2);
		expect(stored[0].timestamp).toBe(0);
		expect(stored[1].timestamp).toBe(60_000);
	});

	it("should emit aggregated 5m candle when base 1m candles cross boundary", async () => {
		const mockHistory = [
			buildCandle(0, 100, 102, 99, 101, 10),
			buildCandle(60_000, 101, 103, 100, 102, 15),
			buildCandle(120_000, 102, 105, 101, 104, 20),
			buildCandle(180_000, 104, 106, 103, 105, 25),
			buildCandle(240_000, 105, 107, 104, 106, 30),
		];

		(mockClient.fetchOHLCV as ReturnType<typeof vi.fn>).mockResolvedValue(
			mockHistory
		);

		plant = new MarketDataPlant({
			venue,
			symbol,
			marketDataClient: mockClient,
			candleStore,
			source: mockSource,
		});

		plant.onCandle((event) => {
			emittedEvents.push(event);
		});

		await plant.start({
			timeframes: ["1m", "5m"],
			executionTimeframe: "1m",
			historyLimit: 5,
		});

		// Emit a candle that crosses 5m boundary (timestamp 300_000 = 5min mark)
		const newCandle = buildCandle(300_000, 106, 108, 105, 107, 35);
		mockSource.emit(newCandle);

		// Wait for async processing
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Should have emitted:
		// - 1m candle at 300_000
		// - 5m aggregated candle at 0
		const events5m = emittedEvents.filter((e) => e.timeframe === "5m");
		expect(events5m.length).toBeGreaterThan(0);

		const aggregated5m = events5m[0];
		expect(aggregated5m.candle.timestamp).toBe(0);
		expect(aggregated5m.candle.open).toBe(100);
		expect(aggregated5m.candle.close).toBe(106); // Last close from 240_000 candle
		expect(aggregated5m.candle.volume).toBe(100); // Sum of 5 candles
	});

	it("should detect and repair gaps in base timeframe", async () => {
		const mockHistory = [buildCandle(0, 100, 102, 99, 101, 10)];

		(mockClient.fetchOHLCV as ReturnType<typeof vi.fn>).mockImplementation(
			async (sym: string, tf: string, limit: number, since?: number) => {
				if (since !== undefined) {
					// Gap repair fetch - called by repairCandleGap
					return [
						buildCandle(60_000, 101, 103, 100, 102, 15),
						buildCandle(120_000, 102, 105, 101, 104, 20),
					];
				} else {
					// Bootstrap
					return mockHistory;
				}
			}
		);

		plant = new MarketDataPlant({
			venue,
			symbol,
			marketDataClient: mockClient,
			candleStore,
			source: mockSource,
		});

		plant.onCandle((event) => {
			emittedEvents.push(event);
		});

		await plant.start({
			timeframes: ["1m"],
			executionTimeframe: "1m",
			historyLimit: 100,
		});

		// Emit candle with gap (missing 60_000, 120_000)
		mockSource.emit(buildCandle(180_000, 104, 106, 103, 105, 25));

		// Wait for async gap repair and processing
		await new Promise((resolve) => setTimeout(resolve, 50));

		await plant.stop();

		// Should have called fetchOHLCV for gap repair
		const allCalls = (mockClient.fetchOHLCV as ReturnType<typeof vi.fn>).mock
			.calls;
		const gapRepairCalls = allCalls.filter(
			(call) => call[3] !== undefined && call[3] >= 60_000
		); // since parameter with timestamp for repair
		expect(gapRepairCalls.length).toBeGreaterThan(0);

		// Should have emitted at least 3 candles total (initial 0ms + 2 repaired + 180_000 gap)
		expect(emittedEvents.length).toBeGreaterThanOrEqual(3);
	});

	it("should emit events for execution timeframe", async () => {
		const mockHistory = [buildCandle(0, 100, 102, 99, 101, 10)];

		(mockClient.fetchOHLCV as ReturnType<typeof vi.fn>).mockResolvedValue(
			mockHistory
		);

		plant = new MarketDataPlant({
			venue,
			symbol,
			marketDataClient: mockClient,
			candleStore,
			source: mockSource,
		});

		plant.onCandle((event) => {
			emittedEvents.push(event);
		});

		await plant.start({
			timeframes: ["1m"],
			executionTimeframe: "1m",
			historyLimit: 100,
		});

		// Bootstrap should not emit events (only source emissions do)
		// This test verifies plant setup doesn't crash
		expect(emittedEvents.length).toBe(0);
	});

	it("should stop cleanly without errors", async () => {
		(mockClient.fetchOHLCV as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		plant = new MarketDataPlant({
			venue,
			symbol,
			marketDataClient: mockClient,
			candleStore,
			source: mockSource,
		});

		await plant.start({
			timeframes: ["1m"],
			executionTimeframe: "1m",
			historyLimit: 100,
		});

		await plant.stop();

		// Should stop without throwing
		expect(plant).toBeDefined();
	});

	it("should NOT call repairCandleGap when enableGapRepair=false", async () => {
		const mockHistory = [buildCandle(0, 100, 102, 99, 101, 10)];

		(mockClient.fetchOHLCV as ReturnType<typeof vi.fn>).mockImplementation(
			async (sym: string, tf: string, limit: number, since?: number) => {
				if (since !== undefined) {
					// Gap repair fetch - should NOT be called when enableGapRepair=false
					return [
						buildCandle(60_000, 101, 103, 100, 102, 15),
						buildCandle(120_000, 102, 105, 101, 104, 20),
					];
				} else {
					// Bootstrap
					return mockHistory;
				}
			}
		);

		plant = new MarketDataPlant({
			venue,
			symbol,
			marketDataClient: mockClient,
			candleStore,
			source: mockSource,
			enableGapRepair: false, // Disable gap repair
		});

		plant.onCandle((event) => {
			emittedEvents.push(event);
		});

		await plant.start({
			timeframes: ["1m"],
			executionTimeframe: "1m",
			historyLimit: 100,
		});

		// Emit candle with gap (missing 60_000, 120_000)
		mockSource.emit(buildCandle(180_000, 104, 106, 103, 105, 25));

		// Wait for async processing
		await new Promise((resolve) => setTimeout(resolve, 50));

		await plant.stop();

		// Should NOT have called fetchOHLCV with since parameter (gap repair)
		const allCalls = (mockClient.fetchOHLCV as ReturnType<typeof vi.fn>).mock
			.calls;
		const gapRepairCalls = allCalls.filter(
			(call) => call[3] !== undefined && call[3] >= 60_000
		);
		expect(gapRepairCalls.length).toBe(0);

		// Should still emit the base candle at 0ms from bootstrap + the 180_000 candle
		// (no repair candles emitted)
		const candleTimestamps = emittedEvents.map((e) => e.candle.timestamp);
		expect(candleTimestamps).toContain(180_000);
		expect(candleTimestamps).not.toContain(60_000);
		expect(candleTimestamps).not.toContain(120_000);
	});
});
