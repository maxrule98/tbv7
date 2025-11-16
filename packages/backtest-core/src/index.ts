/**
 * Backtest core will later orchestrate historical data replay against the
 * strategy/risk/execution stack. For now this exposes a minimal harness hook.
 */
export interface BacktestOptions {
  symbol: string;
  timeframe: string;
  from: Date;
  to: Date;
}

export const createBacktestKernel = (_options: BacktestOptions) => ({
  run: async (): Promise<void> => {
    throw new Error('Backtest engine not implemented yet.');
  }
});
