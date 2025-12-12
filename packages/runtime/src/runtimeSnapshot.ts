import { hashJson } from "@agenai/core";
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
	configFingerprint: string;
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

	return {
		config: runtimeConfig,
		metadata,
		configFingerprint: hashJson(runtimeConfig.strategyConfig),
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
