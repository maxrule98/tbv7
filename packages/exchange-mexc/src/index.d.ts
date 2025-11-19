import { Order } from "ccxt";
import { Candle, PositionSide } from "@agenai/core";
export interface MexcClientOptions {
    apiKey?: string;
    secret?: string;
    useFutures?: boolean;
}
export interface ExchangePositionSnapshot {
    side: PositionSide;
    size: number;
    entryPrice: number | null;
    unrealizedPnl: number | null;
}
export declare class MexcClient {
    private readonly exchange;
    private marketsLoaded;
    constructor(options?: MexcClientOptions);
    fetchOHLCV(symbol: string, timeframe: string, limit?: number): Promise<Candle[]>;
    createMarketOrder(symbol: string, side: "buy" | "sell", amount: number): Promise<Order>;
    getBalanceUSDT(): Promise<number>;
    getPosition(symbol: string): Promise<ExchangePositionSnapshot>;
    private resolveMarketSymbol;
    private ensureMarketsLoaded;
    private static mapCandle;
    private static emptyPosition;
}
