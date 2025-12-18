import { Candle, PositionSide, TradeIntent } from "@agenai/core";

export interface StrategyDecisionContext {
	signalVenue: string;
	executionVenue: string;
	timeframe: string;
	isClosed: boolean;
}

export interface TraderStrategy {
	decide: (
		candles: Candle[],
		position: PositionSide,
		context: StrategyDecisionContext
	) => Promise<TradeIntent>;
}
