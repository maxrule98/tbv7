import { describe, expect, it, vi } from "vitest";
import type { StrategyConfig, TradeIntent } from "@agenai/core";
import type { TraderStrategy } from "./types";
import {
	createStrategyRuntime,
	resolveStrategyRuntimeMetadata,
} from "./runtimeFactory";

const baseStrategyConfig: StrategyConfig = {
	id: "ultra_aggressive_btc_usdt",
	symbol: "BTC/USDT",
	timeframes: {
		execution: "1m",
		confirming: "5m",
	},
	trackedTimeframes: ["15m"],
	warmupPeriods: {
		default: 50,
		"1m": 120,
		"5m": 60,
	},
	historyWindowCandles: 500,
	cacheTTLms: 1_000,
};

const scriptedStrategy: TraderStrategy = {
	decide: async (): Promise<TradeIntent> => ({
		symbol: "BTC/USDT",
		intent: "NO_ACTION",
		reason: "runtime_factory_test",
	}),
};

describe("runtimeFactory", () => {
	it("produces identical metadata for live and backtest contexts", async () => {
		const builder = vi.fn(async () => scriptedStrategy);
		const liveRuntime = await createStrategyRuntime({
			strategyConfig: baseStrategyConfig,
			builder,
			builderName: "live",
		});
		const backtestRuntime = await createStrategyRuntime({
			strategyConfig: baseStrategyConfig,
			builder,
			builderName: "backtest",
		});

		expect(liveRuntime.cacheLimit).toBe(backtestRuntime.cacheLimit);
		expect(liveRuntime.runtimeParams).toEqual(backtestRuntime.runtimeParams);
		expect(liveRuntime.trackedTimeframes).toEqual(
			backtestRuntime.trackedTimeframes
		);
		expect(Array.from(liveRuntime.warmupByTimeframe.entries())).toEqual(
			Array.from(backtestRuntime.warmupByTimeframe.entries())
		);
		expect(builder).toHaveBeenCalledTimes(2);
	});

	it("reuses provided metadata when supplied", async () => {
		const metadata = resolveStrategyRuntimeMetadata(baseStrategyConfig, {
			instrument: {
				symbol: "ETH/USDT",
				timeframe: "5m",
			},
			maxCandlesOverride: 250,
		});
		const builder = vi.fn(async (context) => {
			expect(context.runtimeParams.symbol).toBe("ETH/USDT");
			expect(context.runtimeParams.executionTimeframe).toBe("5m");
			expect(context.cacheLimit).toBe(metadata.cacheLimit);
			return scriptedStrategy;
		});

		const runtime = await createStrategyRuntime({
			strategyConfig: baseStrategyConfig,
			builder,
			metadata,
		});

		expect(runtime.runtimeParams.symbol).toBe("ETH/USDT");
		expect(runtime.runtimeParams.executionTimeframe).toBe("5m");
		expect(runtime.cacheLimit).toBe(metadata.cacheLimit);
		expect(builder).toHaveBeenCalledTimes(1);
	});
});
