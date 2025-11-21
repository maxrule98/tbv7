import {
	loadStrategyConfig,
	MacdAr4StrategyConfig,
	MomentumV3StrategyConfig,
} from "../config";
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
	macd_ar4_v2: StrategyDefinition<MacdAr4StrategyConfig>;
	momentum_v3: StrategyDefinition<MomentumV3StrategyConfig>;
	vwap_delta_gamma: StrategyDefinition<
		VWAPDeltaGammaConfig,
		typeof VWAPDeltaGammaStrategy
	>;
};

type StrategyEngineModule = {
	MacdAr4Strategy: StrategyConstructor;
	MomentumV3Strategy: StrategyConstructor;
};

const STRATEGY_ENGINE_MODULE_ID = "@agenai/strategy-engine";

const loadStrategyEngineModule = async (): Promise<StrategyEngineModule> => {
	const moduleId: string = STRATEGY_ENGINE_MODULE_ID;
	const mod = (await import(moduleId)) as Partial<StrategyEngineModule>;
	if (!mod.MacdAr4Strategy || !mod.MomentumV3Strategy) {
		throw new Error("Failed to load @agenai/strategy-engine exports");
	}
	return mod as StrategyEngineModule;
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
	macd_ar4_v2: {
		id: "macd_ar4_v2",
		className: "MacdAr4Strategy",
		defaultProfile: "macd_ar4",
		loadConfig: ({ configDir, profile } = {}) => {
			const config = loadStrategyConfig(
				configDir,
				profile ?? "macd_ar4"
			) as MacdAr4StrategyConfig;
			ensureStrategyId("macd_ar4_v2", config.id, profile);
			return config;
		},
		resolveStrategyClass: async () =>
			(await loadStrategyEngineModule()).MacdAr4Strategy,
	},
	momentum_v3: {
		id: "momentum_v3",
		className: "MomentumV3Strategy",
		defaultProfile: "momentum_v3",
		loadConfig: ({ configDir, profile } = {}) => {
			const config = loadStrategyConfig(
				configDir,
				profile ?? "momentum_v3"
			) as MomentumV3StrategyConfig;
			ensureStrategyId("momentum_v3", config.id, profile);
			return config;
		},
		resolveStrategyClass: async () =>
			(await loadStrategyEngineModule()).MomentumV3Strategy,
	},
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
