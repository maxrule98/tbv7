import { TradeIntent } from "@agenai/core";
export interface TradePlan {
    symbol: string;
    side: "buy" | "sell";
    type: "market";
    quantity: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    reason: string;
}
export interface RiskConfig {
    riskPerTradePercent: number;
    slPct: number;
    tpPct: number;
    minPositionSize: number;
    maxPositionSize: number;
    trailingActivationPct: number;
    trailingTrailPct: number;
}
export declare class RiskManager {
    private readonly config;
    constructor(config: RiskConfig);
    plan(intent: TradeIntent, lastPrice: number, accountEquity: number, currentPositionQuantity?: number): TradePlan | null;
    private calculateStopLoss;
    private calculateTakeProfit;
    private calculatePositionSize;
}
