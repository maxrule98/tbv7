import { AccountConfig, AgenaiConfig, Candle, ExecutionMode, PositionSide, TradeIntent } from "@agenai/core";
import { MexcClient } from "@agenai/exchange-mexc";
export declare const DEFAULT_POLL_INTERVAL_MS = 10000;
export interface TraderConfig {
    symbol: string;
    timeframe: string;
    useTestnet: boolean;
    executionMode?: ExecutionMode;
    pollIntervalMs?: number;
}
export interface StartTraderOptions {
    agenaiConfig?: AgenaiConfig;
    accountConfig?: AccountConfig;
    accountProfile?: string;
    configDir?: string;
    envPath?: string;
    exchangeProfile?: string;
    strategyProfile?: string;
    riskProfile?: string;
    strategyOverride?: TraderStrategy;
    strategyBuilder?: (client: MexcClient) => Promise<TraderStrategy>;
}
export interface TraderStrategy {
    decide: (candles: Candle[], position: PositionSide) => Promise<TradeIntent>;
}
export declare const startTrader: (traderConfig: TraderConfig, options?: StartTraderOptions) => Promise<never>;
