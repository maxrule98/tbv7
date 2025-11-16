/**
 * Deterministic indicator pipeline placeholders. Concrete indicator math will
 * be implemented alongside streaming data handlers.
 */
export interface IndicatorRequest {
  symbol: string;
  timeframe: string;
  lookback: number;
}

export interface IndicatorSnapshot {
  [indicator: string]: number;
}

export const evaluateIndicators = (_request: IndicatorRequest): IndicatorSnapshot => ({
  placeholder: 0
});
