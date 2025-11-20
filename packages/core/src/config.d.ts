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
interface StrategyConfigFile {
	symbol: string;
	timeframe: string;
	higherTimeframe?: string;
	htfCacheMs?: number;
	indicators: StrategyIndicatorConfigFile;
	thresholds: StrategyThresholdConfigFile;
	mode: string;
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
export interface StrategyConfig {
	symbol: string;
	timeframe: string;
	higherTimeframe: string;
	htfCacheMs: number;
	indicators: StrategyIndicatorConfig;
	thresholds: StrategyThresholdConfig;
	mode: string;
}
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
export declare const loadEnvConfig: (envPath?: string) => EnvConfig;
export declare const loadExchangeConfig: (
	env: EnvConfig,
	configDir?: string,
	exchangeProfile?: string
) => ExchangeConfig;
export declare const loadStrategyConfig: (
	configDir?: string,
	strategyProfile?: string
) => StrategyConfig;
export declare const loadRiskConfig: (
	configDir?: string,
	riskProfile?: string
) => RiskConfig;
export declare const loadAccountConfig: (
	configDir?: string,
	accountProfile?: string
) => AccountConfig;
export declare const loadAgenaiConfig: (
	options?: ConfigLoadOptions
) => AgenaiConfig;
export {};
