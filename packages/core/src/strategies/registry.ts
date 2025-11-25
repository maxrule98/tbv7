import {
	VWAPDeltaGammaConfig,
	VWAPDeltaGammaStrategy,
	loadVWAPDeltaGammaConfig,
} from "./vwap-delta-gamma/VWAPDeltaGammaStrategy";
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
};

const ensureStrategyId = (
	expected: StrategyId,
	actual: StrategyId,
	profile?: string
): void => {
	if (expected !== actual) {
		throw new Error(
			`Strategy profile ${
				profile ?? "default"
			} resolved to ${actual}, expected ${expected}`
		);
	}
};

const strategyRegistry: StrategyDefinitionMap = {
	vwap_delta_gamma: {
		id: "vwap_delta_gamma",
		className: "VWAPDeltaGammaStrategy",
		configPath: "configs/strategies/vwap-delta-gamma.json",
		loadConfig: ({ configPath } = {}) => loadVWAPDeltaGammaConfig(configPath),
		resolveStrategyClass: async () => VWAPDeltaGammaStrategy,
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
