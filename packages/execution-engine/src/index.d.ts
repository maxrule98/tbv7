import { PositionSide } from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
import { TradePlan } from "@agenai/risk-engine";
import { PaperAccount, PaperAccountSnapshot } from "./paperAccount";
export type ExecutionMode = "paper" | "live";
export interface ExecutionEngineOptions {
    client: MexcClient;
    mode?: ExecutionMode;
    paperAccount?: PaperAccount;
}
export { PaperAccount } from "./paperAccount";
export type { PaperAccountSnapshot, ClosedTrade } from "./paperAccount";
export interface ExecutionContext {
    price: number;
}
export interface ExecutionResult {
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    status: "paper_filled" | "paper_closed" | "submitted" | "unknown" | "skipped";
    price?: number | null;
    mode: ExecutionMode;
    reason?: string;
    realizedPnl?: number;
    totalRealizedPnl?: number;
}
export interface PaperPositionSnapshot {
    side: PositionSide;
    size: number;
    avgEntryPrice: number | null;
    realizedPnl: number;
    entryPrice: number;
    peakPrice: number;
    trailingStopPrice: number;
    isTrailingActive: boolean;
    stopLossPrice?: number;
    takeProfitPrice?: number;
}
interface PaperPosition extends PaperPositionSnapshot {
}
export declare class ExecutionEngine {
    private readonly options;
    private readonly mode;
    private readonly paperPositions;
    private readonly paperAccount?;
    constructor(options: ExecutionEngineOptions);
    getPosition(symbol: string): PaperPositionSnapshot;
    getPaperPosition(symbol: string): PaperPositionSnapshot;
    updatePosition(symbol: string, updates: Partial<PaperPosition>): PaperPositionSnapshot;
    execute(plan: TradePlan, context: ExecutionContext): Promise<ExecutionResult>;
    hasPaperAccount(): boolean;
    snapshotPaperAccount(unrealizedPnl: number): PaperAccountSnapshot | null;
    private handlePaperExecution;
    private ensurePaperPosition;
    private logPaperAccountUpdate;
}
