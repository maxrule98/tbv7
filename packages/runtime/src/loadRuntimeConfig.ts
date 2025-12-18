import fs from "node:fs";
import path from "node:path";
import {
	AccountConfig,
	AgenaiConfig,
	ConfigLoadOptions,
	ConfigMetadata,
	EnvConfig,
	StrategyConfig,
	StrategyId,
	StrategyRuntimeParams,
	StrategySelectionResult,
	assertStrategyRuntimeParams,
	getConfigMetadata,
	getStrategyDefinition,
	getWorkspaceRoot,
	getDefaultStrategyDir,
	loadAccountConfig,
	loadAgenaiConfig,
	resolveStrategySelection,
	withConfigMetadata,
} from "@agenai/core";
import { timeframeToMs } from "@agenai/data";

export interface RuntimeProfileMetadata {
	account?: string;
	strategy?: string;
	risk?: string;
	exchange?: string;
}

export interface LoadRuntimeConfigOptions extends ConfigLoadOptions {
	accountProfile?: string;
	requestedStrategyId?: string;
	envStrategyId?: string;
	agenaiConfig?: AgenaiConfig;
	accountConfig?: AccountConfig;
	cwd?: string;
	workspaceRoot?: string;
	signalVenue?: string;
	executionVenue?: string;
	signalTimeframes?: string[];
	executionTimeframe?: string;
}

export interface VenueSelection {
	signalVenue: string;
	executionVenue: string;
	signalTimeframes: string[];
	executionTimeframe: string;
}

export interface LoadedRuntimeConfig {
	agenaiConfig: AgenaiConfig;
	accountConfig: AccountConfig;
	strategyConfig: StrategyConfig;
	strategyId: StrategyId;
	runtimeParams: StrategyRuntimeParams;
	selection: StrategySelectionResult;
	profiles: RuntimeProfileMetadata;
	resolution: RuntimeConfigResolutionTrace;
	venues: VenueSelection;
}

export interface RuntimeResolvedPathSummary {
	absolute: string;
	relativeToWorkspace: string;
	relativeToCwd: string;
}

export interface RuntimeConfigResolutionTrace {
	cwd: string;
	workspaceRoot: string;
	envPath: RuntimeResolvedPathSummary;
	configDir: RuntimeResolvedPathSummary;
	strategyDir: RuntimeResolvedPathSummary;
	accountConfigPath?: RuntimeResolvedPathSummary;
	strategyConfigPath?: RuntimeResolvedPathSummary;
	riskConfigPath?: RuntimeResolvedPathSummary;
	exchangeConfigPath?: RuntimeResolvedPathSummary;
}

const normalizeRelative = (value: string): string =>
	value === "" ? "." : value;

const summarizePath = (
	workspaceRoot: string,
	cwd: string,
	absolutePath: string
): RuntimeResolvedPathSummary => ({
	absolute: absolutePath,
	relativeToWorkspace: normalizeRelative(
		path.relative(workspaceRoot, absolutePath)
	),
	relativeToCwd: normalizeRelative(path.relative(cwd, absolutePath)),
});

const summarizeOptionalPath = (
	workspaceRoot: string,
	cwd: string,
	pathValue?: string | null
): RuntimeResolvedPathSummary | undefined => {
	if (!pathValue) {
		return undefined;
	}
	return summarizePath(workspaceRoot, cwd, path.resolve(pathValue));
};

const ensureDirectoryExists = (label: string, directory: string): void => {
	try {
		const stats = fs.statSync(directory);
		if (!stats.isDirectory()) {
			throw new Error(
				`Cannot load runtime config: ${label} is not a directory (${directory})`
			);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(
				`Cannot load runtime config: missing ${label} at ${directory}`
			);
		}
		throw error;
	}
};

const ensureConfigMeta = <T extends object>(
	config: T,
	metadata: ConfigMetadata
): T => {
	return getConfigMetadata(config)
		? config
		: withConfigMetadata(config, metadata);
};

