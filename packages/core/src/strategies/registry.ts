import {
	MultiTimeframeCache,
	MultiTimeframeCacheOptions,
} from "../data/multiTimeframeCache";
import vwapDeltaGammaModule from "./vwap-delta-gamma";
import ultraAggressiveModule from "./ultra-aggressive-btc-usdt";
import { STRATEGY_IDS, isStrategyId, StrategyId } from "./ids";

export type StrategyManifestSummary = {
	strategyId: StrategyId;
	name: string;
};

export interface StrategyRegistryEntry<
	TConfig = unknown,
	TDeps = unknown,
	TStrategy = unknown,
	TManifest extends StrategyManifestSummary = StrategyManifestSummary,
> {
	id: StrategyId;
	manifest: TManifest;
	defaultProfile: string;
	loadConfig: (configPath?: string) => TConfig;
	createStrategy: (config: TConfig, deps: TDeps) => TStrategy;
	dependencies?: StrategyDependencyMetadata<TConfig, TDeps>;
}

export interface StrategyDependencyMetadata<TConfig, TDeps> {
	createCache?: (
		fetcher: MultiTimeframeCacheOptions["fetcher"],
		symbol: string,
		timeframes: string[],
		maxAgeMs: number
	) => MultiTimeframeCache;
	warmup?: (config: TConfig, deps?: TDeps) => Promise<void> | void;
}

type AnyStrategyEntry = StrategyRegistryEntry<any, any, any>;

const registryEntries = [
	vwapDeltaGammaModule,
	ultraAggressiveModule,
] satisfies AnyStrategyEntry[];

const registryMap = registryEntries.reduce<
	Record<StrategyId, AnyStrategyEntry>
>(
	(acc, entry) => {
		acc[entry.id] = entry;
		return acc;
	},
	{} as Record<StrategyId, AnyStrategyEntry>
);

export const strategyRegistry: AnyStrategyEntry[] = registryEntries;

export const getStrategyDefinition = <
	TConfig = unknown,
	TDeps = unknown,
	TStrategy = unknown,
>(
	id: StrategyId
): StrategyRegistryEntry<TConfig, TDeps, TStrategy> => {
	const definition = registryMap[id];
	if (!definition) {
		throw new Error(`Unknown strategy id: ${id}`);
	}
	return definition as StrategyRegistryEntry<TConfig, TDeps, TStrategy>;
};

export const listStrategyDefinitions = (): AnyStrategyEntry[] => {
	return [...registryEntries];
};

export const validateStrategyId = (value: string): StrategyId | null => {
	if (isStrategyId(value)) {
		return value;
	}
	return null;
};

export { STRATEGY_IDS, isStrategyId, StrategyId };
