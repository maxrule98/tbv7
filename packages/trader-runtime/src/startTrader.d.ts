import { AccountConfig, AgenaiConfig, ExecutionMode } from "@agenai/core";
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
}
export declare const startTrader: (traderConfig: TraderConfig, options?: StartTraderOptions) => Promise<never>;
