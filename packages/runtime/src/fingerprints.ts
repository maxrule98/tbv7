import fs from "node:fs";
import { createHash } from "node:crypto";
import {
	RiskConfig,
	StrategyConfig,
	canonicalize as coreCanonicalize,
	stableStringify as coreStableStringify,
	hashJson as coreHashJson,
	type CanonicalizeOptions,
} from "@agenai/core";
import type { LoadedRuntimeConfig } from "./loadRuntimeConfig";
import type { StrategyRuntimeMetadata } from "./runtimeFactory";

export type { CanonicalizeOptions } from "@agenai/core";

export type StrategyConfigFingerprint = string;
export type RuntimeContextFingerprint = string;

export interface StrategyRuntimeFingerprints {
	strategyConfigFingerprint: StrategyConfigFingerprint;
	runtimeContextFingerprint: RuntimeContextFingerprint;
}

export const canonicalize = (
	value: unknown,
	options?: CanonicalizeOptions
): unknown => coreCanonicalize(value, options);

export const stableStringify = (value: unknown): string =>
	coreStableStringify(value);

export const hashJson = (value: unknown, length?: number): string =>
	coreHashJson(value, length);

export const STRATEGY_FINGERPRINT_STRIP_KEYS = [
	"start",
	"end",
	"startTimestamp",
	"endTimestamp",
	"pollIntervalMs",
	"cacheLimit",
	"cacheTTLms",
	"strategyConfigFingerprint",
	"runtimeContextFingerprint",
];

export const canonicalizeStrategyConfig = (
	strategyConfig: StrategyConfig
): unknown =>
	canonicalize(strategyConfig, { stripKeys: STRATEGY_FINGERPRINT_STRIP_KEYS });

export const computeStrategyConfigFingerprint = (
	strategyConfig: StrategyConfig
): StrategyConfigFingerprint =>
	hashJson(canonicalizeStrategyConfig(strategyConfig));

const RISK_CONTEXT_KEYS: (keyof RiskConfig)[] = [
	"riskPerTradePercent",
	"maxPositions",
	"maxLeverage",
	"minPositionSize",
	"maxPositionSize",
	"slPct",
	"tpPct",
	"trailingActivationPct",
	"trailingTrailPct",
];

const buildWarmupObject = (
	warmup: StrategyRuntimeMetadata["warmupByTimeframe"]
): Record<string, number> => {
	const entries = Array.from(warmup.entries()).sort(([a], [b]) =>
		a.localeCompare(b)
	);
	return entries.reduce<Record<string, number>>((acc, [timeframe, candles]) => {
		acc[timeframe] = candles;
		return acc;
	}, {});
};

const buildRuntimeProfiles = (profiles: LoadedRuntimeConfig["profiles"]) => ({
	account: profiles.account ?? null,
	strategy: profiles.strategy ?? null,
	risk: profiles.risk ?? null,
	exchange: profiles.exchange ?? null,
});

const buildRuntimeRiskFragment = (risk: RiskConfig) => {
	const fragment: Record<string, unknown> = {};
	for (const key of RISK_CONTEXT_KEYS) {
		const value = risk[key];
		if (value !== undefined) {
			fragment[key] = value;
		}
	}
	return fragment;
};

const buildRuntimeTimeframes = (
	runtimeParams: StrategyRuntimeMetadata["runtimeParams"]
) => runtimeParams.timeframes ?? null;

const sortTrackedTimeframes = (
	tracked: StrategyRuntimeMetadata["trackedTimeframes"]
): string[] => Array.from(tracked).sort();

export const buildRuntimeContextCanonical = (
	runtimeConfig: LoadedRuntimeConfig,
	metadata: StrategyRuntimeMetadata,
	strategyConfigFingerprint: StrategyConfigFingerprint
): Record<string, unknown> => ({
	strategyId: runtimeConfig.strategyId,
	strategyConfigFingerprint,
	symbol: metadata.runtimeParams.symbol,
	executionTimeframe: metadata.runtimeParams.executionTimeframe,
	timeframes: buildRuntimeTimeframes(metadata.runtimeParams),
	trackedTimeframes: sortTrackedTimeframes(metadata.trackedTimeframes),
	warmupByTimeframe: buildWarmupObject(metadata.warmupByTimeframe),
	cacheLimit: metadata.cacheLimit,
	profiles: buildRuntimeProfiles(runtimeConfig.profiles),
	riskConfig: buildRuntimeRiskFragment(runtimeConfig.agenaiConfig.risk),
});

export const computeRuntimeContextFingerprint = (
	runtimeConfig: LoadedRuntimeConfig,
	metadata: StrategyRuntimeMetadata,
	strategyConfigFingerprint: StrategyConfigFingerprint
): {
	canonical: Record<string, unknown>;
	fingerprint: RuntimeContextFingerprint;
} => {
	const payload = buildRuntimeContextCanonical(
		runtimeConfig,
		metadata,
		strategyConfigFingerprint
	);
	const canonical = canonicalize(payload) as Record<string, unknown>;
	return {
		canonical,
		fingerprint: hashJson(canonical),
	};
};

export const computeConfigFileHash = (filePath?: string): string | null => {
	if (!filePath) {
		return null;
	}
	try {
		const buffer = fs.readFileSync(filePath);
		return createHash("sha1").update(buffer).digest("hex");
	} catch {
		return null;
	}
};

export const createFingerprintContext = (
	strategyConfigFingerprint: StrategyConfigFingerprint,
	runtimeContextFingerprint: RuntimeContextFingerprint
): StrategyRuntimeFingerprints => ({
	strategyConfigFingerprint,
	runtimeContextFingerprint,
});
