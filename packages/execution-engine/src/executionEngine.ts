import { ExecutionReport, StrategyAction, TradePlan } from '@agenai/core';
import { BinanceExchangeClient } from '@agenai/exchange-binance';

export class ExecutionEngine {
  constructor(private readonly exchange: BinanceExchangeClient) {}

  async execute(plan: TradePlan): Promise<ExecutionReport> {
    await this.exchange.fetchPositions(plan.symbol); // sync positions before acting

    const entryOrder = await this.exchange.createOrder({
      symbol: plan.symbol,
      side: this.mapOrderSide(plan),
      type: 'market',
      amount: plan.amount,
      reduceOnly: plan.reduceOnly,
      params: {
        positionSide: plan.side === 'long' ? 'LONG' : 'SHORT',
        leverage: plan.leverage
      }
    });

    let stopOrderId: string | undefined;
    let takeProfitOrderId: string | undefined;

    if (!plan.reduceOnly && this.isOpenAction(plan.action)) {
      if (plan.slPrice) {
        const stopOrder = await this.exchange.createOrder({
          symbol: plan.symbol,
          side: plan.side === 'long' ? 'sell' : 'buy',
          type: 'stop',
          amount: plan.amount,
          price: plan.slPrice,
          reduceOnly: true,
          params: {
            stopPrice: plan.slPrice,
            positionSide: plan.side === 'long' ? 'LONG' : 'SHORT'
          }
        });
        stopOrderId = stopOrder.id;
      }

      if (plan.tpPrice) {
        const tpOrder = await this.exchange.createOrder({
          symbol: plan.symbol,
          side: plan.side === 'long' ? 'sell' : 'buy',
          type: 'take-profit',
          amount: plan.amount,
          price: plan.tpPrice,
          reduceOnly: true,
          params: {
            stopPrice: plan.tpPrice,
            positionSide: plan.side === 'long' ? 'LONG' : 'SHORT'
          }
        });
        takeProfitOrderId = tpOrder.id;
      }
    }

    return {
      plan,
      entryOrderId: entryOrder.id,
      stopOrderId,
      takeProfitOrderId
    };
  }

  private mapOrderSide(plan: TradePlan): 'buy' | 'sell' {
    if (plan.action === StrategyAction.OPEN_LONG || plan.action === StrategyAction.CLOSE_SHORT) {
      return 'buy';
    }
    return 'sell';
  }

  private isOpenAction(action: StrategyAction): boolean {
    return action === StrategyAction.OPEN_LONG || action === StrategyAction.OPEN_SHORT;
  }
}
