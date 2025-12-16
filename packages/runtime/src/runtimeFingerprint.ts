import { Buffer } from "node:buffer";
import {
	ConfigSourceType,
	StrategyConfig,
	type RiskConfig,
	getConfigMetadata,
} from "@agenai/core";
import type {
	LoadedRuntimeConfig,
	RuntimeProfileMetadata,
	RuntimeConfigResolutionTrace,
} from "./loadRuntimeConfig";
import type { StrategyRuntimeMetadata } from "./runtimeFactory";
import type { RuntimeSnapshot } from "./runtimeSnapshot";
import {
	canonicalize,
	canonicalizeStrategyConfig,
	computeConfigFileHash,
	computeRuntimeContextFingerprint,
	hashJson,
	stableStringify,
} from "./fingerprints";

interface FingerprintSection {
	canonical: unknown;
	canonicalJson: string;
	fingerprint: string;
	byteLength: number;
	keys: string[];
}

export interface ConfigFingerprintSection extends FingerprintSection {
	path?: string;
	source: ConfigSourceType;
	profile?: string;
	fileHash?: string | null;
}

export interface RuntimeFingerprintCache {
	strategy: ConfigFingerprintSection;
	risk: ConfigFingerprintSection;
	runtimeContext: FingerprintSection;
}

interface ConfigMetaSummary {
	path?: string;
	source: ConfigSourceType;
	profile?: string;
	fileHash?: string | null;
}

const fingerprintSectionFromCanonical = (
	canonical: unknown,
	precomputed?: string
): FingerprintSection => {
	const canonicalJson = stableStringify(canonical);
	const fingerprint = precomputed ?? hashJson(canonical);
	const byteLength = Buffer.byteLength(canonicalJson, "utf8");
	const keys =
		canonical && typeof canonical === "object" && !Array.isArray(canonical)
			? Object.keys(canonical as Record<string, unknown>).sort()
			: [];
	return { canonical, canonicalJson, fingerprint, byteLength, keys };
};

const fingerprintSection = (value: unknown): FingerprintSection => {
	const canonical = canonicalize(value);
	return fingerprintSectionFromCanonical(canonical);
};

const summarizeConfigMeta = (
	config: StrategyConfig | RiskConfig,
	fallbackSource: ConfigSourceType
): ConfigMetaSummary => {
	const meta = getConfigMetadata(config);
	const path = meta?.path;
	return {
		path,
		source: meta?.source ?? fallbackSource,
		profile: meta?.profile,
		fileHash: computeConfigFileHash(path),
	};
};

export const createRuntimeFingerprintCache = (
	runtimeConfig: LoadedRuntimeConfig,
	metadata: StrategyRuntimeMetadata
): RuntimeFingerprintCache => {
	const canonicalStrategy = canonicalizeStrategyConfig(
		runtimeConfig.strategyConfig
	);
	const strategySection = fingerprintSectionFromCanonical(canonicalStrategy);
	const riskSection = fingerprintSection(runtimeConfig.agenaiConfig.risk);
	const runtimeFingerprint = computeRuntimeContextFingerprint(
		runtimeConfig,
		metadata,
		strategySection.fingerprint
	);
	return {
		strategy: {
			...strategySection,
			...summarizeConfigMeta(runtimeConfig.strategyConfig, "embedded"),
		},
		risk: {
			...riskSection,
			...summarizeConfigMeta(runtimeConfig.agenaiConfig.risk, "embedded"),
		},
		runtimeContext: fingerprintSectionFromCanonical(
			runtimeFingerprint.canonical,
			runtimeFingerprint.fingerprint
		),
	};
};

