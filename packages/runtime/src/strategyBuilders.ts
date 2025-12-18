import {
	Candle,
	MultiTimeframeCache,
	PositionSide,
	StrategyId,
	TradeIntent,
	createLogger,
	loadStrategy,
} from "@agenai/core";
import type { StrategyDecisionContext, TraderStrategy } from "./types";
import type {
	StrategyRuntimeBuilder,
	StrategyRuntimeBuilderContext,
} from "./runtimeFactory";

const logger = createLogger("strategy-builder");
type CandleFetcher = (
	symbol: string,
	timeframe: string,
	limit: number
) => Promise<Candle[]>;

export const resolveStrategyBuilder = (
	strategyId: StrategyId,
	fetcher: CandleFetcher
): StrategyRuntimeBuilder => {
	return async (
		context: StrategyRuntimeBuilderContext
	): Promise<TraderStrategy> => {
		const timeframes = deriveTimeframes(context);
		const cacheTtl = (context.strategyConfig as { cacheTTLms?: number })
			.cacheTTLms;
		const { strategy, cache, manifest } = await loadStrategy({
			strategyId,
			config: context.strategyConfig,
			cache: {
				fetcher: (symbolArg: string, timeframeArg: string, limit: number) =>
					fetcher(symbolArg, timeframeArg, limit),
				symbol: context.runtimeParams.symbol,
				timeframes,
				maxAgeMs: cacheTtl,
			},
		});

		if (!cache) {
			throw new Error(
				`Strategy ${strategyId} did not expose a cache dependency, cannot build runtime adapter`
			);
		}

		logger.info("strategy_adapter_initialized", {
			strategyId,
			strategyName: manifest.name,
			symbol: context.runtimeParams.symbol,
			timeframes,
			cacheTtlMs: cacheTtl ?? null,
		});

		return new CacheBackedStrategyAdapter(
			strategy as CacheDrivenStrategy,
			cache
		);
	};
};

type CacheDrivenStrategy = {
	decide: (position: PositionSide) => Promise<TradeIntent>;
};

class CacheBackedStrategyAdapter implements TraderStrategy {
	constructor(
		private readonly strategy: CacheDrivenStrategy,
		private readonly cache: MultiTimeframeCache
	) {}

	async decide(
		_candles: Candle[],
		position: PositionSide,
		_context: StrategyDecisionContext
	): Promise<TradeIntent> {
		await this.cache.refreshAll();
		return this.strategy.decide(position);
	}
}

const deriveTimeframes = (context: StrategyRuntimeBuilderContext): string[] => {
	if (context.trackedTimeframes.length) {
		return [...context.trackedTimeframes];
	}
	const frameSet = new Set<string>();
	if (
		context.strategyConfig &&
		typeof context.strategyConfig === "object" &&
		"timeframes" in context.strategyConfig
	) {
		const timeframes = (
			context.strategyConfig as { timeframes?: Record<string, string> }
		).timeframes;
		if (timeframes) {
			for (const value of Object.values(timeframes)) {
				if (typeof value === "string" && value.length > 0) {
					frameSet.add(value);
				}
			}
		}
	}
	const tracked = (context.strategyConfig as { trackedTimeframes?: unknown })
		.trackedTimeframes;
	if (Array.isArray(tracked)) {
		for (const tf of tracked) {
			if (typeof tf === "string" && tf.length > 0) {
				frameSet.add(tf);
			}
		}
	}
	frameSet.add(context.runtimeParams.executionTimeframe);
	return Array.from(frameSet);
};
