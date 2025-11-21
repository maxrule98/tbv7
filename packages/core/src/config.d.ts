interface ExchangeConfigFile {
    exchange: string;
    market: string;
    testnet: boolean;
    restEndpoint: string;
    wsEndpoint: string;
    defaultSymbol: string;
}
export type StrategyId = "macd_ar4_v2" | "momentum_v3";
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
export declare const loadEnvConfig: (envPath?: string) => EnvConfig;
export declare const loadExchangeConfig: (env: EnvConfig, configDir?: string, exchangeProfile?: string) => ExchangeConfig;
export declare const loadStrategyConfig: (configDir?: string, strategyProfile?: string) => StrategyConfig;
export declare const loadRiskConfig: (configDir?: string, riskProfile?: string) => RiskConfig;
export declare const loadAccountConfig: (configDir?: string, accountProfile?: string) => AccountConfig;
export declare const loadAgenaiConfig: (options?: ConfigLoadOptions) => AgenaiConfig;
export {};
