export interface AtrInput {
	high: number;
	low: number;
	close: number;
}

export function calculateATR(candles: AtrInput[], period = 14): number | null {
	const series = calculateATRSeries(candles, period);
	if (!series.length) {
		return null;
	}
	return series[series.length - 1] ?? null;
}

export function calculateATRSeries(candles: AtrInput[], period = 14): number[] {
	if (period <= 0 || candles.length < period + 1) {
		return [];
	}

	const trueRanges = computeTrueRanges(candles);
	if (trueRanges.length < period) {
		return [];
	}

	let atr =
		trueRanges.slice(0, period).reduce((acc, value) => acc + value, 0) / period;
	const series: number[] = [Number(atr.toFixed(6))];

	for (let i = period; i < trueRanges.length; i += 1) {
		atr = (atr * (period - 1) + trueRanges[i]) / period;
		series.push(Number(atr.toFixed(6)));
	}

	return series;
}

const computeTrueRanges = (candles: AtrInput[]): number[] => {
	const trueRanges: number[] = [];
	for (let i = 1; i < candles.length; i += 1) {
		const current = candles[i];
		const previousClose = candles[i - 1].close;
		const highLow = current.high - current.low;
		const highClose = Math.abs(current.high - previousClose);
		const lowClose = Math.abs(current.low - previousClose);
		trueRanges.push(Math.max(highLow, highClose, lowClose));
	}
	return trueRanges;
};

export const calculateAtr1m = (
	candles: AtrInput[],
	period = 14
): number | null => calculateATR(candles, period);

export const calculateAtr5m = (
	candles: AtrInput[],
	period = 14
): number | null => calculateATR(candles, period);
