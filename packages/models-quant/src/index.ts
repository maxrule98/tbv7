/**
 * Quantitative forecasting models (AR, regression, ML). Currently just a
 * placeholder so other packages can type against the factory signature.
 */
export interface ForecastRequest {
  symbol: string;
  timeframe: string;
  closes: number[];
}

export interface ForecastResult {
  [model: string]: number | undefined;
}

export const runForecastModels = (_request: ForecastRequest): ForecastResult => ({
  ar4: undefined
});
