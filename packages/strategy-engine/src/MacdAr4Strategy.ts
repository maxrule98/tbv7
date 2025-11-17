import { Candle, PositionSide, TradeIntent } from '@agenai/core';
import { macd } from '@agenai/indicators';
import { ar4Forecast } from '@agenai/models-quant';

export interface MacdAr4Config {
  emaFast: number;
  emaSlow: number;
  signal: number;
  arWindow: number;
  minForecast: number;
}

export class MacdAr4Strategy {
  constructor(private readonly config: MacdAr4Config) {}

  decide(candles: Candle[], position: PositionSide = 'FLAT'): TradeIntent {
    if (candles.length < Math.max(this.config.emaSlow, 6)) {
      return this.noAction(candles, 'insufficient_candles');
    }

    const closes = candles.map((candle) => candle.close);
    const latest = candles[candles.length - 1];
    const macdResult = macd(closes, this.config.emaFast, this.config.emaSlow, this.config.signal);
    const { macd: macdValue, signal, histogram } = macdResult;

    if (macdValue === null || signal === null || histogram === null) {
      return this.noAction(candles, 'macd_unavailable');
    }

    if (this.config.arWindow < 6) {
      return this.noAction(candles, 'ar_window_too_small');
    }

    const histogramSeries = Array.from({ length: this.config.arWindow }, () => histogram);
    const forecast = ar4Forecast(histogramSeries);

    if (position === 'LONG' && (macdValue < signal || forecast < 0)) {
      return {
        symbol: latest.symbol,
        intent: 'CLOSE_LONG',
        reason: 'macd_down_or_forecast_negative'
      };
    }

    if (forecast <= this.config.minForecast) {
      return this.noAction(candles, 'forecast_below_threshold');
    }

    if (position !== 'LONG' && macdValue > signal && forecast > this.config.minForecast) {
      return {
        symbol: latest.symbol,
        intent: 'OPEN_LONG',
        reason: 'macd_up_and_forecast_positive'
      };
    }

    return this.noAction(candles, position === 'LONG' ? 'holding_long' : 'no_signal');
  }

  private noAction(candles: Candle[], reason: string): TradeIntent {
    const latestSymbol = candles.length > 0 ? candles[candles.length - 1].symbol : 'UNKNOWN';
    return {
      symbol: latestSymbol,
      intent: 'NO_ACTION',
      reason
    };
  }
}
