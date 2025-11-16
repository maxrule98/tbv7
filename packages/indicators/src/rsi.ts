export function rsiSeries(values: number[], period = 14): number[] {
  if (period <= 0) {
    throw new Error('RSI period must be positive');
  }

  if (values.length === 0) {
    return [];
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period && i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  const rsis: number[] = [];
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < values.length; i += 1) {
    if (i > period) {
      const change = values[i] - values[i - 1];
      const gain = Math.max(change, 0);
      const loss = Math.max(-change, 0);
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    const rsRatio = avgLoss === 0 ? Number.POSITIVE_INFINITY : avgGain / avgLoss;
    const rsi = rsRatio === Number.POSITIVE_INFINITY ? 100 : 100 - 100 / (1 + rsRatio);
    rsis.push(Number.isFinite(rsi) ? rsi : 0);
  }

  return rsis;
}
