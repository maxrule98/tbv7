import { Candle, PositionSide, TradeIntent } from "@agenai/core";
import { HigherTimeframeTrendFetcher } from "./MacdAr4Strategy";
export interface MomentumV3Config {
    atrPeriod: number;
    atrEmaPeriod: number;
    volumeSmaPeriod: number;
    volumeSpikeMultiplier: number;
    breakoutLookback: number;
    rsiPeriod: number;
    rsiLongRange: [number, number];
    rsiShortRange: [number, number];
    macdFast: number;
    macdSlow: number;
    macdSignal: number;
    htfTimeframe: string;
    rsiBearBiasPadding?: number;
    rsiExitBuffer?: number;
}
export interface MomentumV3StrategyDependencies {
    getHTFTrend: HigherTimeframeTrendFetcher;
}
export declare class MomentumV3Strategy {
    private readonly config;
    private readonly deps;
    constructor(config: MomentumV3Config, deps: MomentumV3StrategyDependencies);
    decide(candles: Candle[], position?: PositionSide): Promise<TradeIntent>;
    private minimumCandlesRequired;
    private toAtrInput;
    private calculateAtrEma;
    private getBreakoutWindow;
    private isBreakoutLong;
    private isBreakoutShort;
    private toTrendLabel;
    private isValueInRange;
    private getCloseReason;
    private logStrategyContext;
    private noAction;
}
