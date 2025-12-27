export * from "./time";

export interface Candle {
	symbol: string;
	timeframe: string;
	timestamp: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export type ActivePositionSide = "LONG" | "SHORT";
export type PositionSide = ActivePositionSide | "FLAT";

export type TradeAction = "OPEN" | "CLOSE";
export type TradeOrderSide = "buy" | "sell";

export type TradeIntentType =
	| "OPEN_LONG"
	| "CLOSE_LONG"
	| "OPEN_SHORT"
	| "CLOSE_SHORT"
	| "NO_ACTION";

export interface TradeIntent {
	symbol: string;
	intent: TradeIntentType;
	reason: string;
	timestamp?: number;
	positionSide?: ActivePositionSide;
	action?: TradeAction;
	side?: TradeOrderSide;
	metadata?: Record<string, unknown>;
}
