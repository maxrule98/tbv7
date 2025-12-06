import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import type { StrategyId } from "./strategies/ids";
import type { VWAPDeltaGammaConfig } from "./strategies/vwap-delta-gamma/config";
import type { UltraAggressiveBtcUsdtConfig } from "./strategies/ultra-aggressive-btc-usdt/config";
export type { StrategyId } from "./strategies/ids";

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

type VwapStrategyConfigFile = VWAPDeltaGammaConfig & {
	id?: StrategyId;
	symbol?: string;
};

type UltraAggressiveStrategyConfigFile = UltraAggressiveBtcUsdtConfig & {
	id?: StrategyId;
	symbol?: string;
};

type StrategyConfigFile =
	| VwapStrategyConfigFile
	| UltraAggressiveStrategyConfigFile;

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

export type ExecutionMode = "paper" | "live";

export interface EnvConfig {
	exchangeId: string;
	executionMode: ExecutionMode;
	mexcApiKey: string;
	mexcApiSecret: string;
	defaultSymbol: string;
	defaultTimeframe: string;
}

export interface ExchangeConfig extends ExchangeConfigFile {
	id: string;
	credentials: {
		apiKey: string;
		apiSecret: string;
	};
}

export type StrategyConfig =
	| (VWAPDeltaGammaConfig & { id: "vwap_delta_gamma"; symbol?: string })
	| (UltraAggressiveBtcUsdtConfig & {
			id: "ultra_aggressive_btc_usdt";
			symbol?: string;
	  });
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
const getDefaultStrategyDir = (): string => {
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
		defaultSymbol: getEnvVar("DEFAULT_SYMBOL", "BTC/USDT"),
		defaultTimeframe: getEnvVar("DEFAULT_TIMEFRAME", "1m"),
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
	return {
		...exchangeFile,
		id: profile,
		testnet: exchangeFile.testnet,
		defaultSymbol: env.defaultSymbol || exchangeFile.defaultSymbol,
		credentials,
	};
};

const resolveStrategyConfigPath = (
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

const inferStrategyIdFromProfile = (profile: string): StrategyId => {
	if (profile.includes("ultra")) {
		return "ultra_aggressive_btc_usdt";
	}
	return "vwap_delta_gamma";
};

export const loadStrategyConfig = (
	strategyDir = getDefaultStrategyDir(),
	strategyProfile = "vwap-delta-gamma"
): StrategyConfig => {
	const strategyPath = resolveStrategyConfigPath(strategyDir, strategyProfile);
	const file = readJsonFile<StrategyConfigFile>(strategyPath);
	const strategyId =
		(file.id as StrategyId | undefined) ??
		inferStrategyIdFromProfile(strategyProfile);
	switch (strategyId) {
		case "vwap_delta_gamma":
			return {
				...(file as VwapStrategyConfigFile),
				id: "vwap_delta_gamma",
			};
		case "ultra_aggressive_btc_usdt":
			return {
				...(file as UltraAggressiveStrategyConfigFile),
				id: "ultra_aggressive_btc_usdt",
			};
		default:
			throw new Error(`Unsupported strategy id in config: ${strategyId}`);
	}
};

export const loadRiskConfig = (
	configDir = getDefaultConfigDir(),
	riskProfile = "default"
): RiskConfig => {
	const riskPath = path.join(configDir, "risk", `${riskProfile}.json`);
	const file = readJsonFile<RiskConfigFile>(riskPath);
	const riskPerTradePercent =
		file.riskPerTradePercent ??
		(file.riskPerTradePct !== undefined ? file.riskPerTradePct / 100 : 0.01);
	return {
		maxLeverage: file.maxLeverage,
		riskPerTradePercent,
		maxPositions: file.maxPositions,
		slPct: file.slPct,
		tpPct: file.tpPct,
		minPositionSize: file.minPositionSize ?? 0.001,
		maxPositionSize: file.maxPositionSize ?? 1,
		trailingActivationPct: file.trailingActivationPct ?? 0.005,
		trailingTrailPct: file.trailingTrailPct ?? 0.003,
	};
};

export const loadAccountConfig = (
	configDir = getDefaultConfigDir(),
	accountProfile = "paper"
): AccountConfig => {
	const accountPath = path.join(configDir, "account", `${accountProfile}.json`);
	return readJsonFile<AccountConfigFile>(accountPath);
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
