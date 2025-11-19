export interface MacdResult {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
}
export declare function macd(closes: number[], fast: number, slow: number, signalLength: number): MacdResult;
