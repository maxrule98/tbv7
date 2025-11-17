import { BinanceClient } from '@agenai/exchange-binance';
import { TradePlan } from '@agenai/risk-engine';

export interface ExecutionResult {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  status: string;
  price?: number | null;
}

export class ExecutionEngine {
  constructor(private readonly client: BinanceClient) {}

  async execute(plan: TradePlan): Promise<ExecutionResult> {
    const order = await this.client.createMarketOrder(plan.symbol, plan.side, plan.quantity);
    return {
      symbol: plan.symbol,
      side: plan.side,
      quantity: plan.quantity,
      status: order?.status ?? 'unknown',
      price: order?.average ?? order?.price ?? null
    };
  }
}
