import {
	loadRuntimeConfig,
	type LoadRuntimeConfigOptions,
	type LoadedRuntimeConfig,
} from "./loadRuntimeConfig";
import {
	createStrategyRuntime,
	resolveStrategyRuntimeMetadata,
	type StrategyRuntimeArtifacts,
	type StrategyRuntimeBuilder,
	type StrategyRuntimeMetadata,
} from "./runtimeFactory";
import type { TraderStrategy } from "./types";
import {
	createRuntimeFingerprintCache,
	type RuntimeFingerprintCache,
} from "./runtimeFingerprint";

export interface RuntimeSnapshotOptions extends LoadRuntimeConfigOptions {
	runtimeConfig?: LoadedRuntimeConfig;
	instrument?: {
		symbol?: string;
		timeframe?: string;
	};
	maxCandlesOverride?: number;
}

export interface RuntimeSnapshot {
	config: LoadedRuntimeConfig;
	metadata: StrategyRuntimeMetadata;
	strategyConfigFingerprint: string;
	runtimeContextFingerprint: string;
	riskConfigFingerprint: string;
	strategyConfigPath?: string;
	riskConfigPath?: string;
	strategyConfigFileHash?: string | null;
	riskConfigFileHash?: string | null;
	fingerprintCache: RuntimeFingerprintCache;
	resolution: LoadedRuntimeConfig["resolution"];
}

export interface CreateRuntimeOptions {
	builder?: StrategyRuntimeBuilder;
	builderName?: string;
	strategyOverride?: TraderStrategy;
}

export const createRuntimeSnapshot = (
	options: RuntimeSnapshotOptions = {}
): RuntimeSnapshot => {
	const runtimeConfig = options.runtimeConfig ?? loadRuntimeConfig(options);
	const metadata = resolveStrategyRuntimeMetadata(
		runtimeConfig.strategyConfig,
		{
			instrument: options.instrument,
			maxCandlesOverride: options.maxCandlesOverride,
		}
	);
	const fingerprintCache = createRuntimeFingerprintCache(
		runtimeConfig,
		metadata
	);

	return {
		config: runtimeConfig,
		metadata,
		strategyConfigFingerprint: fingerprintCache.strategy.fingerprint,
		runtimeContextFingerprint: fingerprintCache.runtimeContext.fingerprint,
		riskConfigFingerprint: fingerprintCache.risk.fingerprint,
		strategyConfigPath: fingerprintCache.strategy.path,
		riskConfigPath: fingerprintCache.risk.path,
		strategyConfigFileHash: fingerprintCache.strategy.fileHash ?? null,
		riskConfigFileHash: fingerprintCache.risk.fileHash ?? null,
		fingerprintCache,
		resolution: runtimeConfig.resolution,
	};
};

export const createRuntime = async (
	snapshot: RuntimeSnapshot,
	options: CreateRuntimeOptions = {}
): Promise<StrategyRuntimeArtifacts> => {
	return createStrategyRuntime({
		strategyConfig: snapshot.config.strategyConfig,
		metadata: snapshot.metadata,
		builder: options.builder,
		builderName: options.builderName,
		strategyOverride: options.strategyOverride,
	});
};
