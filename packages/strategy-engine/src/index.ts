/**
 * Strategy engine converts indicator + forecast context into actionable intents.
 * This file only defines the data contracts for now.
 */
export type StrategyAction = 'OPEN_LONG' | 'CLOSE_LONG' | 'OPEN_SHORT' | 'CLOSE_SHORT' | 'NO_ACTION';

export interface StrategyContext {
  symbol: string;
  indicators: Record<string, number>;
  forecasts: Record<string, number | undefined>;
  positionSide?: 'long' | 'short' | null;
}

export interface StrategyIntent {
  action: StrategyAction;
  reason?: string;
}

export const createStrategyEngine = () => ({
  evaluate: (_context: StrategyContext): StrategyIntent => ({
    action: 'NO_ACTION',
    reason: 'Placeholder strategy engine'
  })
});