export const loadRuntimeConfig = (
	options: LoadRuntimeConfigOptions = {}
): LoadedRuntimeConfig => {
	const cwd = path.resolve(options.cwd ?? process.cwd());
	const workspaceRoot = path.resolve(
		options.workspaceRoot ?? getWorkspaceRoot()
	);
	const envPath = path.resolve(
		options.envPath ?? path.join(workspaceRoot, ".env")
	);
	const configDir = path.resolve(
		options.configDir ?? path.join(workspaceRoot, "config")
	);
	const strategyDirSource =
		options.strategyDir ?? options.configDir ?? getDefaultStrategyDir();
	const strategyDir = path.resolve(strategyDirSource);

	ensureDirectoryExists("workspace root", workspaceRoot);
	ensureDirectoryExists("config directory", configDir);
	ensureDirectoryExists("strategy directory", strategyDir);
	ensureDirectoryExists("risk config directory", path.join(configDir, "risk"));
	ensureDirectoryExists(
		"exchange config directory",
		path.join(configDir, "exchange")
	);
	ensureDirectoryExists(
		"account config directory",
		path.join(configDir, "account")
	);

	const agenaiConfig =
		options.agenaiConfig ??
		loadAgenaiConfig({
			envPath,
			configDir,
			strategyDir,
			exchangeProfile: options.exchangeProfile,
			strategyProfile: options.strategyProfile,
			riskProfile: options.riskProfile,
		});

	agenaiConfig.strategy = ensureConfigMeta(agenaiConfig.strategy, {
		source: "embedded",
		profile: options.strategyProfile,
	});
	agenaiConfig.risk = ensureConfigMeta(agenaiConfig.risk, {
		source: "embedded",
		profile: options.riskProfile,
	});

	const accountProfile = options.accountProfile ?? "paper";
	const accountConfig =
		options.accountConfig ?? loadAccountConfig(configDir, accountProfile);

	const selection = resolveStrategySelection({
		requestedValue: options.requestedStrategyId,
		envValue: options.envStrategyId ?? process.env.TRADER_STRATEGY,
		defaultStrategyId: agenaiConfig.strategy.id as StrategyId,
	});

	let strategyConfig = agenaiConfig.strategy as StrategyConfig;
	if (selection.resolvedStrategyId !== strategyConfig.id) {
		const definition = getStrategyDefinition<StrategyConfig>(
			selection.resolvedStrategyId
		);
		strategyConfig = ensureConfigMeta(definition.loadConfig(), {
			source: "embedded",
			profile: definition.defaultProfile,
		});
		agenaiConfig.strategy = strategyConfig;
	}

	const runtimeParams = assertStrategyRuntimeParams(strategyConfig);
	const trackedTimeframes = extractTrackedTimeframes(strategyConfig);
	const venues = resolveVenueSelection({
		env: agenaiConfig.env,
		runtimeParams,
		trackedTimeframes,
		overrides: {
			signalVenue: options.signalVenue,
			executionVenue: options.executionVenue,
			signalTimeframes: options.signalTimeframes,
			executionTimeframe: options.executionTimeframe,
		},
	});
	const resolution: RuntimeConfigResolutionTrace = {
		cwd,
		workspaceRoot,
		envPath: summarizePath(workspaceRoot, cwd, envPath),
		configDir: summarizePath(workspaceRoot, cwd, configDir),
		strategyDir: summarizePath(workspaceRoot, cwd, strategyDir),
		accountConfigPath: summarizeOptionalPath(
			workspaceRoot,
			cwd,
			getConfigMetadata(accountConfig)?.path
		),
		strategyConfigPath: summarizeOptionalPath(
			workspaceRoot,
			cwd,
			getConfigMetadata(strategyConfig)?.path
		),
		riskConfigPath: summarizeOptionalPath(
			workspaceRoot,
			cwd,
			getConfigMetadata(agenaiConfig.risk)?.path
		),
		exchangeConfigPath: summarizeOptionalPath(
			workspaceRoot,
			cwd,
			getConfigMetadata(agenaiConfig.exchange)?.path
		),
	};

	return {
		agenaiConfig,
		accountConfig,
		strategyConfig,
		strategyId: selection.resolvedStrategyId,
		runtimeParams,
		selection,
		profiles: {
			account: accountProfile,
			strategy: options.strategyProfile,
			risk: options.riskProfile,
			exchange: options.exchangeProfile,
		},
		resolution,
		venues,
	};
};

