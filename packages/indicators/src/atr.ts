export interface AtrInput {
	high: number;
	low: number;
	close: number;
}

export function calculateATR(candles: AtrInput[], period = 14): number | null {
	if (period <= 0 || candles.length < period + 1) {
		return null;
	}

	const trueRanges: number[] = [];
	for (let i = 1; i < candles.length; i += 1) {
		const current = candles[i];
		const previousClose = candles[i - 1].close;
		const highLow = current.high - current.low;
		const highClose = Math.abs(current.high - previousClose);
		const lowClose = Math.abs(current.low - previousClose);
		trueRanges.push(Math.max(highLow, highClose, lowClose));
	}

	if (trueRanges.length < period) {
		return null;
	}

	let atr =
		trueRanges.slice(0, period).reduce((acc, value) => acc + value, 0) / period;

	for (let i = period; i < trueRanges.length; i += 1) {
		atr = (atr * (period - 1) + trueRanges[i]) / period;
	}

	return Number(atr.toFixed(6));
}
