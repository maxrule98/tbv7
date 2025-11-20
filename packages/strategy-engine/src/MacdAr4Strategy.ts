import { Candle, PositionSide, TradeIntent } from "@agenai/core";
import { calculateATR, calculateRSI, ema, macd } from "@agenai/indicators";
import { ar4Forecast } from "@agenai/models-quant";

export interface HigherTimeframeTrend {
	macdHist: number | null;
	isBull: boolean;
	isBear: boolean;
	isNeutral: boolean;
}

export type HigherTimeframeTrendFetcher = (
	symbol: string,
	timeframe: string
) => Promise<HigherTimeframeTrend | null>;

export interface MacdAr4Config {
	emaFast: number;
	emaSlow: number;
	signal: number;
	arWindow: number;
	minForecast: number;
	pullbackFast: number;
	pullbackSlow: number;
	atrPeriod: number;
	minAtr: number;
	maxAtr: number;
	rsiPeriod: number;
	rsiLongRange: [number, number];
	rsiShortRange: [number, number];
	higherTimeframe: string;
}

export interface MacdAr4StrategyDependencies {
	getHTFTrend: HigherTimeframeTrendFetcher;
}

export class MacdAr4Strategy {
	constructor(
		private readonly config: MacdAr4Config,
		private readonly deps: MacdAr4StrategyDependencies
	) {
		if (!deps?.getHTFTrend) {
			throw new Error(
				"MacdAr4Strategy requires a higher timeframe trend fetcher"
			);
		}
	}

	async decide(
		candles: Candle[],
		position: PositionSide = "FLAT"
	): Promise<TradeIntent> {
		const minCandlesNeeded = Math.max(
			this.config.emaSlow + this.config.signal,
			this.config.pullbackSlow + 2,
			this.config.atrPeriod + 1,
			this.config.rsiPeriod + 1,
			this.config.arWindow
		);
		if (candles.length < minCandlesNeeded) {
			return this.noAction(candles, "insufficient_candles");
		}

		const latest = candles[candles.length - 1];
		const closes = candles.map((candle) => candle.close);
		const macdNow = macd(
			closes,
			this.config.emaFast,
			this.config.emaSlow,
			this.config.signal
		);
		const histogramNow = macdNow.histogram;
		if (histogramNow === null) {
			return this.noAction(candles, "macd_unavailable");
		}

		const macdPrevious = macd(
			closes.slice(0, closes.length - 1),
			this.config.emaFast,
			this.config.emaSlow,
			this.config.signal
		);
		const histogramPrev = macdPrevious.histogram;

		const histogramSeries = this.computeHistogramSeries(closes);
		const histogramWindow = histogramSeries.slice(-this.config.arWindow);
		const forecast =
			histogramWindow.length >= this.config.arWindow
				? ar4Forecast(histogramWindow)
				: null;

		const atrValue = calculateATR(
			candles.map((candle) => ({
				high: candle.high,
				low: candle.low,
				close: candle.close,
			})),
			this.config.atrPeriod
		);
		const rsiValue = calculateRSI(closes, this.config.rsiPeriod);

		const pullbackFast = ema(closes, this.config.pullbackFast);
		const pullbackSlow = ema(closes, this.config.pullbackSlow);
		const pullbackZoneActive = this.isWithinPullbackZone(
			latest,
			pullbackFast,
			pullbackSlow
		);

		const trend = await this.deps.getHTFTrend(
			latest.symbol,
			this.config.higherTimeframe
		);
		const htfTrend = this.normalizeTrend(trend);

		const atrInRange = this.isAtrInRange(atrValue);
		const rsiLongInRange = this.isValueBetween(
			rsiValue,
			this.config.rsiLongRange
		);
		const rsiShortInRange = this.isValueBetween(
			rsiValue,
			this.config.rsiShortRange
		);
		const forecastPositive =
			forecast !== null && forecast > this.config.minForecast;
		const forecastNegative =
			forecast !== null && forecast < -this.config.minForecast;
		const macdBullish = this.isMacdBullish(histogramNow, histogramPrev);
		const macdBearish = this.isMacdBearish(histogramNow, histogramPrev);

		const longSetupActive =
			htfTrend.isBull &&
			macdBullish &&
			forecastPositive &&
			rsiLongInRange &&
			atrInRange &&
			pullbackZoneActive;
		const shortSetupActive =
			htfTrend.isBear &&
			macdBearish &&
			forecastNegative &&
			rsiShortInRange &&
			atrInRange &&
			pullbackZoneActive;

		const longConfluence = longSetupActive && position === "FLAT";
		const shortConfluence = shortSetupActive && position === "FLAT";

		this.logStrategyContext(latest, {
			htfTrend: htfTrend.label,
			rsi: rsiValue,
			atr: atrValue,
			macd1mHist: histogramNow,
			forecast,
			checks: {
				htfBullish: htfTrend.isBull,
				htfBearish: htfTrend.isBear,
				atrInRange,
				rsiLongInRange,
				rsiShortInRange,
				macdBullish,
				macdBearish,
				forecastPositive,
				forecastNegative,
				pullbackZoneActive,
				positionFlat: position === "FLAT",
				longSetupActive,
				shortSetupActive,
			},
		});

		if (position === "LONG") {
			if (shortSetupActive) {
				return {
					symbol: latest.symbol,
					intent: "CLOSE_LONG",
					reason: "opposite_confluence",
				};
			}
			if (forecastNegative) {
				return {
					symbol: latest.symbol,
					intent: "CLOSE_LONG",
					reason: "forecast_flip",
				};
			}
			if (!rsiLongInRange && rsiValue !== null) {
				return {
					symbol: latest.symbol,
					intent: "CLOSE_LONG",
					reason: "rsi_regime_break",
				};
			}
			return this.noAction(candles, "holding_long");
		}

		if (longConfluence) {
			return {
				symbol: latest.symbol,
				intent: "OPEN_LONG",
				reason: "long_confluence_met",
			};
		}

		if (shortConfluence) {
			return this.noAction(candles, "short_signal_unavailable");
		}

		return this.noAction(candles, "no_signal");
	}

