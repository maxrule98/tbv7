import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

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

interface StrategyConfigFile {
	symbol: string;
	timeframe: string;
	indicators: Record<string, number>;
	thresholds: Record<string, number | boolean>;
	mode: string;
}

interface RiskConfigFile {
	maxLeverage: number;
	riskPerTradePct: number;
	maxPositions: number;
	slPct: number;
	tpPct: number;
}

export type ExecutionMode = "paper" | "live";

export interface EnvConfig {
	exchangeId: string;
	executionMode: ExecutionMode;
	binanceApiKey: string;
	binanceApiSecret: string;
	binanceUseTestnet: boolean;
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

export type StrategyConfig = StrategyConfigFile;
export type RiskConfig = RiskConfigFile;

export interface AgenaiConfig {
	env: EnvConfig;
	exchange: ExchangeConfig;
	strategy: StrategyConfig;
	risk: RiskConfig;
}

export interface ConfigLoadOptions {
	envPath?: string;
	configDir?: string;
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

const getDefaultEnvPath = (): string => path.join(findWorkspaceRoot(), ".env");
const getDefaultConfigDir = (): string =>
	path.join(findWorkspaceRoot(), "config");

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

const toBoolean = (value: string | undefined, fallback = false): boolean => {
	if (value === undefined) {
		return fallback;
	}
	return value.toLowerCase() === "true";
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
		binanceApiKey: getEnvVar("BINANCE_API_KEY", ""),
		binanceApiSecret: getEnvVar("BINANCE_API_SECRET", ""),
		binanceUseTestnet: toBoolean(
			getEnvVar("BINANCE_USE_TESTNET", "false"),
			false
		),
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
	const isBinance = profile.startsWith("binance");
	const credentials = isBinance
		? {
				apiKey: env.binanceApiKey,
				apiSecret: env.binanceApiSecret,
		  }
		: {
				apiKey: env.mexcApiKey,
				apiSecret: env.mexcApiSecret,
		  };
	return {
		...exchangeFile,
		id: profile,
		testnet: isBinance ? env.binanceUseTestnet : exchangeFile.testnet,
		defaultSymbol: env.defaultSymbol || exchangeFile.defaultSymbol,
		credentials,
	};
};

export const loadStrategyConfig = (
	configDir = getDefaultConfigDir(),
	strategyProfile = "macd_ar4"
): StrategyConfig => {
	const strategyPath = path.join(
		configDir,
		"strategies",
		`${strategyProfile}.json`
	);
	return readJsonFile<StrategyConfigFile>(strategyPath);
};

export const loadRiskConfig = (
	configDir = getDefaultConfigDir(),
	riskProfile = "default"
): RiskConfig => {
	const riskPath = path.join(configDir, "risk", `${riskProfile}.json`);
	return readJsonFile<RiskConfigFile>(riskPath);
};

export const loadAgenaiConfig = (
	options: ConfigLoadOptions = {}
): AgenaiConfig => {
	const workspaceRoot = findWorkspaceRoot();
	const envPath = options.envPath ?? path.join(workspaceRoot, ".env");
	const configDir = options.configDir ?? path.join(workspaceRoot, "config");
	const env = loadEnvConfig(envPath);
	return {
		env,
		exchange: loadExchangeConfig(env, configDir, options.exchangeProfile),
		strategy: loadStrategyConfig(configDir, options.strategyProfile),
		risk: loadRiskConfig(configDir, options.riskProfile),
	};
};
