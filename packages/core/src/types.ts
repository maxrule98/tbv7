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

export type PositionSide = "LONG" | "SHORT" | "FLAT";

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
}
