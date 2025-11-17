import ccxt from 'ccxt';
import type { Exchange, OHLCV } from 'ccxt';

export interface BinanceClientOptions {
  apiKey: string;
  apiSecret: string;
  useTestnet: boolean;
}

export interface FetchOHLCVParams {
  symbol: string;
  timeframe: string;
  since?: number;
  limit?: number;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class BinanceClient {
  private readonly exchange: Exchange;

  constructor(options: BinanceClientOptions) {
    this.exchange = new ccxt.binanceusdm({
      apiKey: options.apiKey,
      secret: options.apiSecret,
      enableRateLimit: true,
      options: {
        defaultType: 'future',
        defaultMarket: 'future'
      }
    });

    this.exchange.setSandboxMode(options.useTestnet);
  }

  async fetchOHLCV(params: FetchOHLCVParams): Promise<Candle[]> {
    const candles = await this.exchange.fetchOHLCV(
      params.symbol,
      params.timeframe,
      params.since,
      params.limit
    );

    return candles.map(BinanceClient.mapCandle);
  }

  private static mapCandle(candle: OHLCV): Candle {
    const [timestamp, open, high, low, close, volume] = candle;

    if (
      timestamp === undefined ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      volume === undefined
    ) {
      throw new Error('Received incomplete OHLCV data from Binance.');
    }

    return {
      timestamp: Number(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume)
    };
  }
}
