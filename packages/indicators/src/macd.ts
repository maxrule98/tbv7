import { emaSeries } from './ema';

export interface MacdSeries {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export interface MacdParams {
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
}

export function macdSeries(values: number[], params: MacdParams = {}): MacdSeries {
  const fastPeriod = params.fastPeriod ?? 12;
  const slowPeriod = params.slowPeriod ?? 26;
  const signalPeriod = params.signalPeriod ?? 9;

  if (values.length === 0) {
    return { macd: [], signal: [], histogram: [] };
  }

  const fast = emaSeries(values, fastPeriod);
  const slow = emaSeries(values, slowPeriod);
  const macd = values.map((_, idx) => fast[idx] - slow[idx]);
  const signal = emaSeries(macd, signalPeriod);
  const histogram = macd.map((value, idx) => value - signal[idx]);

  return { macd, signal, histogram };
}
