import { MexcClient } from "@agenai/exchange-mexc";
import {
	Candle,
	MultiTimeframeCache,
	PositionSide,
	TradeIntent,
	VWAPDeltaGammaConfig,
	VWAPDeltaGammaStrategy,
	createLogger,
	createVWAPDeltaGammaCache,
} from "@agenai/core";
import { TraderStrategy } from "./startTrader";

const logger = createLogger("vwap-strategy-builder");

interface VwapStrategyAdapterDeps {
	strategy: VWAPDeltaGammaStrategy;
	cache: MultiTimeframeCache;
}

class VwapStrategyAdapter implements TraderStrategy {
	constructor(private readonly deps: VwapStrategyAdapterDeps) {}

	async decide(
		_candles: Candle[],
		position: PositionSide
	): Promise<TradeIntent> {
		await this.deps.cache.refreshAll();
		return this.deps.strategy.decide(position);
	}
}

interface CreateVwapStrategyBuilderOptions {
	symbol: string;
	config: VWAPDeltaGammaConfig;
}

export const createVwapStrategyBuilder = ({
	symbol,
	config,
}: CreateVwapStrategyBuilderOptions) => {
	const uniqueTimeframes = Array.from(
		new Set([
			config.timeframes.execution,
			config.timeframes.trend,
			config.timeframes.bias,
			config.timeframes.macro,
		])
	);

	return async (client: MexcClient): Promise<TraderStrategy> => {
		const cache = createVWAPDeltaGammaCache(
			(symbolArg, timeframeArg, limit) =>
				client.fetchOHLCV(symbolArg, timeframeArg, limit),
			symbol,
			uniqueTimeframes,
			config.cacheTTLms
		);
		await cache.refreshAll();
		const strategy = new VWAPDeltaGammaStrategy(config, { cache });
		logger.info("vwap_strategy_initialized", {
			symbol,
			cacheTimeframes: uniqueTimeframes,
			cacheTtlMs: config.cacheTTLms,
			strategyClass: strategy.constructor.name,
		});
		return new VwapStrategyAdapter({ strategy, cache });
	};
};
