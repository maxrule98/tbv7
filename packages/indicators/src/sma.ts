export function sma(values: number[], period: number): number | null {
	if (period <= 0 || values.length < period) {
		return null;
	}

	const window = values.slice(values.length - period);
	const sum = window.reduce((acc, value) => acc + value, 0);
	return Number((sum / period).toFixed(6));
}