interface VenueResolutionOptions {
	env: EnvConfig;
	runtimeParams: StrategyRuntimeParams;
	trackedTimeframes: string[];
	overrides?: {
		signalVenue?: string;
		executionVenue?: string;
		signalTimeframes?: string[];
		executionTimeframe?: string;
	};
}

const normalizeVenue = (
	value: string | undefined,
	fallback: string
): string => {
	if (!value) {
		return fallback;
	}
	return value.trim().toLowerCase();
};
const extractTrackedTimeframes = (strategyConfig: StrategyConfig): string[] => {
	const frames = new Set<string>();
	const addFrame = (value?: string): void => {
		if (typeof value === "string" && value.trim().length > 0) {
			frames.add(value.trim());
		}
	};
	const configTimeframes = (
		strategyConfig as { timeframes?: Record<string, string> }
	).timeframes;
	if (configTimeframes) {
		Object.values(configTimeframes).forEach(addFrame);
	}
	const trackedTimeframes = (strategyConfig as { trackedTimeframes?: unknown })
		.trackedTimeframes;
	if (Array.isArray(trackedTimeframes)) {
		trackedTimeframes.forEach(addFrame);
	}
	return Array.from(frames);
};

const normalizeTimeframes = (
	requested: string[] | undefined,
	envValue: string[] | undefined,
	runtimeDefault: string
): string[] => {
	const source = requested?.length
		? requested
		: envValue?.length
			? envValue
			: [runtimeDefault];
	const unique = Array.from(
		new Set(
			source.map((frame) => frame.trim()).filter((frame) => frame.length > 0)
		)
	);
	if (!unique.includes(runtimeDefault)) {
		unique.push(runtimeDefault);
	}
	return unique;
};

const mergeAndSortTimeframes = (
	requested: string[],
	trackedTimeframes: string[],
	executionTimeframe: string
): string[] => {
	const merged = new Set<string>();
	for (const tf of requested) {
		if (tf && tf.trim().length > 0) {
			merged.add(tf.trim());
		}
	}
	for (const tf of trackedTimeframes) {
		if (tf && tf.trim().length > 0) {
			merged.add(tf.trim());
		}
	}
	if (executionTimeframe && executionTimeframe.trim().length > 0) {
		merged.add(executionTimeframe.trim());
	}
	const sorted = Array.from(merged).sort((a, b) => {
		try {
			return timeframeToMs(a) - timeframeToMs(b);
		} catch {
			return a.localeCompare(b);
		}
	});
	return sorted;
};

const resolveVenueSelection = (
	options: VenueResolutionOptions
): VenueSelection => {
	const defaultVenue = options.env.exchangeId?.toLowerCase() ?? "mexc";
	const defaultSignalVenue =
		options.env.signalVenue?.toLowerCase() ?? "binance";
	const defaultExecutionVenue =
		options.env.executionVenue?.toLowerCase() ?? defaultVenue;
	const signalVenue = normalizeVenue(
		options.overrides?.signalVenue ?? options.env.signalVenue,
		defaultSignalVenue
	);
	const executionVenue = normalizeVenue(
		options.overrides?.executionVenue ?? options.env.executionVenue,
		defaultExecutionVenue
	);
	const requestedTimeframes = normalizeTimeframes(
		options.overrides?.signalTimeframes,
		options.env.signalTimeframes,
		options.runtimeParams.executionTimeframe
	);
	const signalTimeframes = mergeAndSortTimeframes(
		requestedTimeframes,
		options.trackedTimeframes,
		options.runtimeParams.executionTimeframe
	);
	const executionTimeframe =
		options.overrides?.executionTimeframe ??
		options.env.executionTimeframe ??
		options.runtimeParams.executionTimeframe;
	return {
		signalVenue,
		executionVenue,
		signalTimeframes,
		executionTimeframe,
	};
};
