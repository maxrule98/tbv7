/**
 * Minimal AgenAI Trader CLI bootstrap. This simply reads config stubs and
 * prints the architecture plan so we can layer in functionality incrementally.
 */
import path from 'path';

const bootstrap = async () => {
  const cwd = path.resolve(__dirname);
  console.log('AgenAI Trader CLI');
  console.log('Working directory:', cwd);
  console.log('Config paths:');
  console.log('  - config/exchange/binance.testnet.json');
  console.log('  - config/strategies/macd_ar4.json');
  console.log('  - config/risk/default.json');
  console.log('TODO: load packages/core + engines once implementations land.');
};

bootstrap().catch((error) => {
  console.error('Trader CLI failed to start:', error);
  process.exit(1);
});
