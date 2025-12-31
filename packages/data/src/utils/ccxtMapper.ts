import type { OHLCV } from "ccxt";
import type { Candle } from "@agenai/core";

/**
 * Shared utility to map CCXT OHLCV data to our standardized Candle type.
 * This eliminates duplication across exchange adapters and lives in the data layer.
 */
export const mapCcxtCandleToCandle = (
	row: OHLCV,
	symbol: string,
	timeframe: string
): Candle => {
	const [timestamp, open, high, low, close, volume] = row;
	return {
		symbol,
		timeframe,
		timestamp: Number(timestamp ?? 0),
		open: Number(open ?? 0),
		high: Number(high ?? 0),
		low: Number(low ?? 0),
		close: Number(close ?? 0),
		volume: Number(volume ?? 0),
	};
};
