export interface ClosedTrade {
    symbol: string;
    side: "LONG" | "SHORT";
    size: number;
    entryPrice: number;
    exitPrice: number;
    realizedPnl: number;
    timestamp: string;
}
export interface PaperAccountSnapshot {
    startingBalance: number;
    balance: number;
    equity: number;
    totalRealizedPnl: number;
    maxEquity: number;
    maxDrawdown: number;
    trades: {
        total: number;
        wins: number;
        losses: number;
        breakeven: number;
    };
    lastTrade?: ClosedTrade;
}
export declare class PaperAccount {
    private readonly startingBalance;
    private balance;
    private equity;
    private maxEquity;
    private trades;
    private lastTrade?;
    constructor(startingBalance: number);
    registerClosedTrade(trade: ClosedTrade): PaperAccountSnapshot;
    snapshot(unrealizedPnl: number): PaperAccountSnapshot;
}
