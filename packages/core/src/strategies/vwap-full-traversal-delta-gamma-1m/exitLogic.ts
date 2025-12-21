import { Candle, PositionSide, TradeIntent } from "../../types";
import { SessionVWAPState } from "./vwapIndicator";

export interface ExitSignal {
	shouldExit: boolean;
	reason: string;
	vwap: number;
	upper: number;
	lower: number;
	delta: number;
	gamma: number;
}

export interface DeltaHistory {
	current: number | null;
	previous: number | null;
}

/**
 * Evaluate exit conditions for LONG position:
 *
 * Primary exit: Delta flip - exit when delta is negative for 2 consecutive closed candles
 * Emergency exits:
 * 1) Candle closes back inside band (CLOSE < Upper) - immediate
 * 2) Gamma flips negative - immediate
 */
export function evaluateLongExit(
	candle: Candle,
	vwapState: SessionVWAPState,
	deltaHistory: DeltaHistory,
	gamma: number
): ExitSignal {
	const result: ExitSignal = {
		shouldExit: false,
		reason: "holding",
		vwap: vwapState.vwap,
		upper: vwapState.upper,
		lower: vwapState.lower,
		delta: deltaHistory.current ?? 0,
		gamma,
	};

	// Primary exit: 2 consecutive negative deltas
	if (
		deltaHistory.current !== null &&
		deltaHistory.previous !== null &&
		deltaHistory.current < 0 &&
		deltaHistory.previous < 0
	) {
		result.shouldExit = true;
		result.reason = "delta_flip_exit";
		return result;
	}

	// Emergency exit: Close back inside band
	if (candle.close < vwapState.upper) {
		result.shouldExit = true;
		result.reason = "emergency_sd_reentry";
		return result;
	}

	// Emergency exit: Gamma flip (immediate)
	if (gamma < 0) {
		result.shouldExit = true;
		result.reason = "emergency_gamma_flip";
		return result;
	}

	return result;
}

/**
 * Evaluate exit conditions for SHORT position:
 *
 * Primary exit: Delta flip - exit when delta is positive for 2 consecutive closed candles
 * Emergency exits:
 * 1) Candle closes back inside band (CLOSE > Lower) - immediate
 * 2) Gamma flips positive - immediate
 */
export function evaluateShortExit(
	candle: Candle,
	vwapState: SessionVWAPState,
	deltaHistory: DeltaHistory,
	gamma: number
): ExitSignal {
	const result: ExitSignal = {
		shouldExit: false,
		reason: "holding",
		vwap: vwapState.vwap,
		upper: vwapState.upper,
		lower: vwapState.lower,
		delta: deltaHistory.current ?? 0,
		gamma,
	};

	// Primary exit: 2 consecutive positive deltas
	if (
		deltaHistory.current !== null &&
		deltaHistory.previous !== null &&
		deltaHistory.current > 0 &&
		deltaHistory.previous > 0
	) {
		result.shouldExit = true;
		result.reason = "delta_flip_exit";
		return result;
	}

	// Emergency exit: Close back inside band
	if (candle.close > vwapState.lower) {
		result.shouldExit = true;
		result.reason = "emergency_sd_reentry";
		return result;
	}

	// Emergency exit: Gamma flip (immediate)
	if (gamma > 0) {
		result.shouldExit = true;
		result.reason = "emergency_gamma_flip";
		return result;
	}

	return result;
}

/**
 * Evaluate exit for current position
 */
export function evaluateExit(
	position: PositionSide,
	candle: Candle,
	vwapState: SessionVWAPState,
	deltaHistory: DeltaHistory,
	gamma: number
): ExitSignal | null {
	if (position === "FLAT") {
		return null;
	}

	if (position === "LONG") {
		return evaluateLongExit(candle, vwapState, deltaHistory, gamma);
	}

	if (position === "SHORT") {
		return evaluateShortExit(candle, vwapState, deltaHistory, gamma);
	}

	return null;
}

/**
 * Build trade intent for exit
 */
export function buildExitIntent(
	candle: Candle,
	position: PositionSide,
	signal: ExitSignal
): TradeIntent | null {
	if (!signal.shouldExit) {
		return null;
	}

	const intent = position === "LONG" ? "CLOSE_LONG" : "CLOSE_SHORT";

	return {
		symbol: candle.symbol,
		intent,
		reason: signal.reason,
		timestamp: candle.timestamp,
		metadata: {
			vwap: signal.vwap,
			upper: signal.upper,
			lower: signal.lower,
			delta: signal.delta,
			gamma: signal.gamma,
			exitPrice: candle.close,
		},
	};
}
