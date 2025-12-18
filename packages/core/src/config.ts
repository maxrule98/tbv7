import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import type { StrategyId } from "./strategies/types";
import { getStrategyDefinition } from "./strategies/registry";
export type { StrategyId } from "./strategies/types";

export interface StrategyConfig {
	id: StrategyId;
	symbol?: string;
	timeframes?: Record<string, string>;
	trackedTimeframes?: string[];
	warmupPeriods?: Record<string, number>;
	historyWindowCandles?: number;
	cacheTTLms?: number;
	[key: string]: unknown;
}

export type ConfigSourceType = "file" | "embedded" | "merged";

export interface ConfigMetadata {
	path?: string;
	source: ConfigSourceType;
	profile?: string;
}

const CONFIG_META_SYMBOL = Symbol.for("agenai.config.meta");

const readConfigMetadata = (config: unknown): ConfigMetadata | null => {
	if (!config || typeof config !== "object") {
		return null;
	}
	const meta = (config as Record<PropertyKey, unknown>)[
		CONFIG_META_SYMBOL as unknown as PropertyKey
	];
	return (meta as ConfigMetadata | undefined) ?? null;
};

const applyConfigMetadata = <T extends object>(
	config: T,
	metadata: ConfigMetadata
): T => {
	if (!config || typeof config !== "object") {
		return config;
	}
	const existing = readConfigMetadata(config) ?? {};
	const nextMeta: ConfigMetadata = {
		...existing,
		...metadata,
	};
	Object.defineProperty(config, CONFIG_META_SYMBOL, {
		value: nextMeta,
		enumerable: false,
		configurable: true,
		writable: true,
	});
	return config;
};

export const withConfigMetadata = <T extends object>(
	config: T,
	metadata: ConfigMetadata
): T => applyConfigMetadata(config, metadata);

export const getConfigMetadata = (config: unknown): ConfigMetadata | null =>
	readConfigMetadata(config);

let envLoaded = false;
let loadedEnvPath: string | undefined;
let cachedWorkspaceRoot: string | undefined;

const WORKSPACE_SENTINELS = ["pnpm-workspace.yaml", ".git"];

interface ExchangeConfigFile {
	exchange: string;
	market: string;
	testnet: boolean;
	restEndpoint: string;
	wsEndpoint: string;
	defaultSymbol: string;
}

type StrategyConfigFile = StrategyConfig;

interface RiskConfigFile {
	maxLeverage: number;
	riskPerTradePercent?: number;
	riskPerTradePct?: number;
	maxPositions: number;
	slPct: number;
	tpPct: number;
	minPositionSize?: number;
	maxPositionSize?: number;
	trailingActivationPct?: number;
	trailingTrailPct?: number;
}

interface AccountConfigFile {
	startingBalance: number;
}

const ensureNumber = (value: number | undefined, field: string): number => {
	if (typeof value !== "number" || Number.isNaN(value)) {
		throw new Error(`Required numeric field missing in ${field}`);
	}
	return value;
};

const resolveRiskPerTradePercent = (file: RiskConfigFile): number => {
	if (typeof file.riskPerTradePercent === "number") {
		return file.riskPerTradePercent;
	}
	if (typeof file.riskPerTradePct === "number") {
		return file.riskPerTradePct / 100;
	}
	throw new Error(
		"Risk config must define riskPerTradePercent or riskPerTradePct"
	);
};

export type ExecutionMode = "paper" | "live";

export interface EnvConfig {
	exchangeId: string;
	executionMode: ExecutionMode;
	mexcApiKey: string;
	mexcApiSecret: string;
	defaultSymbol: string;
	defaultTimeframe: string;
	signalVenue?: string;
	executionVenue?: string;
	signalTimeframes?: string[];
	executionTimeframe?: string;
}

export interface ExchangeConfig extends ExchangeConfigFile {
	id: string;
	credentials: {
		apiKey: string;
		apiSecret: string;
	};
}

