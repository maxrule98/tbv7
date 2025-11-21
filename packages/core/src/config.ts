import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import type { StrategyId } from "./strategies/ids";
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

interface StrategyIndicatorConfigFile {
	emaFast?: number;
	emaSlow?: number;
	signal?: number;
	pullbackFast?: number;
	pullbackSlow?: number;
	atrPeriod?: number;
	rsiPeriod?: number;
	arWindow?: number;
}

interface StrategyThresholdConfigFile {
	minForecast?: number;
	minAtr?: number;
	maxAtr?: number;
	rsiLongLower?: number;
	rsiLongUpper?: number;
	rsiShortLower?: number;
	rsiShortUpper?: number;
	htfHistogramDeadband?: number;
}

interface MomentumV3HtfConfigFile {
	timeframe?: string;
	macdFast?: number;
	macdSlow?: number;
	macdSignal?: number;
	deadband?: number;
}

interface MomentumV3AtrConfigFile {
	period?: number;
	emaPeriod?: number;
}

interface MomentumV3VolumeConfigFile {
	smaPeriod?: number;
	spikeMultiplier?: number;
}

interface MomentumV3BreakoutConfigFile {
	lookback?: number;
}

interface MomentumV3RsiConfigFile {
	period?: number;
	longMin?: number;
	longMax?: number;
	shortMin?: number;
	shortMax?: number;
}

interface BaseStrategyConfigFile {
	id?: StrategyId;
	symbol: string;
	timeframe: string;
	mode?: string;
	htfCacheMs?: number;
}

interface MacdAr4StrategyConfigFile extends BaseStrategyConfigFile {
	id?: "macd_ar4_v2";
	higherTimeframe?: string;
	indicators?: StrategyIndicatorConfigFile;
	thresholds?: StrategyThresholdConfigFile;
}

interface MomentumV3StrategyConfigFile extends BaseStrategyConfigFile {
	id: "momentum_v3";
	htf?: MomentumV3HtfConfigFile;
	atr?: MomentumV3AtrConfigFile;
	volume?: MomentumV3VolumeConfigFile;
	breakout?: MomentumV3BreakoutConfigFile;
	rsi?: MomentumV3RsiConfigFile;
}

type StrategyConfigFile =
	| MacdAr4StrategyConfigFile
	| MomentumV3StrategyConfigFile;

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

interface BaseStrategyConfig {
	id: StrategyId;
	symbol: string;
	timeframe: string;
	mode: string;
}

export interface StrategyIndicatorConfig {
	emaFast: number;
	emaSlow: number;
	signal: number;
	pullbackFast: number;
	pullbackSlow: number;
	atrPeriod: number;
	rsiPeriod: number;
	arWindow: number;
}

export interface StrategyThresholdConfig {
	minForecast: number;
	minAtr: number;
	maxAtr: number;
	rsiLongLower: number;
	rsiLongUpper: number;
	rsiShortLower: number;
	rsiShortUpper: number;
	htfHistogramDeadband: number;
}

export interface MacdAr4StrategyConfig extends BaseStrategyConfig {
	id: "macd_ar4_v2";
	higherTimeframe: string;
	htfCacheMs: number;
	indicators: StrategyIndicatorConfig;
	thresholds: StrategyThresholdConfig;
}

export interface MomentumV3HtfConfig {
	timeframe: string;
	macdFast: number;
	macdSlow: number;
	macdSignal: number;
	deadband: number;
}

export interface MomentumV3AtrConfig {
	period: number;
	emaPeriod: number;
}

export interface MomentumV3VolumeConfig {
	smaPeriod: number;
	spikeMultiplier: number;
}

export interface MomentumV3BreakoutConfig {
	lookback: number;
}

export interface MomentumV3RsiConfig {
	period: number;
	longMin: number;
	longMax: number;
	shortMin: number;
	shortMax: number;
}

export interface MomentumV3StrategyConfig extends BaseStrategyConfig {
	id: "momentum_v3";
	htfCacheMs: number;
	htf: MomentumV3HtfConfig;
	atr: MomentumV3AtrConfig;
	volume: MomentumV3VolumeConfig;
	breakout: MomentumV3BreakoutConfig;
	rsi: MomentumV3RsiConfig;
}

