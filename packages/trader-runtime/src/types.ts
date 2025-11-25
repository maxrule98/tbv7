import { Candle, PositionSide, TradeIntent } from "@agenai/core";

export interface TraderStrategy {
	decide: (candles: Candle[], position: PositionSide) => Promise<TradeIntent>;
}
