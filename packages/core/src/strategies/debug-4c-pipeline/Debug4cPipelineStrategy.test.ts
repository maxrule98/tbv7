import { describe, expect, it } from "vitest";
import { Candle } from "../../types";
import { MultiTimeframeCache } from "../../data/multiTimeframeCache";
import { Debug4cPipelineStrategy } from "./index";
import { Debug4cPipelineConfig } from "./config";

class InMemoryCache implements MultiTimeframeCache {
	private readonly frames = new Map<string, Candle[]>();

	setCandles(timeframe: string, candles: Candle[]): void {
		this.frames.set(
			timeframe,
			candles.map((candle) => ({ ...candle }))
		);
	}

	async getCandles(timeframe: string): Promise<Candle[]> {
		return (this.frames.get(timeframe) ?? []).map((candle) => ({ ...candle }));
	}

	async getLatestCandle(timeframe: string): Promise<Candle | undefined> {
		const candles = this.frames.get(timeframe) ?? [];
		const latest = candles[candles.length - 1];
		return latest ? { ...latest } : undefined;
	}

	async refreshAll(): Promise<void> {
		// no-op
	}
}

const makeCandle = (timestamp: number): Candle => ({
	symbol: "BTC/USDT",
	timeframe: "1m",
	timestamp,
	open: 100,
	high: 101,
	low: 99,
	close: 100,
	volume: 1,
});

describe("Debug4cPipelineStrategy", () => {
	it("emits the four deterministic intents and then stops", async () => {
		const cache = new InMemoryCache();
		const config: Debug4cPipelineConfig = {
			name: "Debug 4C Pipeline",
			symbol: "BTC/USDT",
			timeframes: { execution: "1m" },
			historyWindowCandles: 10,
			warmupPeriods: { default: 0, "1m": 0 },
		};
		const strategy = new Debug4cPipelineStrategy(config, { cache });
		const intents: string[] = [];

		for (let i = 0; i < 6; i += 1) {
			const candles = Array.from({ length: i + 1 }, (_, idx) =>
				makeCandle(1_700_000_000_000 + idx * 60_000)
			);
			cache.setCandles("1m", candles);
			const intent = await strategy.decide();
			if (intent.intent !== "NO_ACTION") {
				intents.push(intent.intent);
			}
		}

		expect(intents).toEqual([
			"OPEN_LONG",
			"CLOSE_LONG",
			"OPEN_SHORT",
			"CLOSE_SHORT",
		]);
	});
});
