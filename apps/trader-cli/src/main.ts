import { loadAgenaiConfig } from '@agenai/core';
import { BinanceClient, Candle } from '@agenai/exchange-binance';

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

  console.info('AgenAI Trader CLI started');
  console.info(JSON.stringify({ symbol, timeframe, useTestnet: exchange.testnet }));

  await startPolling(client, symbol, timeframe);
};

const startPolling = async (
  client: BinanceClient,
  symbol: string,
  timeframe: string
): Promise<never> => {
  let lastTimestamp: number | undefined;

  while (true) {
    try {
      const candles = await client.fetchOHLCV({ symbol, timeframe, limit: 1 });
      const latest = candles[candles.length - 1];

      if (!latest) {
        console.warn('No candle data returned for', symbol);
      } else if (latest.timestamp !== lastTimestamp) {
        logCandle(latest, symbol, timeframe);
        lastTimestamp = latest.timestamp;
      } else {
        console.info('No new candle yet for', symbol);
      }
    } catch (error) {
      console.error('Failed to fetch candles:', error);
    }

    await delay(POLL_INTERVAL_MS);
  }
};

const logCandle = (candle: Candle, symbol: string, timeframe: string): void => {
  const payload = {
    symbol,
    timeframe,
    timestamp: new Date(candle.timestamp).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  };
  console.info('Latest candle:', payload);
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

main().catch((error) => {
  console.error('Trader CLI failed:', error);
  process.exit(1);
});
