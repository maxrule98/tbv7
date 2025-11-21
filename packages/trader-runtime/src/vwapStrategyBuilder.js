"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVwapStrategyBuilder = void 0;
const core_1 = require("@agenai/core");
const logger = (0, core_1.createLogger)("vwap-strategy-builder");
class VwapStrategyAdapter {
	constructor(deps) {
		this.deps = deps;
	}
	async decide(_candles, position) {
		await this.deps.cache.refreshAll();
		return this.deps.strategy.decide(position);
	}
}
const createVwapStrategyBuilder = ({ symbol, config }) => {
	const uniqueTimeframes = Array.from(
		new Set([
			config.timeframes.execution,
			config.timeframes.trend,
			config.timeframes.bias,
			config.timeframes.macro,
		])
	);
	return async (client) => {
		const cache = (0, core_1.createVWAPDeltaGammaCache)(
			(symbolArg, timeframeArg, limit) =>
				client.fetchOHLCV(symbolArg, timeframeArg, limit),
			symbol,
			uniqueTimeframes,
			config.cacheTTLms
		);
		await cache.refreshAll();
		const strategy = new core_1.VWAPDeltaGammaStrategy(config, { cache });
		logger.info("vwap_strategy_initialized", {
			symbol,
			cacheTimeframes: uniqueTimeframes,
			cacheTtlMs: config.cacheTTLms,
			strategyClass: strategy.constructor.name,
		});
		return new VwapStrategyAdapter({ strategy, cache });
	};
};
exports.createVwapStrategyBuilder = createVwapStrategyBuilder;
