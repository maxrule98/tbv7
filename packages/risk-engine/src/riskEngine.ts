import {
  AccountState,
  Position,
  PositionSide,
  RiskAssessment,
  RiskConfig,
  StrategyAction,
  StrategyIntent,
  TradePlan
} from '@agenai/core';

export class RiskEngine {
  constructor(private readonly config: RiskConfig) {}

  evaluate(intent: StrategyIntent, account: AccountState, symbol: string, lastPrice: number): RiskAssessment {
    if (intent.action === StrategyAction.NO_ACTION) {
      return { shouldTrade: false, reason: intent.reason ?? 'No action' };
    }

    const side = this.sideFromIntent(intent.action);
    if (!side) {
      return { shouldTrade: false, reason: 'Unsupported action' };
    }

    if (this.isCloseAction(intent.action)) {
      const position = this.findPosition(account.positions, symbol, side);
      if (!position) {
        return { shouldTrade: false, reason: 'No position to close' };
      }
      const plan: TradePlan = {
        action: intent.action,
        symbol,
        side,
        amount: position.contracts,
        entryPrice: lastPrice,
        leverage: position.leverage,
        reduceOnly: true
      };
      return { shouldTrade: true, plan };
    }

    if (account.positions.length >= this.config.maxPositions) {
      return { shouldTrade: false, reason: 'Max positions reached' };
    }

    const plan = this.buildEntryPlan(symbol, side, account, lastPrice, intent.action);
    if (!plan) {
      return { shouldTrade: false, reason: 'Unable to size trade' };
    }

    return { shouldTrade: true, plan };
  }

  private buildEntryPlan(
    symbol: string,
    side: PositionSide,
    account: AccountState,
    lastPrice: number,
    action: StrategyAction
  ): TradePlan | null {
    const riskFraction = this.config.riskPerTradePct / 100;
    const slFraction = this.config.slPct / 100;

    if (riskFraction <= 0 || slFraction <= 0 || account.balanceUSDT <= 0) {
      return null;
    }

    const riskCapital = account.balanceUSDT * riskFraction;
    const stopDistance = lastPrice * slFraction;
    const rawContracts = riskCapital / stopDistance;
    if (!Number.isFinite(rawContracts) || rawContracts <= 0) {
      return null;
    }

    const positionValue = rawContracts * lastPrice;
    const maxNotional = account.balanceUSDT * this.config.maxLeverage;
    const cappedContracts = Math.min(rawContracts, maxNotional / lastPrice);

    const slPrice = side === 'long' ? lastPrice * (1 - slFraction) : lastPrice * (1 + slFraction);
    const tpFraction = this.config.tpPct / 100;
    const tpPrice = side === 'long' ? lastPrice * (1 + tpFraction) : lastPrice * (1 - tpFraction);

    return {
      action,
      symbol,
      side,
      amount: Number(cappedContracts.toFixed(6)),
      entryPrice: lastPrice,
      leverage: this.config.maxLeverage,
      slPrice,
      tpPrice,
      reduceOnly: false
    };
  }

  private findPosition(positions: Position[], symbol: string, side: PositionSide): Position | undefined {
    return positions.find((position) => position.symbol === symbol && position.side === side);
  }

  private sideFromIntent(action: StrategyAction): PositionSide | null {
    switch (action) {
      case StrategyAction.OPEN_LONG:
      case StrategyAction.CLOSE_LONG:
        return 'long';
      case StrategyAction.OPEN_SHORT:
      case StrategyAction.CLOSE_SHORT:
        return 'short';
      default:
        return null;
    }
  }

  private isCloseAction(action: StrategyAction): boolean {
    return action === StrategyAction.CLOSE_LONG || action === StrategyAction.CLOSE_SHORT;
  }
}
