import { Candle, PositionSide, TradeIntent } from "@agenai/core";
import {
	AtrInput,
	calculateATRSeries,
	calculateRSI,
	ema,
	macd,
	sma,
} from "@agenai/indicators";
import {
	HigherTimeframeTrend,
	HigherTimeframeTrendFetcher,
} from "./MacdAr4Strategy";

export interface MomentumV3Config {
	atrPeriod: number;
	atrEmaPeriod: number;
	volumeSmaPeriod: number;
	volumeSpikeMultiplier: number;
	breakoutLookback: number;
	rsiPeriod: number;
	rsiLongRange: [number, number];
	rsiShortRange: [number, number];
	macdFast: number;
	macdSlow: number;
	macdSignal: number;
	htfTimeframe: string;
	rsiBearBiasPadding?: number;
	rsiExitBuffer?: number;
}

export interface MomentumV3StrategyDependencies {
	getHTFTrend: HigherTimeframeTrendFetcher;
}

export class MomentumV3Strategy {
	constructor(
		private readonly config: MomentumV3Config,
		private readonly deps: MomentumV3StrategyDependencies
	) {
		if (!deps?.getHTFTrend) {
			throw new Error(
				"MomentumV3Strategy requires a higher timeframe trend fetcher"
			);
		}
	}

	async decide(
		candles: Candle[],
		position: PositionSide = "FLAT"
	): Promise<TradeIntent> {
		if (candles.length < this.minimumCandlesRequired()) {
			return this.noAction(candles, "insufficient_candles");
		}

		const latest = candles[candles.length - 1];
		const closes = candles.map((candle) => candle.close);
		const volumes = candles.map((candle) => candle.volume);
		const rsiValue = calculateRSI(closes, this.config.rsiPeriod);
		const atrSeries = calculateATRSeries(
			candles.map(this.toAtrInput),
			this.config.atrPeriod
		);
		const atrValue = atrSeries.length
			? atrSeries[atrSeries.length - 1]
			: null;
		const atrEmaValue = this.calculateAtrEma(atrSeries);
		const atrInBreakout =
			atrValue !== null &&
			atrEmaValue !== null &&
			atrValue > atrEmaValue;

		const volumeSma = sma(volumes, this.config.volumeSmaPeriod);
		const volumeSpike =
			volumeSma !== null &&
			latest.volume > volumeSma * this.config.volumeSpikeMultiplier;

		const macdResult = macd(
			closes,
			this.config.macdFast,
			this.config.macdSlow,
			this.config.macdSignal
		);
		const macdHist1m = macdResult.histogram;
		const macdBullish = macdHist1m !== null && macdHist1m > 0;
		const macdBearish = macdHist1m !== null && macdHist1m < 0;

		const breakoutWindow = this.getBreakoutWindow(candles);
		const breakoutLong = this.isBreakoutLong(latest.close, breakoutWindow);
		const breakoutShort = this.isBreakoutShort(latest.close, breakoutWindow);

		const trend = await this.deps.getHTFTrend(
			latest.symbol,
			this.config.htfTimeframe
		);
		const htfTrend = this.toTrendLabel(trend);
		const htfBullish = htfTrend === "bull";
		const htfBearish = htfTrend === "bear";

		const rsiLongInRange = this.isValueInRange(
			rsiValue,
			this.config.rsiLongRange
		);
		const rsiShortInRange = this.isValueInRange(
			rsiValue,
			this.config.rsiShortRange
		);
		const rsiBearBiasPadding = this.config.rsiBearBiasPadding ?? 2;
		const longRsiBiasSatisfied = htfBearish
			? Boolean(
					rsiValue !== null &&
					rsiValue >=
						this.config.rsiLongRange[0] + rsiBearBiasPadding &&
					rsiValue <= this.config.rsiLongRange[1]
				)
			: rsiLongInRange;

		const longSetupActive =
			breakoutLong &&
			atrInBreakout &&
			volumeSpike &&
			macdBullish &&
			longRsiBiasSatisfied;

		const shortSetupActive =
			breakoutShort &&
			atrInBreakout &&
			volumeSpike &&
			macdBearish &&
			rsiShortInRange;

		this.logStrategyContext(latest, {
			htfTrend,
			rsi: rsiValue,
			atr: atrValue,
			atrEma: atrEmaValue,
			atrBreakout: atrInBreakout,
			volume: latest.volume,
			volumeSma,
			volumeSpike,
			macd1mHist: macdHist1m,
			breakoutLong,
			breakoutShort,
			confluenceChecks: {
				htfBullish,
				htfBearish,
				atrInBreakout,
				volumeInBreakout: volumeSpike,
				rsiLongInRange,
				rsiShortInRange,
				macdBullish,
				macdBearish,
				longSetupActive,
				shortSetupActive,
				positionFlat: position === "FLAT",
				positionLong: position === "LONG",
				positionShort: position === "SHORT",
			},
		});

		if (position === "LONG") {
			const closeReason = this.getCloseReason({
				shortSetupActive,
				macdBearish,
				atrInBreakout,
				volumeSpike,
				rsiValue,
			});
			if (closeReason) {
				return {
					symbol: latest.symbol,
					intent: "CLOSE_LONG",
					reason: closeReason,
				};
			}
			return this.noAction(candles, "holding_long");
		}

		if (position === "FLAT" && longSetupActive) {
			return {
				symbol: latest.symbol,
				intent: "OPEN_LONG",
				reason: "momentum_long_confluence",
			};
		}

		return this.noAction(candles, "no_signal");
	}

