import { describe, it, expect, beforeEach } from "vitest";
import { VWAPFullTraversalStrategy } from "./index";
import { DeltaGammaProvider } from "./deltaProvider";
import type { Candle } from "../../types";
import type { VWAPFullTraversalConfig } from "./config";
import { VWAP_FULL_TRAVERSAL_ID } from "./config";

const createCandle = (
	timestamp: number,
	open: number,
	high: number,
	low: number,
	close: number,
	volume: number = 100
): Candle => ({
	symbol: "BTC/USDT",
	timeframe: "1m",
	timestamp,
	open,
	high,
	low,
	close,
	volume,
});

const createConfig = (): VWAPFullTraversalConfig => ({
	id: VWAP_FULL_TRAVERSAL_ID,
	name: "Test VWAP Full Traversal",
	symbol: "BTC/USDT",
	timeframes: {
		execution: "1m",
	},
	historyWindowCandles: 100,
	warmupPeriods: {
		default: 10,
		"1m": 10,
	},
	cacheTTLms: 1500,
	sdMultiplier: 1.5,
	stopMultiplier: 0.25,
});

const addWarmupCandles = (
	candles: Candle[],
	deltaProvider: DeltaGammaProvider,
	baseTimestamp: number,
	count: number = 10
) => {
	for (let i = -count; i < 0; i++) {
		const ts = baseTimestamp + i * 60_000;
		candles.push(createCandle(ts, 100, 100, 100, 100, 1000));
		deltaProvider.processTrade({
			timestamp: ts,
			price: 100,
			size: 10,
			side: "buy",
		});
		deltaProvider.closeBucket(ts);
	}
};

