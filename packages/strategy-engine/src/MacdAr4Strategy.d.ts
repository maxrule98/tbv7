import { Candle, PositionSide, TradeIntent } from "@agenai/core";
export interface MacdAr4Config {
    emaFast: number;
    emaSlow: number;
    signal: number;
    arWindow: number;
    minForecast: number;
}
export declare class MacdAr4Strategy {
    private readonly config;
    constructor(config: MacdAr4Config);
    decide(candles: Candle[], position?: PositionSide): TradeIntent;
    private noAction;
    private computeHistogramSeries;
    private calculateEmaSeries;
    private calculateSignalSeries;
    private average;
}