export interface RuntimeFingerprintLogPayload {
	strategyConfigPath?: string;
	strategyConfigSource: ConfigSourceType;
	strategyConfigProfile?: string;
	strategyConfigFileHash?: string | null;
	strategyConfigResolvedFrom: {
		source: "cli" | "env" | "default";
		requestedValue: string | null;
		envValue: string | null;
		resolvedStrategyId: string;
	};
	riskConfigPath?: string;
	riskConfigSource: ConfigSourceType;
	riskConfigProfile?: string;
	riskConfigFileHash?: string | null;
	riskConfigResolvedFrom: {
		source: "profile" | "default";
		profile: string | null;
	};
	strategyConfigFingerprint: string;
	riskConfigFingerprint: string;
	runtimeContextFingerprint: string;
	strategyConfigByteLength: number;
	riskConfigByteLength: number;
	runtimeContextByteLength: number;
	canonicalStrategyConfigKeys: string[];
	canonicalRiskConfigKeys: string[];
	canonicalStrategyConfig: unknown;
	canonicalRiskConfig: unknown;
	canonicalRuntimeContext: Record<string, unknown>;
	runtimeConfigResolution: RuntimeConfigResolutionTrace;
	profilesUsed: RuntimeProfileMetadata;
}

const normalizeProfiles = (
	profiles: RuntimeProfileMetadata
): RuntimeProfileMetadata => ({
	account: profiles.account ?? undefined,
	strategy: profiles.strategy ?? undefined,
	risk: profiles.risk ?? undefined,
	exchange: profiles.exchange ?? undefined,
});

const resolveStrategyConfigProvenance = (
	snapshot: RuntimeSnapshot
): RuntimeFingerprintLogPayload["strategyConfigResolvedFrom"] => {
	const selection = snapshot.config.selection;
	const source: RuntimeFingerprintLogPayload["strategyConfigResolvedFrom"]["source"] =
		selection.requestedId ? "cli" : selection.envId ? "env" : "default";
	return {
		source,
		requestedValue: selection.requestedValue ?? null,
		envValue: selection.envValue ?? null,
		resolvedStrategyId: selection.resolvedStrategyId,
	};
};

const resolveRiskConfigProvenance = (
	snapshot: RuntimeSnapshot
): RuntimeFingerprintLogPayload["riskConfigResolvedFrom"] => {
	const profile = snapshot.config.profiles.risk ?? null;
	const source: RuntimeFingerprintLogPayload["riskConfigResolvedFrom"]["source"] =
		profile ? "profile" : "default";
	return {
		source,
		profile,
	};
};

export const buildRuntimeFingerprintLogPayload = (
	snapshot: RuntimeSnapshot
): RuntimeFingerprintLogPayload => {
	const cache = snapshot.fingerprintCache;
	const strategySource = resolveStrategyConfigProvenance(snapshot);
	return {
		strategyConfigPath: cache.strategy.path,
		strategyConfigSource: cache.strategy.source,
		strategyConfigProfile: cache.strategy.profile,
		strategyConfigFileHash: cache.strategy.fileHash ?? null,
		strategyConfigResolvedFrom: strategySource,
		riskConfigPath: cache.risk.path,
		riskConfigSource: cache.risk.source,
		riskConfigProfile: cache.risk.profile,
		riskConfigFileHash: cache.risk.fileHash ?? null,
		riskConfigResolvedFrom: resolveRiskConfigProvenance(snapshot),
		strategyConfigFingerprint: cache.strategy.fingerprint,
		riskConfigFingerprint: cache.risk.fingerprint,
		runtimeContextFingerprint: cache.runtimeContext.fingerprint,
		strategyConfigByteLength: cache.strategy.byteLength,
		riskConfigByteLength: cache.risk.byteLength,
		runtimeContextByteLength: cache.runtimeContext.byteLength,
		canonicalStrategyConfigKeys: cache.strategy.keys,
		canonicalRiskConfigKeys: cache.risk.keys,
		canonicalStrategyConfig: cache.strategy.canonical,
		canonicalRiskConfig: cache.risk.canonical,
		canonicalRuntimeContext:
			(cache.runtimeContext.canonical as Record<string, unknown>) ?? {},
		runtimeConfigResolution: snapshot.resolution,
		profilesUsed: normalizeProfiles(snapshot.config.profiles),
	};
};
