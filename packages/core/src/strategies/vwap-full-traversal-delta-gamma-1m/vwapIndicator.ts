import { Candle } from "../../types";

export interface SessionVWAPState {
	vwap: number;
	sd: number;
	upper: number;
	lower: number;
	sessionStart: number;
	cumPV: number;
	cumV: number;
	count: number;
	m2: number; // For Welford's online variance
	mean: number;
}

/**
 * Session-aware VWAP + Standard Deviation calculator
 * Resets at UTC day boundary (00:00 UTC)
 * Uses Welford's algorithm for online variance calculation
 */
export class SessionVWAPCalculator {
	private state: SessionVWAPState | null = null;

	constructor(private sdMultiplier: number = 1.5) {}

	/**
	 * Update VWAP state with a new candle
	 * Returns updated state with VWAP and bands
	 */
	update(candle: Candle): SessionVWAPState {
		const candleDate = new Date(candle.timestamp);
		const sessionStart = Date.UTC(
			candleDate.getUTCFullYear(),
			candleDate.getUTCMonth(),
			candleDate.getUTCDate(),
			0,
			0,
			0,
			0
		);

		// Reset if new session or first update
		if (!this.state || this.state.sessionStart !== sessionStart) {
			this.state = {
				vwap: candle.close,
				sd: 0,
				upper: candle.close,
				lower: candle.close,
				sessionStart,
				cumPV: 0,
				cumV: 0,
				count: 0,
				m2: 0,
				mean: 0,
			};
		}

		// Typical price
		const typicalPrice = (candle.high + candle.low + candle.close) / 3;
		const volume = candle.volume;

		// Update cumulative for VWAP
		this.state.cumPV += typicalPrice * volume;
		this.state.cumV += volume;

		if (this.state.cumV > 0) {
			this.state.vwap = this.state.cumPV / this.state.cumV;
		}

		// Welford's algorithm for online variance around VWAP
		this.state.count += 1;
		const delta = typicalPrice - this.state.vwap;
		this.state.mean += delta / this.state.count;
		const delta2 = typicalPrice - this.state.vwap;
		this.state.m2 += delta * delta2;

		// Calculate standard deviation
		if (this.state.count > 1) {
			const variance = this.state.m2 / (this.state.count - 1);
			this.state.sd = Math.sqrt(Math.max(0, variance));
		} else {
			this.state.sd = 0;
		}

		// Calculate bands
		this.state.upper = this.state.vwap + this.sdMultiplier * this.state.sd;
		this.state.lower = this.state.vwap - this.sdMultiplier * this.state.sd;

		return { ...this.state };
	}

	/**
	 * Get current state without updating
	 */
	getState(): SessionVWAPState | null {
		return this.state ? { ...this.state } : null;
	}

	/**
	 * Reset state (for testing)
	 */
	reset(): void {
		this.state = null;
	}
}

/**
 * Check if price has touched below lower band
 */
export function hasTouchedLowerBand(candle: Candle, lower: number): boolean {
	return candle.low < lower;
}

/**
 * Check if price has touched above upper band
 */
export function hasTouchedUpperBand(candle: Candle, upper: number): boolean {
	return candle.high > upper;
}
