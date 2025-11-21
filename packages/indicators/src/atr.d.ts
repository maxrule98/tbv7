export interface AtrInput {
    high: number;
    low: number;
    close: number;
}
export declare function calculateATR(candles: AtrInput[], period?: number): number | null;
export declare function calculateATRSeries(candles: AtrInput[], period?: number): number[];
export declare const calculateAtr1m: (candles: AtrInput[], period?: number) => number | null;
export declare const calculateAtr5m: (candles: AtrInput[], period?: number) => number | null;
