import type { StrategyConfig, StrategyRuntimeParams } from "@agenai/core";
import { assertStrategyRuntimeParams } from "@agenai/core";
import type { TraderStrategy } from "./types";
import type { StrategySource } from "./runtimeShared";

export type WarmupMap = Map<string, number>;

export interface StrategyRuntimeMetadata {
	runtimeParams: StrategyRuntimeParams;
	trackedTimeframes: string[];
	warmupByTimeframe: WarmupMap;
	cacheLimit: number;
}

export interface CreateStrategyRuntimeOptions {
	strategyConfig: StrategyConfig;
	strategyOverride?: TraderStrategy;
	builder?: StrategyRuntimeBuilder;
	builderName?: string;
	instrument?: {
		symbol?: string;
		timeframe?: string;
	};
	maxCandlesOverride?: number;
	metadata?: StrategyRuntimeMetadata;
}

export interface StrategyRuntimeBuilderContext extends StrategyRuntimeMetadata {
	strategyConfig: StrategyConfig;
}

export type StrategyRuntimeBuilder = (
	context: StrategyRuntimeBuilderContext
) => Promise<TraderStrategy>;

export interface StrategyRuntimeArtifacts extends StrategyRuntimeMetadata {
	strategy: TraderStrategy;
	source: StrategySource;
	builderName?: string;
}

export const createStrategyRuntime = async (
	options: CreateStrategyRuntimeOptions
): Promise<StrategyRuntimeArtifacts> => {
	const metadata =
		options.metadata ??
		resolveStrategyRuntimeMetadata(options.strategyConfig, {
			instrument: options.instrument,
			maxCandlesOverride: options.maxCandlesOverride,
		});

	const strategySource: StrategySource = options.strategyOverride
		? "override"
		: "builder";

	const strategy = options.strategyOverride
		? options.strategyOverride
		: await buildStrategy(options, metadata);

	return {
		...metadata,
		strategy,
		source: strategySource,
		builderName: options.builderName,
	};
};

const buildStrategy = async (
	opts: CreateStrategyRuntimeOptions,
	metadata: StrategyRuntimeMetadata
): Promise<TraderStrategy> => {
	if (!opts.builder) {
		throw new Error(
			"Strategy builder not provided. Pass a builder or a strategyOverride."
		);
	}
	return opts.builder({
		...metadata,
		strategyConfig: opts.strategyConfig,
	});
};

export interface ResolveStrategyRuntimeOptions {
	instrument?: {
		symbol?: string;
		timeframe?: string;
	};
	maxCandlesOverride?: number;
}

export const resolveStrategyRuntimeMetadata = (
	strategyConfig: StrategyConfig,
	options: ResolveStrategyRuntimeOptions = {}
): StrategyRuntimeMetadata => {
	const runtimeParams = normalizeRuntimeParams(
		strategyConfig,
		options.instrument
	);
	const trackedTimeframes = collectStrategyTimeframes(
		runtimeParams,
		strategyConfig,
		runtimeParams.executionTimeframe
	);
	const warmupByTimeframe = deriveWarmupCandles(
		strategyConfig,
		trackedTimeframes
	);
	const cacheLimit = determineCacheLimit(
		strategyConfig,
		warmupByTimeframe,
		options.maxCandlesOverride
	);
	return {
		runtimeParams,
		trackedTimeframes,
		warmupByTimeframe,
		cacheLimit,
	};
};

const normalizeRuntimeParams = (
	strategyConfig: StrategyConfig,
	override?: { symbol?: string; timeframe?: string }
): StrategyRuntimeParams => {
	const runtime = assertStrategyRuntimeParams(strategyConfig);
	return {
		...runtime,
		symbol: override?.symbol ?? runtime.symbol,
		executionTimeframe: override?.timeframe ?? runtime.executionTimeframe,
	};
};

export const collectStrategyTimeframes = (
	runtimeParams: StrategyRuntimeParams,
	strategyConfig: StrategyConfig,
	executionTimeframe: string
): string[] => {
	const frames = new Set<string>();
	const addFrame = (value?: string): void => {
		if (typeof value !== "string") {
			return;
		}
		const trimmed = value.trim();
		if (trimmed.length) {
			frames.add(trimmed);
		}
	};

	addFrame(runtimeParams.executionTimeframe);
	addFrame(executionTimeframe);
	Object.values(runtimeParams.timeframes).forEach(addFrame);

	const configTimeframes = (
		strategyConfig as {
			timeframes?: Record<string, string>;
		}
	).timeframes;
	if (configTimeframes) {
		Object.values(configTimeframes).forEach(addFrame);
	}

	const tracked = (strategyConfig as { trackedTimeframes?: unknown })
		.trackedTimeframes;
	if (Array.isArray(tracked)) {
		tracked.forEach(addFrame);
	}

	return Array.from(frames);
};

export const deriveWarmupCandles = (
	strategyConfig: StrategyConfig,
	trackedTimeframes: string[]
): WarmupMap => {
	const warmup = new Map<string, number>();
	const warmupConfig = (
		strategyConfig as {
			warmupPeriods?: Record<string, number>;
		}
	).warmupPeriods;
	const defaultWarmup = asNonNegativeInteger(warmupConfig?.default) ?? 0;

	for (const timeframe of trackedTimeframes) {
		const configuredValue = warmupConfig?.[timeframe];
		const candles = asNonNegativeInteger(configuredValue) ?? defaultWarmup;
		warmup.set(timeframe, candles);
	}

	return warmup;
};

export const determineCacheLimit = (
	strategyConfig: StrategyConfig,
	warmupByTimeframe: WarmupMap,
	maxCandlesOverride?: number
): number => {
	let warmupMax = 0;
	for (const value of warmupByTimeframe.values()) {
		warmupMax = Math.max(warmupMax, value);
	}
	const historyWindow = asPositiveInteger(
		(strategyConfig as { historyWindowCandles?: number }).historyWindowCandles
	);
	const overrideLimit = asPositiveInteger(maxCandlesOverride);
	const fallback = warmupMax > 0 ? warmupMax : 1;
	const candidate = overrideLimit ?? historyWindow ?? fallback;
	return Math.max(candidate, fallback);
};

const asNonNegativeInteger = (value?: number): number | undefined => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	const normalized = Math.floor(value);
	return normalized >= 0 ? normalized : undefined;
};

const asPositiveInteger = (value?: number): number | undefined => {
	const normalized = asNonNegativeInteger(value);
	if (normalized === undefined || normalized === 0) {
		return undefined;
	}
	return normalized;
};
