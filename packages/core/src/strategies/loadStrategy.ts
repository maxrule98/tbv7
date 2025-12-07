import {
	MultiTimeframeCache,
	MultiTimeframeCacheOptions,
} from "../data/multiTimeframeCache";
import type { StrategyId } from "./types";
import {
	StrategyManifestSummary,
	StrategyRegistryEntry,
	getStrategyDefinition,
} from "./registry";

export interface LoadStrategyCacheOptions {
	fetcher: MultiTimeframeCacheOptions["fetcher"];
	symbol: string;
	timeframes?: string[];
	maxAgeMs?: number;
	prefill?: boolean;
}

export interface LoadStrategyOptions<
	TConfig = unknown,
	TDeps = unknown,
	TStrategy = unknown,
> {
	strategyId: StrategyId;
	config?: TConfig;
	configPath?: string;
	cache?: LoadStrategyCacheOptions;
	buildDependencies?: (
		config: TConfig,
		entry: StrategyRegistryEntry<TConfig, TDeps, TStrategy>
	) => Promise<TDeps> | TDeps;
}

export interface LoadedStrategyResult<
	TStrategy = unknown,
	TConfig = unknown,
	TDeps = unknown,
> {
	id: StrategyId;
	manifest: StrategyManifestSummary;
	strategy: TStrategy;
	config: TConfig;
	dependencies: TDeps;
	cache?: MultiTimeframeCache;
}

export const loadStrategy = async <
	TConfig = unknown,
	TDeps = unknown,
	TStrategy = unknown,
>(
	options: LoadStrategyOptions<TConfig, TDeps, TStrategy>
): Promise<LoadedStrategyResult<TStrategy, TConfig, TDeps>> => {
	const entry = getStrategyDefinition<TConfig, TDeps, TStrategy>(
		options.strategyId
	);
	const config = options.config ?? entry.loadConfig(options.configPath);

	const { dependencies, cache } = await resolveDependencies(
		entry,
		config,
		options
	);
	const strategy = entry.createStrategy(config, dependencies);
	if (entry.dependencies?.warmup) {
		await entry.dependencies.warmup(config, dependencies);
	}

	return {
		id: entry.id,
		manifest: entry.manifest,
		strategy,
		config,
		dependencies,
		cache,
	};
};

const resolveDependencies = async <TConfig, TDeps, TStrategy>(
	entry: StrategyRegistryEntry<TConfig, TDeps, TStrategy>,
	config: TConfig,
	options: LoadStrategyOptions<TConfig, TDeps, TStrategy>
): Promise<{ dependencies: TDeps; cache?: MultiTimeframeCache }> => {
	if (options.buildDependencies) {
		const deps = await options.buildDependencies(config, entry);
		return { dependencies: deps };
	}

	if (!entry.dependencies?.createCache) {
		return { dependencies: {} as TDeps };
	}

	if (!options.cache) {
		throw new Error(
			`Strategy ${entry.id} requires cache dependencies but none were provided`
		);
	}

	const timeframes = options.cache.timeframes ?? extractTimeframes(config);
	const maxAgeMs = options.cache.maxAgeMs ?? inferCacheTtl(config);
	if (typeof maxAgeMs !== "number") {
		throw new Error(
			`Strategy ${entry.id} is missing cacheTTLms. Provide cache.maxAgeMs or set cacheTTLms in the config.`
		);
	}
	const cache = entry.dependencies.createCache(
		options.cache.fetcher,
		options.cache.symbol,
		timeframes,
		maxAgeMs
	) as MultiTimeframeCache;
	if (options.cache.prefill ?? true) {
		await cache.refreshAll();
	}
	return {
		dependencies: { cache } as TDeps,
		cache,
	};
};

const extractTimeframes = (config: unknown): string[] => {
	if (!isRecord(config)) {
		return [];
	}
	const frames = config.timeframes;
	if (!frames || typeof frames !== "object") {
		return [];
	}
	return Array.from(
		new Set(
			Object.values(frames).filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0
			)
		)
	);
};

const inferCacheTtl = (config: unknown): number | undefined => {
	if (!isRecord(config)) {
		return undefined;
	}
	const ttl = config.cacheTTLms;
	return typeof ttl === "number" ? ttl : undefined;
};

const isRecord = (value: unknown): value is Record<string, any> => {
	return typeof value === "object" && value !== null;
};
