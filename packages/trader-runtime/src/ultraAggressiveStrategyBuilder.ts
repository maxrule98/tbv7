import { MexcClient } from "@agenai/exchange-mexc";
import {
	Candle,
	MultiTimeframeCache,
	PositionSide,
	TradeIntent,
	UltraAggressiveBtcUsdtConfig,
	UltraAggressiveBtcUsdtStrategy,
	createLogger,
	createUltraAggressiveCache,
} from "@agenai/core";
import type { TraderStrategy } from "./types";

const logger = createLogger("ultra-agg-strategy-builder");

interface UltraStrategyAdapterDeps {
	strategy: UltraAggressiveBtcUsdtStrategy;
	cache: MultiTimeframeCache;
}

class UltraStrategyAdapter implements TraderStrategy {
	constructor(private readonly deps: UltraStrategyAdapterDeps) {}

	async decide(
		_candles: Candle[],
		position: PositionSide
	): Promise<TradeIntent> {
		await this.deps.cache.refreshAll();
		return this.deps.strategy.decide(position);
	}
}

interface CreateUltraStrategyBuilderOptions {
	symbol: string;
	config: UltraAggressiveBtcUsdtConfig;
}

export const createUltraAggressiveStrategyBuilder = ({
	symbol,
	config,
}: CreateUltraStrategyBuilderOptions) => {
	const trackedTimeframes = Array.from(
		new Set([
			config.timeframes.execution,
			config.timeframes.confirming,
			config.timeframes.context,
		])
	);

	return async (client: MexcClient): Promise<TraderStrategy> => {
		const cache = createUltraAggressiveCache(
			(symbolArg: string, timeframeArg: string, limit: number) =>
				client.fetchOHLCV(symbolArg, timeframeArg, limit),
			symbol,
			trackedTimeframes,
			config.cacheTTLms
		);
		await cache.refreshAll();
		const strategy = new UltraAggressiveBtcUsdtStrategy(config, { cache });
		logger.info("ultra_strategy_initialized", {
			symbol,
			cacheTimeframes: trackedTimeframes,
			cacheTtlMs: config.cacheTTLms,
			strategyClass: strategy.constructor.name,
		});
		return new UltraStrategyAdapter({ strategy, cache });
	};
};
