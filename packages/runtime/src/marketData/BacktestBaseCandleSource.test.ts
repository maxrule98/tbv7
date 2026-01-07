import { describe, it, expect, vi } from "vitest";
import { Candle } from "@agenai/core";
import { BacktestBaseCandleSource } from "./BacktestBaseCandleSource";

const createCandle = (timestamp: number, close: number): Candle => ({
	timestamp,
	open: close,
	high: close,
	low: close,
	close,
	volume: 100,
	symbol: "BTC/USDT",
	timeframe: "1m",
});

describe("BacktestBaseCandleSource", () => {
	it("should emit candles in ascending timestamp order even if input unsorted", async () => {
		const unsortedCandles = [
			createCandle(3000, 103),
			createCandle(1000, 101),
			createCandle(2000, 102),
		];

		const source = new BacktestBaseCandleSource({
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles: unsortedCandles,
		});

		const emittedCandles: Candle[] = [];
		const onCandle = vi.fn((candle: Candle) => {
			emittedCandles.push(candle);
		});

		await source.start({
			symbol: "BTC/USDT",
			timeframe: "1m",
			onCandle,
		});

		expect(onCandle).toHaveBeenCalledTimes(3);
		expect(emittedCandles[0].timestamp).toBe(1000);
		expect(emittedCandles[1].timestamp).toBe(2000);
		expect(emittedCandles[2].timestamp).toBe(3000);
	});

	it("should emit each candle exactly once", async () => {
		const candles = [
			createCandle(1000, 100),
			createCandle(2000, 200),
			createCandle(3000, 300),
		];

		const source = new BacktestBaseCandleSource({
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles,
		});

		const onCandle = vi.fn();

		await source.start({
			symbol: "BTC/USDT",
			timeframe: "1m",
			onCandle,
		});

		expect(onCandle).toHaveBeenCalledTimes(3);

		// Verify each candle emitted with correct metadata
		expect(onCandle).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ timestamp: 1000, close: 100 }),
			{ receivedAt: 1000, source: "backtest" }
		);
		expect(onCandle).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ timestamp: 2000, close: 200 }),
			{ receivedAt: 2000, source: "backtest" }
		);
		expect(onCandle).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ timestamp: 3000, close: 300 }),
			{ receivedAt: 3000, source: "backtest" }
		);
	});

	it("should stop emitting if stop() is called during iteration", async () => {
		const candles = [
			createCandle(1000, 100),
			createCandle(2000, 200),
			createCandle(3000, 300),
			createCandle(4000, 400),
			createCandle(5000, 500),
		];

		const source = new BacktestBaseCandleSource({
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles,
		});

		let emitCount = 0;
		const onCandle = vi.fn(() => {
			emitCount++;
			// Stop after 2nd emission
			if (emitCount === 2) {
				source.stop();
			}
		});

		await source.start({
			symbol: "BTC/USDT",
			timeframe: "1m",
			onCandle,
		});

		// Should emit 2 candles, then stop (3rd emission blocked by stopped flag)
		expect(onCandle).toHaveBeenCalledTimes(2);
	});

	it("should be idempotent - multiple stop() calls safe", () => {
		const source = new BacktestBaseCandleSource({
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles: [createCandle(1000, 100)],
		});

		expect(() => {
			source.stop();
			source.stop();
			source.stop();
		}).not.toThrow();
	});

	it("should throw on symbol mismatch", async () => {
		const source = new BacktestBaseCandleSource({
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles: [createCandle(1000, 100)],
		});

		await expect(
			source.start({
				symbol: "ETH/USDT", // Wrong symbol
				timeframe: "1m",
				onCandle: vi.fn(),
			})
		).rejects.toThrow(
			"BacktestBaseCandleSource: symbol mismatch. Expected 'BTC/USDT', got 'ETH/USDT'"
		);
	});

	it("should throw on timeframe mismatch", async () => {
		const source = new BacktestBaseCandleSource({
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles: [createCandle(1000, 100)],
		});

		await expect(
			source.start({
				symbol: "BTC/USDT",
				timeframe: "5m", // Wrong timeframe
				onCandle: vi.fn(),
			})
		).rejects.toThrow(
			"BacktestBaseCandleSource: timeframe mismatch. Expected '1m', got '5m'"
		);
	});

	it("should handle empty candles array gracefully", async () => {
		const source = new BacktestBaseCandleSource({
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles: [],
		});

		const onCandle = vi.fn();

		await source.start({
			symbol: "BTC/USDT",
			timeframe: "1m",
			onCandle,
		});

		expect(onCandle).toHaveBeenCalledTimes(0);
	});

	it("should pass venue property correctly", () => {
		const source = new BacktestBaseCandleSource({
			venue: "binance_testnet",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles: [],
		});

		expect(source.venue).toBe("binance_testnet");
	});

	it("should use logger if provided", async () => {
		const logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};

		const source = new BacktestBaseCandleSource({
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles: [createCandle(1000, 100)],
			logger,
		});

		await source.start({
			symbol: "BTC/USDT",
			timeframe: "1m",
			onCandle: vi.fn(),
		});

		// Should log start and complete
		expect(logger.info).toHaveBeenCalledWith("backtest_base_source_start", {
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candleCount: 1,
		});

		expect(logger.info).toHaveBeenCalledWith("backtest_base_source_complete", {
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			emitted: 1,
		});
	});

	it("should not mutate original candles array", async () => {
		const originalCandles = [
			createCandle(3000, 103),
			createCandle(1000, 101),
			createCandle(2000, 102),
		];
		const candlesCopy = [...originalCandles];

		const source = new BacktestBaseCandleSource({
			venue: "binance",
			symbol: "BTC/USDT",
			timeframe: "1m",
			candles: originalCandles,
		});

		await source.start({
			symbol: "BTC/USDT",
			timeframe: "1m",
			onCandle: vi.fn(),
		});

		// Original array should remain unsorted
		expect(originalCandles).toEqual(candlesCopy);
		expect(originalCandles[0].timestamp).toBe(3000);
		expect(originalCandles[1].timestamp).toBe(1000);
		expect(originalCandles[2].timestamp).toBe(2000);
	});
});