	private minimumCandlesRequired(): number {
		return Math.max(
			this.config.breakoutLookback + 1,
			this.config.atrPeriod + this.config.atrEmaPeriod,
			this.config.volumeSmaPeriod,
			this.config.rsiPeriod + 1
		);
	}

	private toAtrInput = (candle: Candle): AtrInput => ({
		high: candle.high,
		low: candle.low,
		close: candle.close,
	});

	private calculateAtrEma(series: number[]): number | null {
		if (series.length < this.config.atrEmaPeriod) {
			return null;
		}
		const window = series.slice(-this.config.atrEmaPeriod);
		return ema(window, this.config.atrEmaPeriod);
	}

	private getBreakoutWindow(candles: Candle[]): Candle[] {
		const lookback = this.config.breakoutLookback;
		const start = Math.max(0, candles.length - (lookback + 1));
		return candles.slice(start, candles.length - 1);
	}

	private isBreakoutLong(price: number, window: Candle[]): boolean {
		if (window.length < this.config.breakoutLookback) {
			return false;
		}
		const highestHigh = Math.max(...window.map((candle) => candle.high));
		return price > highestHigh;
	}

	private isBreakoutShort(price: number, window: Candle[]): boolean {
		if (window.length < this.config.breakoutLookback) {
			return false;
		}
		const lowestLow = Math.min(...window.map((candle) => candle.low));
		return price < lowestLow;
	}

	private toTrendLabel(trend: HigherTimeframeTrend | null):
		| "bull"
		| "bear"
		| "chop" {
		if (!trend) {
			return "chop";
		}
		if (trend.isBull) {
			return "bull";
		}
		if (trend.isBear) {
			return "bear";
		}
		return "chop";
	}

	private isValueInRange(
		value: number | null,
		range: [number, number]
	): boolean {
		if (value === null) {
			return false;
		}
		return value >= range[0] && value <= range[1];
	}

	private getCloseReason(params: {
		shortSetupActive: boolean;
		macdBearish: boolean;
		atrInBreakout: boolean;
		volumeSpike: boolean;
		rsiValue: number | null;
	}): string | null {
		if (params.shortSetupActive) {
			return "momentum_opposite_signal";
		}
		if (params.macdBearish) {
			return "momentum_macd_flip_down";
		}
		if (!params.atrInBreakout && !params.volumeSpike) {
			return "momentum_volatility_collapse";
		}
		const exitBuffer = this.config.rsiExitBuffer ?? 5;
		if (
			params.rsiValue !== null &&
			params.rsiValue < this.config.rsiLongRange[0] - exitBuffer
		) {
			return "momentum_rsi_exit";
		}
		return null;
	}

	private logStrategyContext(
		latest: Candle,
		payload: {
			htfTrend: "bull" | "bear" | "chop";
			rsi: number | null;
			atr: number | null;
			atrEma: number | null;
			atrBreakout: boolean;
			volume: number;
			volumeSma: number | null;
			volumeSpike: boolean;
			macd1mHist: number | null;
			breakoutLong: boolean;
			breakoutShort: boolean;
			confluenceChecks: Record<string, unknown>;
		}
	): void {
		console.log(
			JSON.stringify({
				event: "strategy_context",
				symbol: latest.symbol,
				timeframe: latest.timeframe,
				timestamp: new Date(latest.timestamp).toISOString(),
				...payload,
			})
		);
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