export type StrategyConfig = MacdAr4StrategyConfig | MomentumV3StrategyConfig;
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
		? { apiKey: env.binanceApiKey, apiSecret: env.binanceApiSecret }
		: { apiKey: env.mexcApiKey, apiSecret: env.mexcApiSecret };
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
	const file = readJsonFile<StrategyConfigFile>(strategyPath);
	const strategyId: StrategyId =
		file.id === "momentum_v3" ? "momentum_v3" : "macd_ar4_v2";
	return strategyId === "momentum_v3"
		? normalizeMomentumV3Config(file as MomentumV3StrategyConfigFile)
		: normalizeMacdAr4Config(file as MacdAr4StrategyConfigFile);
};

const normalizeMacdAr4Config = (
	file: MacdAr4StrategyConfigFile
): MacdAr4StrategyConfig => {
	const indicatorFile = file.indicators ?? {};
	const thresholdFile = file.thresholds ?? {};
	const indicators: StrategyIndicatorConfig = {
		emaFast: indicatorFile.emaFast ?? 12,
		emaSlow: indicatorFile.emaSlow ?? 26,
		signal: indicatorFile.signal ?? 9,
		pullbackFast: indicatorFile.pullbackFast ?? 9,
		pullbackSlow: indicatorFile.pullbackSlow ?? 21,
		atrPeriod: indicatorFile.atrPeriod ?? 14,
		rsiPeriod: indicatorFile.rsiPeriod ?? 14,
		arWindow: indicatorFile.arWindow ?? 20,
	};
	const thresholds: StrategyThresholdConfig = {
		minForecast: thresholdFile.minForecast ?? 0,
		minAtr: thresholdFile.minAtr ?? 8,
		maxAtr: thresholdFile.maxAtr ?? 80,
		rsiLongLower: thresholdFile.rsiLongLower ?? 40,
		rsiLongUpper: thresholdFile.rsiLongUpper ?? 70,
		rsiShortLower: thresholdFile.rsiShortLower ?? 30,
		rsiShortUpper: thresholdFile.rsiShortUpper ?? 60,
		htfHistogramDeadband: thresholdFile.htfHistogramDeadband ?? 0.0005,
	};
	return {
		id: "macd_ar4_v2",
		symbol: file.symbol,
		timeframe: file.timeframe,
		mode: file.mode ?? "long-only",
		higherTimeframe: file.higherTimeframe ?? "15m",
		htfCacheMs: file.htfCacheMs ?? 60_000,
		indicators,
		thresholds,
	};
};

const normalizeMomentumV3Config = (
	file: MomentumV3StrategyConfigFile
): MomentumV3StrategyConfig => {
	const htfFile = file.htf ?? {};
	const atrFile = file.atr ?? {};
	const volumeFile = file.volume ?? {};
	const breakoutFile = file.breakout ?? {};
	const rsiFile = file.rsi ?? {};
	return {
		id: "momentum_v3",
		symbol: file.symbol,
		timeframe: file.timeframe,
		mode: file.mode ?? "long-only",
		htfCacheMs: file.htfCacheMs ?? 60_000,
		htf: {
			timeframe: htfFile.timeframe ?? "15m",
			macdFast: htfFile.macdFast ?? 12,
			macdSlow: htfFile.macdSlow ?? 26,
			macdSignal: htfFile.macdSignal ?? 9,
			deadband: htfFile.deadband ?? 0,
		},
		atr: {
			period: atrFile.period ?? 14,
			emaPeriod: atrFile.emaPeriod ?? 20,
		},
		volume: {
			smaPeriod: volumeFile.smaPeriod ?? 20,
			spikeMultiplier: volumeFile.spikeMultiplier ?? 1.2,
		},
		breakout: {
			lookback: breakoutFile.lookback ?? 20,
		},
		rsi: {
			period: rsiFile.period ?? 14,
			longMin: rsiFile.longMin ?? 45,
			longMax: rsiFile.longMax ?? 70,
			shortMin: rsiFile.shortMin ?? 20,
			shortMax: rsiFile.shortMax ?? 55,
		},
	};
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
	const env = loadEnvConfig(envPath);
	return {
		env,
		exchange: loadExchangeConfig(env, configDir, options.exchangeProfile),
		strategy: loadStrategyConfig(configDir, options.strategyProfile),
		risk: loadRiskConfig(configDir, options.riskProfile),
	};
};
