import { StrategyConfig, StrategyId } from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
import type { TraderStrategy } from "./types";
import { createVwapStrategyBuilder } from "./vwapStrategyBuilder";

interface StrategyBuilderContext {
	strategyConfig: StrategyConfig;
	symbol: string;
	timeframe: string;
}

type StrategyBuilderFactory = (
	context: StrategyBuilderContext
) => (client: MexcClient) => Promise<TraderStrategy>;

const strategyBuilders: Record<StrategyId, StrategyBuilderFactory> = {
	vwap_delta_gamma: ({ strategyConfig, symbol }) =>
		createVwapStrategyBuilder({
			symbol,
			config: strategyConfig,
		}),
};

export const resolveStrategyBuilder = (
	strategyId: StrategyId,
	context: StrategyBuilderContext
): ((client: MexcClient) => Promise<TraderStrategy>) => {
	const factory = strategyBuilders[strategyId];
	if (!factory) {
		throw new Error(`No strategy builder registered for ${strategyId}`);
	}
	return factory(context);
};
