export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSet {
  emaFast?: number;
  emaSlow?: number;
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;
  rsi?: number;
}

export interface ForecastSet {
  ar4?: number;
}

export type StrategyMode = 'long-only' | 'short-only' | 'both';

export enum StrategyAction {
  OPEN_LONG = 'OPEN_LONG',
  CLOSE_LONG = 'CLOSE_LONG',
  OPEN_SHORT = 'OPEN_SHORT',
  CLOSE_SHORT = 'CLOSE_SHORT',
  NO_ACTION = 'NO_ACTION'
}

export interface StrategyIntent {
  action: StrategyAction;
  confidence: number;
  reason?: string;
}

export interface StrategyConfig {
  symbol: string;
  timeframe: string;
  indicators: {
    emaFast: number;
    emaSlow: number;
    signal: number;
  };
  thresholds: {
    macdCrossUp?: boolean;
    macdCrossDown?: boolean;
    ar4ForecastMin?: number;
    rsiOverbought?: number;
    rsiOversold?: number;
  };
  mode: StrategyMode;
}

export interface RiskConfig {
  maxLeverage: number;
  riskPerTradePct: number;
  maxPositions: number;
  slPct: number;
  tpPct: number;
}

export interface BinanceExchangeConfig {
  testnet: boolean;
  apiKey?: string;
  secret?: string;
  password?: string | null;
  options?: Record<string, unknown>;
}

export type PositionSide = 'long' | 'short';

export interface Position {
  symbol: string;
  side: PositionSide;
  contracts: number;
  entryPrice: number;
  unrealizedPnl: number;
  leverage: number;
}

export interface AccountState {
  balanceUSDT: number;
  positions: Position[];
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'take-profit';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price?: number;
  reduceOnly?: boolean;
  params?: Record<string, unknown>;
}

export interface TradePlan {
  action: StrategyAction;
  symbol: string;
  side: PositionSide;
  amount: number;
  entryPrice: number;
  leverage: number;
  slPrice?: number;
  tpPrice?: number;
  reduceOnly?: boolean;
}

export interface RiskAssessment {
  shouldTrade: boolean;
  reason?: string;
  plan?: TradePlan;
}

export interface ExecutionReport {
  plan: TradePlan;
  entryOrderId?: string;
  stopOrderId?: string;
  takeProfitOrderId?: string;
}
