import 'dotenv/config';
import { Config, StrategyAction } from '@agenai/core';
import { BinanceExchangeClient } from '@agenai/exchange-binance';
import { emaSeries, macdSeries, rsiSeries } from '@agenai/indicators';
import { computeAr4Forecast } from '@agenai/models-quant';
import { StrategyEngine } from '@agenai/strategy-engine';
import { RiskEngine } from '@agenai/risk-engine';
import { ExecutionEngine } from '@agenai/execution-engine';

async function main(): Promise<void> {
  const [strategyConfig, riskConfig] = await Promise.all([
    Config.strategy('macd_ar4'),
    Config.risk('default')
  ]);

  const exchange = await BinanceExchangeClient.create('binance');
  const executionEngine = new ExecutionEngine(exchange);
  if (!exchange.hasCredentials()) {
    console.warn(
      'Binance API credentials are missing – running in analysis-only mode. Populate config/exchange/binance.json to enable trading.'
    );
  }
  const strategyEngine = new StrategyEngine(strategyConfig);
  const riskEngine = new RiskEngine(riskConfig);
  const symbol = strategyConfig.symbol;

  const candles = await exchange.fetchOHLCV({
    symbol,
    timeframe: strategyConfig.timeframe,
    limit: 500
  });

  if (candles.length === 0) {
    console.warn('No candle data available');
    return;
  }

  const closes = candles.map((candle) => candle.close);
  const emaFast = emaSeries(closes, strategyConfig.indicators.emaFast);
  const emaSlow = emaSeries(closes, strategyConfig.indicators.emaSlow);
  const macd = macdSeries(closes, {
    fastPeriod: strategyConfig.indicators.emaFast,
    slowPeriod: strategyConfig.indicators.emaSlow,
    signalPeriod: strategyConfig.indicators.signal
  });
  const rsi = rsiSeries(closes);
  const ar4 = computeAr4Forecast(closes);

  const indicatorSnapshot = {
    emaFast: last(emaFast),
    emaSlow: last(emaSlow),
    macdLine: last(macd.macd),
    macdSignal: last(macd.signal),
    macdHistogram: last(macd.histogram),
    rsi: last(rsi),
    macdLineSeries: macd.macd,
    macdSignalSeries: macd.signal,
    macdHistogramSeries: macd.histogram,
    rsiSeries: rsi
  };

  const positions = await exchange.fetchPositions(symbol);
  const currentPosition = positions[0];

  const intent = strategyEngine.evaluate({
    indicators: indicatorSnapshot,
    forecast: { ar4: ar4?.forecast },
    currentPositionSide: currentPosition?.side
  });

  console.log('Strategy intent:', intent);

  if (intent.action === StrategyAction.NO_ACTION) {
    return;
  }

  const accountState = await exchange.fetchBalance();
  const lastPrice = closes[closes.length - 1];
  const riskAssessment = riskEngine.evaluate(intent, accountState, symbol, lastPrice);

  if (!riskAssessment.shouldTrade || !riskAssessment.plan) {
    console.log('Risk rejected trade:', riskAssessment.reason);
    return;
  }

  const report = await executionEngine.execute(riskAssessment.plan);
  console.log('Execution report:', report);
}

function last(values: number[]): number | undefined {
  return values[values.length - 1];
}

main().catch((error) => {
  console.error('Trader CLI failed:', error);
  process.exit(1);
});