// StrategyConfig interface declared near top
export interface RiskConfig {
	maxLeverage: number;
	riskPerTradePercent: number;
	maxPositions: number;
	slPct: number;
	tpPct: number;
	minPositionSize: number;
	maxPositionSize: number;
	trailingActivationPct: number;
	trailingTrailPct: number;
}
export type AccountConfig = AccountConfigFile;

export interface AgenaiConfig {
	env: EnvConfig;
	exchange: ExchangeConfig;
	strategy: StrategyConfig;
	risk: RiskConfig;
}

export interface ConfigLoadOptions {
	envPath?: string;
	configDir?: string;
	strategyDir?: string;
	exchangeProfile?: string;
	strategyProfile?: string;
	riskProfile?: string;
}

const findWorkspaceRoot = (): string => {
	if (cachedWorkspaceRoot) {
		return cachedWorkspaceRoot;
	}

	let current = process.cwd();

	while (
		!WORKSPACE_SENTINELS.some((file) => fs.existsSync(path.join(current, file)))
	) {
		const parent = path.dirname(current);
		if (parent === current) {
			cachedWorkspaceRoot = current;
			return current;
		}
		current = parent;
	}

	cachedWorkspaceRoot = current;
	return current;
};

export const getWorkspaceRoot = (): string => findWorkspaceRoot();

const getDefaultEnvPath = (): string => path.join(findWorkspaceRoot(), ".env");
const getDefaultConfigDir = (): string =>
	path.join(findWorkspaceRoot(), "config");
export const getDefaultStrategyDir = (): string => {
	const workspaceRoot = findWorkspaceRoot();
	const modernDir = path.join(workspaceRoot, "configs");
	if (fs.existsSync(path.join(modernDir, "strategies"))) {
		return modernDir;
	}
	return path.join(workspaceRoot, "config");
};

const getEnvVar = (key: string, fallback?: string): string => {
	const value = process.env[key];
	if (value !== undefined && value !== "") {
		return value;
	}
	if (fallback !== undefined) {
		return fallback;
	}
	throw new Error(`Missing required environment variable: ${key}`);
};

const readOptionalEnvVar = (key: string): string | undefined => {
	const value = process.env[key];
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
};

const parseTimeframeList = (value?: string): string[] | undefined => {
	if (!value) {
		return undefined;
	}
	const frames = value
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	return frames.length ? frames : undefined;
};

const normalizeExecutionMode = (value: string | undefined): ExecutionMode => {
	return value?.toLowerCase() === "live" ? "live" : "paper";
};

const readJsonFile = <T>(filePath: string): T => {
	const contents = fs.readFileSync(filePath, "utf-8");
	return JSON.parse(contents) as T;
};

export const loadEnvConfig = (envPath = getDefaultEnvPath()): EnvConfig => {
	if (!envLoaded || loadedEnvPath !== envPath) {
		dotenv.config({ path: envPath });
		envLoaded = true;
		loadedEnvPath = envPath;
	}

	return {
		exchangeId: getEnvVar("EXCHANGE_ID", "mexc"),
		executionMode: normalizeExecutionMode(getEnvVar("EXECUTION_MODE", "paper")),
		mexcApiKey: getEnvVar("MEXC_API_KEY", ""),
		mexcApiSecret: getEnvVar("MEXC_API_SECRET", ""),
		defaultSymbol: getEnvVar("DEFAULT_SYMBOL", ""),
		defaultTimeframe: getEnvVar("DEFAULT_TIMEFRAME", ""),
		signalVenue: readOptionalEnvVar("SIGNAL_VENUE"),
		executionVenue: readOptionalEnvVar("EXECUTION_VENUE"),
		signalTimeframes: parseTimeframeList(
			readOptionalEnvVar("SIGNAL_TIMEFRAMES")
		),
		executionTimeframe: readOptionalEnvVar("EXECUTION_TIMEFRAME"),
	};
};

