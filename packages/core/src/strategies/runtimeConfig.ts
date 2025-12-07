import type { StrategyConfig } from "../config";
import type { StrategyId } from "./types";
import { getStrategyDefinition } from "./registry";

export interface StrategyRuntimeParams {
	strategyId: StrategyId;
	symbol: string;
	timeframes: Record<string, string>;
	executionTimeframe: string;
}

interface ManifestLike {
	defaultPair?: string;
	timeframes?: Record<string, string>;
	defaultTimeframes?: Record<string, string>;
}

const extractManifestDefaults = (
	strategyId: StrategyId
): { symbol?: string; timeframes: Record<string, string> } => {
	const definition = getStrategyDefinition(strategyId);
	const manifest = definition.manifest as ManifestLike;
	const manifestTimeframes =
		manifest.timeframes ?? manifest.defaultTimeframes ?? {};
	return {
		symbol: manifest.defaultPair,
		timeframes: filterStringMap(manifestTimeframes),
	};
};

const filterStringMap = (
	input?: Record<string, unknown>
): Record<string, string> => {
	if (!input) {
		return {};
	}
	return Object.entries(input).reduce<Record<string, string>>(
		(acc, [key, value]) => {
			if (typeof value === "string" && value.length > 0) {
				acc[key] = value;
			}
			return acc;
		},
		{}
	);
};

const extractConfigTimeframes = (
	config: StrategyConfig
): Record<string, string> => {
	const candidate = (config as { timeframes?: Record<string, unknown> })
		.timeframes;
	return filterStringMap(candidate);
};

export const resolveStrategyRuntimeParams = (
	strategyConfig: StrategyConfig
): StrategyRuntimeParams => {
	const manifestDefaults = extractManifestDefaults(strategyConfig.id);
	const configTimeframes = extractConfigTimeframes(strategyConfig);
	const timeframes = {
		...manifestDefaults.timeframes,
		...configTimeframes,
	};

	const executionTimeframe = timeframes.execution ?? "";
	const symbol =
		sanitiseSymbol((strategyConfig as { symbol?: string }).symbol) ??
		sanitiseSymbol(manifestDefaults.symbol) ??
		"";

	return {
		strategyId: strategyConfig.id,
		symbol,
		timeframes,
		executionTimeframe,
	};
};

const sanitiseSymbol = (value?: string): string | undefined => {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
};

export const assertStrategyRuntimeParams = (
	strategyConfig: StrategyConfig
): StrategyRuntimeParams => {
	const runtime = resolveStrategyRuntimeParams(strategyConfig);
	const missing: string[] = [];
	if (!runtime.symbol) {
		missing.push("symbol");
	}
	if (!runtime.executionTimeframe) {
		missing.push("execution timeframe");
	}
	if (missing.length) {
		throw new Error(
			`Strategy config for ${runtime.strategyId} is missing required fields: ${missing.join(
				", "
			)}. Update the config file to include these values.`
		);
	}
	return runtime;
};
