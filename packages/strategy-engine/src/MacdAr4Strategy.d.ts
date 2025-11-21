import { Candle, PositionSide, TradeIntent } from "@agenai/core";
export interface HigherTimeframeTrend {
    macdHist: number | null;
    isBull: boolean;
    isBear: boolean;
    isNeutral: boolean;
}
export type HigherTimeframeTrendFetcher = (symbol: string, timeframe: string) => Promise<HigherTimeframeTrend | null>;
export interface MacdAr4Config {
    emaFast: number;
    emaSlow: number;
    signal: number;
    arWindow: number;
    minForecast: number;
    pullbackFast: number;
    pullbackSlow: number;
    atrPeriod: number;
    minAtr: number;
    maxAtr: number;
    rsiPeriod: number;
    rsiLongRange: [number, number];
    rsiShortRange: [number, number];
    higherTimeframe: string;
}
export interface MacdAr4StrategyDependencies {
    getHTFTrend: HigherTimeframeTrendFetcher;
}
export declare class MacdAr4Strategy {
    private readonly config;
    private readonly deps;
    constructor(config: MacdAr4Config, deps: MacdAr4StrategyDependencies);
    decide(candles: Candle[], position?: PositionSide): Promise<TradeIntent>;
    private isAtrInRange;
    private isValueBetween;
    private isMacdBullish;
    private isMacdBearish;
    private isWithinPullbackZone;
    private normalizeTrend;
    private logStrategyContext;
    private computeHistogramSeries;
    private calculateEmaSeries;
    private calculateSignalSeries;
    private average;
    private noAction;
}
