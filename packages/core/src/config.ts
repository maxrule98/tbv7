import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const DEFAULT_ENV_PATH = path.resolve(process.cwd(), '.env');
const DEFAULT_CONFIG_DIR = path.resolve(process.cwd(), 'config');

let envLoaded = false;

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

export interface EnvConfig {
  binanceApiKey: string;
  binanceApiSecret: string;
  binanceUseTestnet: boolean;
  defaultSymbol: string;
  defaultTimeframe: string;
}

export interface ExchangeConfig extends ExchangeConfigFile {
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

const getEnvVar = (key: string, fallback?: string): string => {
  const value = process.env[key];
  if (value !== undefined && value !== '') {
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
  return value.toLowerCase() === 'true';
};

const readJsonFile = <T>(filePath: string): T => {
  const contents = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(contents) as T;
};

export const loadEnvConfig = (envPath = DEFAULT_ENV_PATH): EnvConfig => {
  if (!envLoaded) {
    dotenv.config({ path: envPath });
    envLoaded = true;
  }

  return {
    binanceApiKey: getEnvVar('BINANCE_API_KEY'),
    binanceApiSecret: getEnvVar('BINANCE_API_SECRET'),
    binanceUseTestnet: toBoolean(getEnvVar('BINANCE_USE_TESTNET', 'true'), true),
    defaultSymbol: getEnvVar('DEFAULT_SYMBOL', 'BTC/USDT'),
    defaultTimeframe: getEnvVar('DEFAULT_TIMEFRAME', '1m')
  };
};

export const loadExchangeConfig = (
  env: EnvConfig,
  configDir = DEFAULT_CONFIG_DIR,
  exchangeProfile = 'binance.testnet'
): ExchangeConfig => {
  const exchangePath = path.join(configDir, 'exchange', `${exchangeProfile}.json`);
  const exchangeFile = readJsonFile<ExchangeConfigFile>(exchangePath);
  return {
    ...exchangeFile,
    testnet: env.binanceUseTestnet ?? exchangeFile.testnet,
    defaultSymbol: env.defaultSymbol || exchangeFile.defaultSymbol,
    credentials: {
      apiKey: env.binanceApiKey,
      apiSecret: env.binanceApiSecret
    }
  };
};

export const loadStrategyConfig = (
  configDir = DEFAULT_CONFIG_DIR,
  strategyProfile = 'macd_ar4'
): StrategyConfig => {
  const strategyPath = path.join(configDir, 'strategies', `${strategyProfile}.json`);
  return readJsonFile<StrategyConfigFile>(strategyPath);
};

export const loadRiskConfig = (
  configDir = DEFAULT_CONFIG_DIR,
  riskProfile = 'default'
): RiskConfig => {
  const riskPath = path.join(configDir, 'risk', `${riskProfile}.json`);
  return readJsonFile<RiskConfigFile>(riskPath);
};

export const loadAgenaiConfig = (options: ConfigLoadOptions = {}): AgenaiConfig => {
  const env = loadEnvConfig(options.envPath ?? DEFAULT_ENV_PATH);
  const configDir = options.configDir ?? DEFAULT_CONFIG_DIR;
  return {
    env,
    exchange: loadExchangeConfig(env, configDir, options.exchangeProfile),
    strategy: loadStrategyConfig(configDir, options.strategyProfile),
    risk: loadRiskConfig(configDir, options.riskProfile)
  };
};
