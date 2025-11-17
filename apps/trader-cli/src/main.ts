import { Candle, TradeIntent, loadAgenaiConfig } from '@agenai/core';
import { BinanceClient } from '@agenai/exchange-binance';
import { MacdAr4Strategy } from '@agenai/strategy-engine';

const POLL_INTERVAL_MS = 10_000;

const main = async (): Promise<void> => {
  const config = loadAgenaiConfig();
  const exchange = config.exchange;

  const client = new BinanceClient({
    apiKey: exchange.credentials.apiKey,
    apiSecret: exchange.credentials.apiSecret,
    useTestnet: exchange.testnet
  });

  const symbol = config.env.defaultSymbol || exchange.defaultSymbol || config.strategy.symbol;
  const timeframe = config.env.defaultTimeframe || config.strategy.timeframe;

  const strategy = new MacdAr4Strategy({
    emaFast: 12,
    emaSlow: 26,
    signal: 9,
    arWindow: 20,
    minForecast: 0
  });

  console.info('AgenAI Trader CLI started');
  console.info(JSON.stringify({ symbol, timeframe, useTestnet: exchange.testnet }));

  const candlesBySymbol = new Map<string, Candle[]>();
  const lastTimestampBySymbol = new Map<string, number>();

  await startPolling(client, strategy, symbol, timeframe, candlesBySymbol, lastTimestampBySymbol);
};

const startPolling = async (
  client: BinanceClient,
  strategy: MacdAr4Strategy,
  symbol: string,
  timeframe: string,
  candlesBySymbol: Map<string, Candle[]>,
  lastTimestampBySymbol: Map<string, number>
): Promise<never> => {
  while (true) {
    try {
      const candles = await client.fetchOHLCV({ symbol, timeframe, limit: 1 });
      const latestRaw = candles[candles.length - 1];

      if (!latestRaw) {
        console.warn('No candle data returned for', symbol);
      } else {
        const latest: Candle = {
          symbol,
          timeframe,
          timestamp: latestRaw.timestamp,
          open: latestRaw.open,
          high: latestRaw.high,
          low: latestRaw.low,
          close: latestRaw.close,
          volume: latestRaw.volume
        };

        const lastTimestamp = lastTimestampBySymbol.get(symbol);

        if (lastTimestamp !== latest.timestamp) {
          lastTimestampBySymbol.set(symbol, latest.timestamp);
          const buffer = appendCandle(candlesBySymbol, latest);
          logCandle(latest);

          const intent = strategy.decide(buffer);
          logStrategyDecision(latest, intent);
        } else {
          console.info('No new candle yet for', symbol);
        }
      }
    } catch (error) {
      console.error('Failed to fetch candles:', error);
    }

    await delay(POLL_INTERVAL_MS);
  }
};

const appendCandle = (candlesBySymbol: Map<string, Candle[]>, candle: Candle): Candle[] => {
  const buffer = candlesBySymbol.get(candle.symbol) ?? [];
  buffer.push(candle);
  if (buffer.length > 500) {
    buffer.splice(0, buffer.length - 500);
  }
  candlesBySymbol.set(candle.symbol, buffer);
  return buffer;
};

const logCandle = (candle: Candle): void => {
  const payload = {
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    timestamp: new Date(candle.timestamp).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  };
  console.info('Latest candle:', payload);
};

const logStrategyDecision = (candle: Candle, intent: TradeIntent): void => {
  console.log(
    JSON.stringify({
      event: 'strategy_decision',
      symbol: candle.symbol,
      timestamp: new Date(candle.timestamp).toISOString(),
      close: candle.close,
      intent: intent.intent,
      reason: intent.reason
    })
  );
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

main().catch((error) => {
  console.error('Trader CLI failed:', error);
  process.exit(1);
});
