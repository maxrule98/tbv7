import {
	VWAPDeltaGammaConfig,
	VWAPDeltaGammaStrategy,
	loadVWAPDeltaGammaConfig,
} from "./vwap-delta-gamma/VWAPDeltaGammaStrategy";
import {
	UltraAggressiveBtcUsdtConfig,
	UltraAggressiveBtcUsdtStrategy,
	loadUltraAggressiveConfig,
} from "./ultra-aggressive-btc-usdt/UltraAggressiveBtcUsdtStrategy";
import { STRATEGY_IDS, isStrategyId, StrategyId } from "./ids";

export interface StrategyConfigLoaderOptions {
	configDir?: string;
	profile?: string;
	configPath?: string;
}

export type StrategyConstructor = new (...args: any[]) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface StrategyDefinition<
	TConfig = unknown,
	TCtor extends StrategyConstructor = StrategyConstructor
> {
	id: StrategyId;
	className: string;
	loadConfig: (options?: StrategyConfigLoaderOptions) => TConfig;
	resolveStrategyClass: () => Promise<TCtor>;
	defaultProfile?: string;
	configPath?: string;
}

type StrategyDefinitionMap = {
	vwap_delta_gamma: StrategyDefinition<
		VWAPDeltaGammaConfig,
		typeof VWAPDeltaGammaStrategy
	>;
	ultra_aggressive_btc_usdt: StrategyDefinition<
		UltraAggressiveBtcUsdtConfig,
		typeof UltraAggressiveBtcUsdtStrategy
	>;
};

const strategyRegistry: StrategyDefinitionMap = {
	vwap_delta_gamma: {
		id: "vwap_delta_gamma",
		className: "VWAPDeltaGammaStrategy",
		configPath: "configs/strategies/vwap-delta-gamma.json",
		loadConfig: ({ configPath } = {}) => loadVWAPDeltaGammaConfig(configPath),
		resolveStrategyClass: async () => VWAPDeltaGammaStrategy,
	},
	ultra_aggressive_btc_usdt: {
		id: "ultra_aggressive_btc_usdt",
		className: "UltraAggressiveBtcUsdtStrategy",
		configPath: "configs/strategies/ultra-aggressive-btc-usdt.json",
		loadConfig: ({ configPath } = {}) => loadUltraAggressiveConfig(configPath),
		resolveStrategyClass: async () => UltraAggressiveBtcUsdtStrategy,
	},
};

export const getStrategyDefinition = <TConfig = unknown>(
	id: StrategyId
): StrategyDefinition<TConfig> => {
	const definition = strategyRegistry[id];
	if (!definition) {
		throw new Error(`Unknown strategy id: ${id}`);
	}
	return definition as StrategyDefinition<TConfig>;
};

export const listStrategyDefinitions = (): StrategyDefinition[] => {
	return STRATEGY_IDS.map((id) => strategyRegistry[id]);
};

export const validateStrategyId = (value: string): StrategyId | null => {
	if (isStrategyId(value)) {
		return value;
	}
	return null;
};

export { STRATEGY_IDS, isStrategyId, StrategyId };
