import { Candle, TradeIntent } from "../../types";
import { SessionVWAPState } from "./vwapIndicator";

export interface StrategyState {
	touchedUpper: boolean;
	touchedLower: boolean;
	lastSessionStart: number;
}

export interface EntrySignal {
	canEnter: boolean;
	side: "LONG" | "SHORT" | null;
	reason: string;
	vwap: number;
	sd: number;
	upper: number;
	lower: number;
	delta: number;
	gamma: number;
	stop: number | null;
}

/**
 * Evaluate long entry conditions:
 * 1) touchedLower == true (price traded below Lower previously)
 * 2) current candle CLOSE > Upper
 * 3) delta[t] > 0
 * 4) gamma[t] > 0
 */
export function evaluateLongEntry(
	candle: Candle,
	vwapState: SessionVWAPState,
	delta: number,
	gamma: number,
	state: StrategyState
): EntrySignal {
	const result: EntrySignal = {
		canEnter: false,
		side: null,
		reason: "no_setup",
		vwap: vwapState.vwap,
		sd: vwapState.sd,
		upper: vwapState.upper,
		lower: vwapState.lower,
		delta,
		gamma,
		stop: null,
	};

	// Check all conditions
	if (!state.touchedLower) {
		result.reason = "waiting_for_lower_touch";
		return result;
	}

	if (candle.close <= vwapState.upper) {
		result.reason = "close_not_above_upper";
		return result;
	}

	if (delta <= 0) {
		result.reason = "delta_not_positive";
		return result;
	}

	if (gamma <= 0) {
		result.reason = "gamma_not_positive";
		return result;
	}

	// All conditions met
	result.canEnter = true;
	result.side = "LONG";
	result.reason = "full_traversal_long";
	result.stop = vwapState.vwap - 0.25 * vwapState.sd;

	return result;
}

/**
 * Evaluate short entry conditions:
 * 1) touchedUpper == true (price traded above Upper previously)
 * 2) current candle CLOSE < Lower
 * 3) delta[t] < 0
 * 4) gamma[t] < 0
 */
export function evaluateShortEntry(
	candle: Candle,
	vwapState: SessionVWAPState,
	delta: number,
	gamma: number,
	state: StrategyState
): EntrySignal {
	const result: EntrySignal = {
		canEnter: false,
		side: null,
		reason: "no_setup",
		vwap: vwapState.vwap,
		sd: vwapState.sd,
		upper: vwapState.upper,
		lower: vwapState.lower,
		delta,
		gamma,
		stop: null,
	};

	// Check all conditions
	if (!state.touchedUpper) {
		result.reason = "waiting_for_upper_touch";
		return result;
	}

	if (candle.close >= vwapState.lower) {
		result.reason = "close_not_below_lower";
		return result;
	}

	if (delta >= 0) {
		result.reason = "delta_not_negative";
		return result;
	}

	if (gamma >= 0) {
		result.reason = "gamma_not_negative";
		return result;
	}

	// All conditions met
	result.canEnter = true;
	result.side = "SHORT";
	result.reason = "full_traversal_short";
	result.stop = vwapState.vwap + 0.25 * vwapState.sd;

	return result;
}

/**
 * Build trade intent for entry
 */
export function buildEntryIntent(
	candle: Candle,
	signal: EntrySignal
): TradeIntent {
	if (!signal.canEnter || !signal.side) {
		return {
			symbol: candle.symbol,
			intent: "NO_ACTION",
			reason: signal.reason,
			timestamp: candle.timestamp,
			metadata: {
				vwap: signal.vwap,
				upper: signal.upper,
				lower: signal.lower,
				delta: signal.delta,
				gamma: signal.gamma,
			},
		};
	}

	return {
		symbol: candle.symbol,
		intent: signal.side === "LONG" ? "OPEN_LONG" : "OPEN_SHORT",
		reason: signal.reason,
		timestamp: candle.timestamp,
		metadata: {
			vwap: signal.vwap,
			sd: signal.sd,
			upper: signal.upper,
			lower: signal.lower,
			delta: signal.delta,
			gamma: signal.gamma,
			stop: signal.stop,
			entryPrice: candle.close,
		},
	};
}