export const loadExchangeConfig = (
	env: EnvConfig,
	configDir = getDefaultConfigDir(),
	exchangeProfile?: string
): ExchangeConfig => {
	const profile = exchangeProfile ?? env.exchangeId ?? "mexc";
	const exchangePath = path.join(configDir, "exchange", `${profile}.json`);
	const exchangeFile = readJsonFile<ExchangeConfigFile>(exchangePath);
	const credentials = {
		apiKey: env.mexcApiKey,
		apiSecret: env.mexcApiSecret,
	};
	return withConfigMetadata(
		{
			...exchangeFile,
			id: profile,
			testnet: exchangeFile.testnet,
			defaultSymbol: env.defaultSymbol || exchangeFile.defaultSymbol,
			credentials,
		},
		{
			source: "file",
			path: exchangePath,
			profile,
		}
	);
};

export const resolveStrategyConfigPath = (
	strategyDir: string,
	strategyProfile: string
): string => {
	const profileName = strategyProfile.endsWith(".json")
		? strategyProfile
		: `${strategyProfile}.json`;
	const candidates = [
		path.join(strategyDir, "strategies", profileName),
		path.join(strategyDir, profileName),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(
		`Strategy config not found. Looked for ${candidates.join(", ")}`
	);
};

export const loadStrategyConfig = (
	strategyDir = getDefaultStrategyDir(),
	strategyProfile = "vwap-delta-gamma"
): StrategyConfig => {
	const strategyPath = resolveStrategyConfigPath(strategyDir, strategyProfile);
	const file = readJsonFile<StrategyConfigFile>(strategyPath);
	const strategyId = file.id as StrategyId | undefined;
	if (!strategyId) {
		throw new Error(
			`Strategy config at ${strategyPath} must include an "id" property.`
		);
	}
	getStrategyDefinition(strategyId);
	return withConfigMetadata(
		{
			...file,
			id: strategyId,
		},
		{
			source: "file",
			path: strategyPath,
			profile: strategyProfile,
		}
	);
};

export const loadRiskConfig = (
	configDir = getDefaultConfigDir(),
	riskProfile = "default"
): RiskConfig => {
	const riskPath = path.join(configDir, "risk", `${riskProfile}.json`);
	const file = readJsonFile<RiskConfigFile>(riskPath);
	return withConfigMetadata(
		{
			maxLeverage: ensureNumber(file.maxLeverage, "risk.maxLeverage"),
			riskPerTradePercent: resolveRiskPerTradePercent(file),
			maxPositions: ensureNumber(file.maxPositions, "risk.maxPositions"),
			slPct: ensureNumber(file.slPct, "risk.slPct"),
			tpPct: ensureNumber(file.tpPct, "risk.tpPct"),
			minPositionSize: ensureNumber(
				file.minPositionSize,
				"risk.minPositionSize"
			),
			maxPositionSize: ensureNumber(
				file.maxPositionSize,
				"risk.maxPositionSize"
			),
			trailingActivationPct: ensureNumber(
				file.trailingActivationPct,
				"risk.trailingActivationPct"
			),
			trailingTrailPct: ensureNumber(
				file.trailingTrailPct,
				"risk.trailingTrailPct"
			),
		},
		{
			source: "file",
			path: riskPath,
			profile: riskProfile,
		}
	);
};

export const loadAccountConfig = (
	configDir = getDefaultConfigDir(),
	accountProfile = "paper"
): AccountConfig => {
	const accountPath = path.join(configDir, "account", `${accountProfile}.json`);
	return withConfigMetadata(readJsonFile<AccountConfigFile>(accountPath), {
		source: "file",
		path: accountPath,
		profile: accountProfile,
	});
};

export const loadAgenaiConfig = (
	options: ConfigLoadOptions = {}
): AgenaiConfig => {
	const workspaceRoot = findWorkspaceRoot();
	const envPath = options.envPath ?? path.join(workspaceRoot, ".env");
	const configDir = options.configDir ?? path.join(workspaceRoot, "config");
	const strategyDir =
		options.strategyDir ??
		(options.configDir ? options.configDir : getDefaultStrategyDir());
	const env = loadEnvConfig(envPath);
	return {
		env,
		exchange: loadExchangeConfig(env, configDir, options.exchangeProfile),
		strategy: loadStrategyConfig(strategyDir, options.strategyProfile),
		risk: loadRiskConfig(configDir, options.riskProfile),
	};
};