describe("VWAPFullTraversalStrategy", () => {
	let strategy: VWAPFullTraversalStrategy;
	let deltaProvider: DeltaGammaProvider;
	let candles: Candle[];
	const baseTimestamp = Date.UTC(2024, 0, 1, 0, 0, 0);

	beforeEach(() => {
		candles = [];
		deltaProvider = new DeltaGammaProvider();

		const config = createConfig();
		const deps = {
			cache: {
				getCandles: async () => candles,
			},
			deltaProvider,
		};

		strategy = new VWAPFullTraversalStrategy(config, deps);
	});

	it("should enter LONG after full traversal with positive delta/gamma", async () => {
		// Build scenario: price touches lower, then closes above upper with positive delta/gamma

		// Add warmup candles to establish VWAP baseline
		addWarmupCandles(candles, deltaProvider, baseTimestamp);

		const timestamps = [
			baseTimestamp,
			baseTimestamp + 60_000,
			baseTimestamp + 120_000,
			baseTimestamp + 180_000,
			baseTimestamp + 240_000,
		];

		// Candle 0: baseline at 100
		candles.push(createCandle(timestamps[0], 100, 100, 100, 100, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[0],
			price: 100,
			size: 10,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[0]);

		// Candle 1: drop to 95 (touch lower band)
		candles.push(createCandle(timestamps[1], 100, 100, 95, 96, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[1],
			price: 96,
			size: 5,
			side: "sell",
		});
		deltaProvider.closeBucket(timestamps[1]);

		// Candle 2: recover to 98
		candles.push(createCandle(timestamps[2], 96, 98, 96, 98, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[2],
			price: 98,
			size: 8,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[2]);

		// Candle 3: move to 102 but not above upper yet
		candles.push(createCandle(timestamps[3], 98, 102, 98, 102, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[3],
			price: 102,
			size: 12,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[3]);

		// Candle 4: close above upper with positive delta increasing (gamma > 0)
		candles.push(createCandle(timestamps[4], 102, 107, 102, 107, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[4],
			price: 107,
			size: 15,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[4]);

		const intent = await strategy.decide("FLAT");

		expect(intent.intent).toBe("OPEN_LONG");
		expect(intent.reason).toBe("full_traversal_long");
		expect(intent.metadata).toHaveProperty("stop");
	});

	it("should enter SHORT after full traversal with negative delta/gamma", async () => {
		// Add warmup candles
		addWarmupCandles(candles, deltaProvider, baseTimestamp);
		const timestamps = [
			baseTimestamp,
			baseTimestamp + 60_000,
			baseTimestamp + 120_000,
			baseTimestamp + 180_000,
			baseTimestamp + 240_000,
		];

		// Baseline
		candles.push(createCandle(timestamps[0], 100, 100, 100, 100, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[0],
			price: 100,
			size: 10,
			side: "sell",
		});
		deltaProvider.closeBucket(timestamps[0]);

		// Spike to 105 (touch upper)
		candles.push(createCandle(timestamps[1], 100, 105, 100, 104, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[1],
			price: 104,
			size: 5,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[1]);

		// Pullback to 102
		candles.push(createCandle(timestamps[2], 104, 104, 102, 102, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[2],
			price: 102,
			size: 8,
			side: "sell",
		});
		deltaProvider.closeBucket(timestamps[2]);

		// Move to 98
		candles.push(createCandle(timestamps[3], 102, 102, 98, 98, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[3],
			price: 98,
			size: 12,
			side: "sell",
		});
		deltaProvider.closeBucket(timestamps[3]);

		// Close below lower with negative delta decreasing (gamma < 0)
		candles.push(createCandle(timestamps[4], 98, 98, 93, 93, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[4],
			price: 93,
			size: 15,
			side: "sell",
		});
		deltaProvider.closeBucket(timestamps[4]);

		const intent = await strategy.decide("FLAT");

		expect(intent.intent).toBe("OPEN_SHORT");
		expect(intent.reason).toBe("full_traversal_short");
	});

	it("should exit LONG on 2 consecutive negative deltas", async () => {
		// Add warmup candles
		addWarmupCandles(candles, deltaProvider, baseTimestamp);

		// Simulate being in a LONG position
		const timestamps = [
			baseTimestamp,
			baseTimestamp + 60_000,
			baseTimestamp + 120_000,
		];

		// Setup candles
		candles.push(createCandle(timestamps[0], 100, 105, 100, 105, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[0],
			price: 105,
			size: 10,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[0]);

		// First negative delta
		candles.push(createCandle(timestamps[1], 105, 105, 103, 104, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[1],
			price: 104,
			size: 8,
			side: "sell",
		});
		deltaProvider.closeBucket(timestamps[1]);

		// Second consecutive negative delta - should trigger exit
		candles.push(createCandle(timestamps[2], 104, 104, 102, 103, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[2],
			price: 103,
			size: 10,
			side: "sell",
		});
		deltaProvider.closeBucket(timestamps[2]);

		const intent = await strategy.decide("LONG");

		expect(intent.intent).toBe("CLOSE_LONG");
		expect(intent.reason).toBe("delta_flip_exit");
	});

	it("should exit SHORT on 2 consecutive positive deltas", async () => {
		// Add warmup candles
		addWarmupCandles(candles, deltaProvider, baseTimestamp);

		const timestamps = [
			baseTimestamp,
			baseTimestamp + 60_000,
			baseTimestamp + 120_000,
		];

		candles.push(createCandle(timestamps[0], 100, 100, 95, 95, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[0],
			price: 95,
			size: 10,
			side: "sell",
		});
		deltaProvider.closeBucket(timestamps[0]);

		// First positive delta
		candles.push(createCandle(timestamps[1], 95, 97, 95, 96, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[1],
			price: 96,
			size: 8,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[1]);

		// Second consecutive positive delta
		candles.push(createCandle(timestamps[2], 96, 98, 96, 97, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[2],
			price: 97,
			size: 10,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[2]);

		const intent = await strategy.decide("SHORT");

		expect(intent.intent).toBe("CLOSE_SHORT");
		expect(intent.reason).toBe("delta_flip_exit");
	});

	it("should not enter without touched flag", async () => {
		// Add warmup candles
		addWarmupCandles(candles, deltaProvider, baseTimestamp);

		// Price closes above upper but never touched lower
		const timestamps = [baseTimestamp, baseTimestamp + 60_000];

		candles.push(createCandle(timestamps[0], 100, 100, 100, 100, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[0],
			price: 100,
			size: 10,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[0]);

		candles.push(createCandle(timestamps[1], 100, 110, 100, 110, 1000));
		deltaProvider.processTrade({
			timestamp: timestamps[1],
			price: 110,
			size: 15,
			side: "buy",
		});
		deltaProvider.closeBucket(timestamps[1]);

		const intent = await strategy.decide("FLAT");

		expect(intent.intent).toBe("NO_ACTION");
		expect(intent.reason).toBe("waiting_for_lower_touch");
	});
});