	private isAtrInRange(atrValue: number | null): boolean {
		if (atrValue === null) {
			return false;
		}
		return atrValue >= this.config.minAtr && atrValue <= this.config.maxAtr;
	}

	private isValueBetween(
		value: number | null,
		range: [number, number]
	): boolean {
		if (value === null) {
			return false;
		}
		return value >= range[0] && value <= range[1];
	}

	private isMacdBullish(
		histogramNow: number | null,
		histogramPrev: number | null
	): boolean {
		if (histogramNow === null || histogramPrev === null) {
			return false;
		}
		return (
			histogramNow > histogramPrev || (histogramPrev <= 0 && histogramNow > 0)
		);
	}

	private isMacdBearish(
		histogramNow: number | null,
		histogramPrev: number | null
	): boolean {
		if (histogramNow === null || histogramPrev === null) {
			return false;
		}
		return (
			histogramNow < histogramPrev || (histogramPrev >= 0 && histogramNow < 0)
		);
	}

	private isWithinPullbackZone(
		latest: Candle,
		pullbackFast: number | null,
		pullbackSlow: number | null
	): boolean {
		if (pullbackFast === null || pullbackSlow === null) {
			return false;
		}
		const upper = Math.max(pullbackFast, pullbackSlow);
		const lower = Math.min(pullbackFast, pullbackSlow);
		return latest.low <= upper && latest.high >= lower;
	}

	private normalizeTrend(
		trend: HigherTimeframeTrend | null
	): HigherTimeframeTrend & { label: "bull" | "bear" | "neutral" } {
		if (!trend) {
			return {
				macdHist: null,
				isBull: false,
				isBear: false,
				isNeutral: true,
				label: "neutral",
			};
		}
		const label: "bull" | "bear" | "neutral" = trend.isBull
			? "bull"
			: trend.isBear
			? "bear"
			: "neutral";
		return { ...trend, label };
	}

	private logStrategyContext(
		latest: Candle,
		context: {
			htfTrend: "bull" | "bear" | "neutral";
			rsi: number | null;
			atr: number | null;
			macd1mHist: number | null;
			forecast: number | null;
			checks: Record<string, unknown>;
		}
	): void {
		console.log(
			JSON.stringify({
				event: "strategy_context",
				symbol: latest.symbol,
				timeframe: latest.timeframe,
				timestamp: new Date(latest.timestamp).toISOString(),
				htfTrend: context.htfTrend,
				rsi: context.rsi,
				atr: context.atr,
				macd1mHist: context.macd1mHist,
				forecast: context.forecast,
				confluenceChecks: context.checks,
			})
		);
	}

	private computeHistogramSeries(closes: number[]): number[] {
		if (closes.length === 0) {
			return [];
		}

		const fastSeries = this.calculateEmaSeries(closes, this.config.emaFast);
		const slowSeries = this.calculateEmaSeries(closes, this.config.emaSlow);

		const macdSeries: Array<number | null> = fastSeries.map(
			(fastValue, index) => {
				const slowValue = slowSeries[index];
				if (fastValue === null || slowValue === null) {
					return null;
				}
				return fastValue - slowValue;
			}
		);

		const signalSeries = this.calculateSignalSeries(
			macdSeries,
			this.config.signal
		);

		const histogramSeries = macdSeries.map((macdValue, index) => {
			const signalValue = signalSeries[index];
			if (macdValue === null || signalValue === null) {
				return null;
			}
			return macdValue - signalValue;
		});

		return histogramSeries.filter((value): value is number => value !== null);
	}

	private calculateEmaSeries(
		values: number[],
		length: number
	): Array<number | null> {
		const series: Array<number | null> = new Array(values.length).fill(null);

		if (length <= 0 || values.length < length) {
			return series;
		}

		const multiplier = 2 / (length + 1);
		let emaValue = this.average(values.slice(0, length));
		series[length - 1] = emaValue;

		for (let i = length; i < values.length; i += 1) {
			emaValue = (values[i] - emaValue) * multiplier + emaValue;
			series[i] = emaValue;
		}

		return series;
	}

	private calculateSignalSeries(
		values: Array<number | null>,
		length: number
	): Array<number | null> {
		const series: Array<number | null> = new Array(values.length).fill(null);
		if (length <= 0) {
			return series;
		}

		const multiplier = 2 / (length + 1);
		const seed: number[] = [];
		let emaValue: number | null = null;

		for (let i = 0; i < values.length; i += 1) {
			const value = values[i];
			if (value === null) {
				continue;
			}

			if (emaValue === null) {
				seed.push(value);
				if (seed.length === length) {
					emaValue = this.average(seed);
					series[i] = emaValue;
				}
				continue;
			}

			emaValue = (value - emaValue) * multiplier + emaValue;
			series[i] = emaValue;
		}

		return series;
	}

	private average(values: number[]): number {
		const sum = values.reduce((acc, value) => acc + value, 0);
		return sum / values.length;
	}

	private noAction(candles: Candle[], reason: string): TradeIntent {
		const latestSymbol =
			candles.length > 0 ? candles[candles.length - 1].symbol : "UNKNOWN";
		return {
			symbol: latestSymbol,
			intent: "NO_ACTION",
			reason,
		};
	}
}
