import {
	Candle,
	MultiTimeframeCache,
	PositionSide,
	StrategyConfig,
	StrategyId,
	TradeIntent,
	createLogger,
	loadStrategy,
} from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
import type { TraderStrategy } from "./types";

const logger = createLogger("strategy-builder");

interface StrategyBuilderContext {
	strategyConfig: StrategyConfig;
	symbol: string;
	timeframe: string;
}

export const resolveStrategyBuilder = (
	strategyId: StrategyId,
	context: StrategyBuilderContext
): ((client: MexcClient) => Promise<TraderStrategy>) => {
	return async (client: MexcClient): Promise<TraderStrategy> => {
		let timeframes = deriveTimeframes(context.strategyConfig);
		if (!timeframes.includes(context.timeframe)) {
			timeframes = [...timeframes, context.timeframe];
		}
		const cacheTtl = (context.strategyConfig as { cacheTTLms?: number })
			.cacheTTLms;
		const { strategy, cache, manifest } = await loadStrategy({
			strategyId,
			config: context.strategyConfig,
			cache: {
				fetcher: (symbolArg: string, timeframeArg: string, limit: number) =>
					client.fetchOHLCV(symbolArg, timeframeArg, limit),
				symbol: context.symbol,
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
			symbol: context.symbol,
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
		position: PositionSide
	): Promise<TradeIntent> {
		await this.cache.refreshAll();
		return this.strategy.decide(position);
	}
}

const deriveTimeframes = (strategyConfig: StrategyConfig): string[] => {
	const frameSet = new Set<string>();
	if (
		strategyConfig &&
		typeof strategyConfig === "object" &&
		"timeframes" in strategyConfig
	) {
		const timeframes = (
			strategyConfig as { timeframes?: Record<string, string> }
		).timeframes;
		if (timeframes) {
			for (const value of Object.values(timeframes)) {
				if (typeof value === "string" && value.length > 0) {
					frameSet.add(value);
				}
			}
		}
	}
	const tracked = (strategyConfig as { trackedTimeframes?: unknown })
		.trackedTimeframes;
	if (Array.isArray(tracked)) {
		for (const tf of tracked) {
			if (typeof tf === "string" && tf.length > 0) {
				frameSet.add(tf);
			}
		}
	}
	return Array.from(frameSet);
};
