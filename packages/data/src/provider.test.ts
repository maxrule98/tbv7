import { Candle } from "@agenai/core";
import { describe, expect, it } from "vitest";
import { DefaultDataProvider } from "./provider";
import { PollingLiveSubscription } from "./liveSubscription";
import type { MarketDataClient } from "./types";

const buildCandles = (
	count: number,
	timeframe: string,
	start: number,
	stepMs: number,
	symbol = "BTC/USDT"
): Candle[] => {
	return Array.from({ length: count }, (_, idx) => {
		const timestamp = start + idx * stepMs;
		return {
			symbol,
			timeframe,
			timestamp,
			open: 100 + idx,
			high: 101 + idx,
			low: 99 + idx,
			close: 100 + idx,
			volume: 1_000 + idx,
		};
	});
};

class StaticMarketDataClient implements MarketDataClient {
	constructor(private readonly candlesByTimeframe: Record<string, Candle[]>) {}

	async fetchOHLCV(
		symbol: string,
		timeframe: string,
		limit: number,
		since = 0
	): Promise<Candle[]> {
		const series = (this.candlesByTimeframe[timeframe] ?? []).filter(
			(candle) => candle.symbol === symbol && candle.timestamp >= since
		);
		return series.slice(0, limit);
	}
}

class StreamingMarketDataClient implements MarketDataClient {
	private readonly offsets = new Map<string, number>();
	public callCount = 0;

	constructor(private readonly candlesByTimeframe: Record<string, Candle[]>) {}

	async fetchOHLCV(
		symbol: string,
		timeframe: string,
		limit: number
	): Promise<Candle[]> {
		void limit;
		this.callCount += 1;
		const series = (this.candlesByTimeframe[timeframe] ?? []).filter(
			(candle) => candle.symbol === symbol
		);
		if (!series.length) {
			return [];
		}
		const offset = this.offsets.get(timeframe) ?? 0;
		const next = series[Math.min(offset, series.length - 1)];
		if (offset < series.length) {
			this.offsets.set(timeframe, offset + 1);
		}
		return [next];
	}
}

describe("DefaultDataProvider", () => {
	const baseTs = Date.UTC(2025, 0, 1, 0, 0, 0);

	it("loads historical series with warmup and limits", async () => {
		const candles = buildCandles(20, "1m", baseTs, 60_000);
		const client = new StaticMarketDataClient({ "1m": candles });
		const provider = new DefaultDataProvider({ client });

		const [series] = await provider.loadHistoricalSeries({
			symbol: "BTC/USDT",
			startTimestamp: baseTs + 5 * 60_000,
			endTimestamp: baseTs + 15 * 60_000,
			requests: [{ timeframe: "1m", warmup: 2, limit: 4 }],
		});

		expect(series.timeframe).toBe("1m");
		expect(series.candles.length).toBe(6);
		const timestamps = series.candles.map((candle) => candle.timestamp);
		expect(timestamps[0]).toBe(baseTs + 3 * 60_000);
		expect(timestamps[timestamps.length - 1]).toBe(baseTs + 8 * 60_000);
	});

	it("loads multiple timeframes concurrently", async () => {
		const oneMinute = buildCandles(30, "1m", baseTs, 60_000);
		const fiveMinute = buildCandles(15, "5m", baseTs, 300_000);
		const client = new StaticMarketDataClient({
			"1m": oneMinute,
			"5m": fiveMinute,
		});
		const provider = new DefaultDataProvider({ client });

		const series = await provider.loadHistoricalSeries({
			symbol: "BTC/USDT",
			startTimestamp: baseTs + 10 * 60_000,
			endTimestamp: baseTs + 25 * 60_000,
			requests: [
				{ timeframe: "1m", warmup: 5, limit: 5 },
				{ timeframe: "5m", warmup: 1 },
			],
		});

		expect(series).toHaveLength(2);
		const fastFrame = series.find((s) => s.timeframe === "1m");
		const slowFrame = series.find((s) => s.timeframe === "5m");
		expect(fastFrame?.candles.length).toBe(10);
		expect(slowFrame?.candles.length).toBeGreaterThanOrEqual(4);
	});

	it("streams live candles and retains buffer", async () => {
		const stream = buildCandles(3, "1m", baseTs, 60_000);
		const client = new StreamingMarketDataClient({ "1m": stream });
		const provider = new DefaultDataProvider({ client });
		const subscription = provider.createLiveSubscription({
			symbol: "BTC/USDT",
			timeframes: ["1m"],
			pollIntervalMs: 20,
			bufferSize: 5,
		});
		const polling = subscription as PollingLiveSubscription;

		const received: Candle[] = [];
		subscription.onCandle((candle) => {
			received.push(candle);
		});

		await polling.runOnce();
		await polling.runOnce();
		await polling.runOnce();

		expect(client.callCount).toBeGreaterThanOrEqual(3);
		expect(received.map((c) => c.timestamp)).toEqual(
			stream.map((c) => c.timestamp)
		);
		expect(subscription.getCandles("1m")).toHaveLength(3);
		subscription.stop();
	});
});
