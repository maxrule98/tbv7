export interface VwapCandle {
	timestamp: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

const typicalPrice = (candle: VwapCandle): number =>
	(candle.high + candle.low + candle.close) / 3;

const computeVwap = (candles: VwapCandle[]): number | null => {
	if (!candles.length) {
		return null;
	}

	let pvSum = 0;
	let volumeSum = 0;

	for (const candle of candles) {
		if (candle.volume <= 0) {
			continue;
		}
		pvSum += typicalPrice(candle) * candle.volume;
		volumeSum += candle.volume;
	}

	if (volumeSum <= 0) {
		return null;
	}

	return pvSum / volumeSum;
};

const startOfUtcDay = (timestamp: number): number => {
	const date = new Date(timestamp);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const startOfUtcWeek = (timestamp: number): number => {
	const date = new Date(timestamp);
	const day = date.getUTCDay();
	const daysSinceMonday = (day + 6) % 7; // Monday = 0
	return Date.UTC(
		date.getUTCFullYear(),
		date.getUTCMonth(),
		date.getUTCDate() - daysSinceMonday
	);
};

const startOfUtcMonth = (timestamp: number): number => {
	const date = new Date(timestamp);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};

const filterByStart = (
	candles: VwapCandle[],
	startTimestamp: number
): VwapCandle[] =>
	candles.filter((candle) => candle.timestamp >= startTimestamp);

export const calculateDailyVWAP = (candles: VwapCandle[]): number | null => {
	if (!candles.length) {
		return null;
	}
	const start = startOfUtcDay(candles[candles.length - 1].timestamp);
	return computeVwap(filterByStart(candles, start));
};

export const calculateWeeklyVWAP = (candles: VwapCandle[]): number | null => {
	if (!candles.length) {
		return null;
	}
	const start = startOfUtcWeek(candles[candles.length - 1].timestamp);
	return computeVwap(filterByStart(candles, start));
};

export const calculateMonthlyVWAP = (candles: VwapCandle[]): number | null => {
	if (!candles.length) {
		return null;
	}
	const start = startOfUtcMonth(candles[candles.length - 1].timestamp);
	return computeVwap(filterByStart(candles, start));
};

export const calculateRollingVWAP = (
	candles: VwapCandle[],
	period: number
): number | null => {
	if (period <= 0 || candles.length < period) {
		return null;
	}
	const window = candles.slice(-period);
	return computeVwap(window);
};
