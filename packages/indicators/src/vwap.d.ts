export interface VwapCandle {
    timestamp: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export declare const calculateDailyVWAP: (candles: VwapCandle[]) => number | null;
export declare const calculateWeeklyVWAP: (candles: VwapCandle[]) => number | null;
export declare const calculateMonthlyVWAP: (candles: VwapCandle[]) => number | null;
export declare const calculateRollingVWAP: (candles: VwapCandle[], period: number) => number | null;
