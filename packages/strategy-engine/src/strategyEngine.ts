import {
  ForecastSet,
  IndicatorSet,
  PositionSide,
  StrategyAction,
  StrategyConfig,
  StrategyIntent
} from '@agenai/core';

export interface IndicatorSeriesSnapshot extends IndicatorSet {
  macdLineSeries?: number[];
  macdSignalSeries?: number[];
  macdHistogramSeries?: number[];
  rsiSeries?: number[];
}

export interface StrategyInputs {
  indicators: IndicatorSeriesSnapshot;
  forecast: ForecastSet;
  currentPositionSide?: PositionSide | null;
}

export class StrategyEngine {
  constructor(private readonly config: StrategyConfig) {}

  evaluate(inputs: StrategyInputs): StrategyIntent {
    const histogramSeries = inputs.indicators.macdHistogramSeries ?? [];
    const latestHistogram = histogramSeries[histogramSeries.length - 1];
    const previousHistogram = histogramSeries[histogramSeries.length - 2];
    const ar4Forecast = inputs.forecast.ar4 ?? 0;

    if (!Number.isFinite(latestHistogram) || !Number.isFinite(previousHistogram)) {
      return this.noAction('Insufficient MACD data');
    }

    const crossedUp = previousHistogram < 0 && latestHistogram > 0;
    const crossedDown = previousHistogram > 0 && latestHistogram < 0;
    const minForecast = this.config.thresholds.ar4ForecastMin ?? 0;

    if (inputs.currentPositionSide === 'long') {
      if (crossedDown || ar4Forecast < minForecast) {
        return {
          action: StrategyAction.CLOSE_LONG,
          confidence: Math.abs(latestHistogram),
          reason: crossedDown ? 'MACD cross down' : 'AR4 forecast deteriorated'
        };
      }
      return this.noAction('Holding long position');
    }

    if (inputs.currentPositionSide === 'short') {
      if (crossedUp || ar4Forecast > minForecast) {
        return {
          action: StrategyAction.CLOSE_SHORT,
          confidence: Math.abs(latestHistogram),
          reason: 'Reversal signal'
        };
      }
      return this.noAction('Holding short position');
    }

    if (this.allowsLongs() && crossedUp && ar4Forecast >= minForecast) {
      return {
        action: StrategyAction.OPEN_LONG,
        confidence: Math.min(1, Math.abs(ar4Forecast)),
        reason: 'MACD cross + AR4 confirmation'
      };
    }

    if (this.allowsShorts() && crossedDown && ar4Forecast <= -minForecast) {
      return {
        action: StrategyAction.OPEN_SHORT,
        confidence: Math.min(1, Math.abs(ar4Forecast)),
        reason: 'MACD cross down + AR4 confirmation'
      };
    }

    return this.noAction('No qualifying signal');
  }

  private allowsLongs(): boolean {
    return this.config.mode === 'both' || this.config.mode === 'long-only';
  }

  private allowsShorts(): boolean {
    return this.config.mode === 'both' || this.config.mode === 'short-only';
  }

  private noAction(reason: string): StrategyIntent {
    return {
      action: StrategyAction.NO_ACTION,
      confidence: 0,
      reason
    };
  }
}
