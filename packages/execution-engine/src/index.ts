import { PositionSide } from '@agenai/core';
import { BinanceClient } from '@agenai/exchange-binance';
import { TradePlan } from '@agenai/risk-engine';

export class ExecutionEngine {
  constructor(private readonly client: BinanceClient) {}

  async getCurrentPosition(_symbol: string): Promise<PositionSide> {
    return 'FLAT';
  }

  async execute(plan: TradePlan): Promise<void> {
    await this.client.createMarketOrder(plan.symbol, plan.side, plan.quantity);
    console.log(
      JSON.stringify({
        event: 'execution_submitted',
        symbol: plan.symbol,
        side: plan.side,
        quantity: plan.quantity,
        stopLossPrice: plan.stopLossPrice,
        takeProfitPrice: plan.takeProfitPrice,
        reason: plan.reason
      })
    );
  }
}
