/**
 * Binance exchange adapter placeholder. Future implementation will translate
 * AgenAI intents into CCXT calls while respecting testnet/live separation.
 */
export interface ExchangeCredentials {
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
}

export interface ExchangeAdapterInit {
  restEndpoint?: string;
  wsEndpoint?: string;
  isTestnet?: boolean;
  credentials?: ExchangeCredentials;
}

export interface ExchangeAdapter {
  readonly id: 'binance';
  readonly options: ExchangeAdapterInit;
}

export const createBinanceExchangeAdapter = (
  options: ExchangeAdapterInit = {}
): ExchangeAdapter => ({
  id: 'binance',
  options
});
