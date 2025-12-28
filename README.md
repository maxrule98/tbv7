# AgenAI Trader – Next-Gen Quant Trading Bot (v1)

AgenAI Trader is a modular, TypeScript-based algorithmic trading platform designed for **crypto futures**, built for both **manually designed strategies** and **AI-driven quant research**.

This repository starts fresh at **v1**, representing the final architecture aligned with our latest bot design and strategy engine.

---

## 🚀 Project Goals

- Build a **powerful, modular trading engine** with:
  - Exchange adapters (currently MEXC USDT-M perpetuals)
  - Real-time WebSocket market data
  - Deterministic indicator pipelines (MACD, EMA, RSI, ATR…)
  - Forecasting models (AR(4), MACD forecast, regression error-correction)
  - JSON-configurable strategies
  - Risk management & position sizing
  - Smart execution system

- Foundation for:
  - Live trading
  - Backtesting
  - Visual dashboards
  - Strategy experimentation

---

## 📦 Monorepo Structure

```
agenai-trader/
  config/
    account/          # Paper/live account configs
    exchange/         # Exchange-specific settings
    strategies/       # Strategy JSON configurations
    risk/             # Risk management profiles

  apps/
    trader-cli/       # CLI for live trading
    trader-server/    # HTTP server for live trading
    backtest-cli/     # CLI for backtesting
    dashboard/        # (Future) UI dashboard
    app-di/           # Shared dependency injection layer

  packages/
    core/             # Core types, strategies, config
    data/             # Historical data provider
    runtime/          # Unified runtime (live + backtest)
    exchange-mexc/    # MEXC exchange adapter
    exchange-binance/ # Binance exchange adapters
    indicators/       # Pure indicator functions
    models-quant/     # Forecasting models
    strategy-engine/  # Strategy orchestration
    risk-engine/      # Position sizing & risk mgmt
    execution-engine/ # Order execution (paper/live)
    metrics/          # Backtest performance analytics
    persistence/      # (Future) Trade logging
```

Each package is isolated and reusable, following clean modular design with strict import boundaries.

---

## 🧠 System Architecture

### **Core Principles**

- **Runtime Parity**: Live trading and backtesting share identical tick pipeline via `@agenai/runtime`
- **Import Boundaries**: No exchange imports in runtime; data flows through provider abstractions
- **Dependency Injection**: Apps use `@agenai/app-di` for consistent service wiring
- **Closed-Candle Policy**: Strategies only execute on completed candles
 
### **1. Market Data Layer**

- **Exchange Adapters** (`@agenai/exchange-mexc`, `@agenai/exchange-binance`)
  - Wrap CCXT for REST API access
  - Fetch OHLCV via `fetchOHLCV()`
- **Data Providers** (`@agenai/data`)
  - `DefaultDataProvider`: Historical data loading with pagination
  - `loadHistoricalSeries()`: Multi-timeframe concurrent fetching
- **Market Data Providers** (`@agenai/runtime/marketData`)
  - `PollingMarketDataProvider`: REST polling for live data
  - `BinanceUsdMMarketDataProvider`: WebSocket streams + REST bootstrap
  - Both provide `bootstrap()` and `createFeed()` APIs

### **2. Indicators & Models**

- **Indicators** (`@agenai/indicators`)
  - Pure functions: EMA, MACD, RSI, ATR, VWAP, etc.
  - Deterministic and fully testable
- **Forecasting Models** (`@agenai/models-quant`)
  - AR(4) autoregression
  - MACD histogram forecast
  - Error-correction regression

### **3. Strategy Layer**

- **Strategy Registry** (`@agenai/core/strategies`)
  - Auto-discovers strategies from filesystem
  - Validates unique IDs and required fields
  - Powers `pnpm strategy:list`
- **Strategy Engine** (`@agenai/strategy-engine`)
  - Orchestrates indicator → model → decision pipeline
  - Produces trade intents: `OPEN_LONG`, `CLOSE_LONG`, `OPEN_SHORT`, `CLOSE_SHORT`, `NO_ACTION`

### **4. Risk & Execution**

- **Risk Engine** (`@agenai/risk-engine`)
  - Position sizing via risk-per-trade %
  - Stop-loss / take-profit calculation
  - Validates against max leverage & position limits
- **Execution Engine** (`@agenai/execution-engine`)
  - Paper mode: In-memory position tracking with PnL simulation
  - Live mode: CCXT order submission
  - Trailing stop logic with activation thresholds

### **5. Unified Runtime**

- **Runtime Package** (`@agenai/runtime`)
  - `runTick()`: Canonical tick pipeline (position checks → exits → strategy → risk → execute)
  - `startTrader()`: Live trading loop with feed subscription
  - `backtestRunner()`: Replay historical candles through same pipeline
  - Both modes use identical logging, fingerprinting, and decision logic
- **Runtime Snapshot** (`createRuntimeSnapshot()`)
  - Resolves configs once: strategy, risk, account, exchange
  - Generates fingerprints for reproducibility
  - Tracks metadata for parity verification

### **6. Metrics & Analytics**

- **Metrics Engine** (`@agenai/metrics`)
  - Post-backtest analysis: Sharpe, Sortino, max drawdown, R-multiples
  - Trade-level CSV exports with session grouping
  - Win/loss/breakeven statistics

---

## 🧪 Strategy Example

Every strategy JSON file must declare an `id` that matches one of the registered modules (see `pnpm --filter @agenai/core run strategy:list`). This keeps CLI/runtime selection dynamic and avoids hardcoded ids.

`config/strategies/macd_ar4.json`:

```json
{
	"id": "macd_ar4",
	"symbol": "BTC/USDT",
	"timeframe": "1m",
	"historyWindowCandles": 450,
	"warmupPeriods": {
		"default": 120,
		"1m": 240
	},
	"indicators": {
		"emaFast": 12,
		"emaSlow": 26,
		"signal": 9
	},
	"thresholds": {
		"macdCrossUp": true,
		"ar4ForecastMin": 0
	},
	"mode": "long-only"
}
```

Declare `warmupPeriods` (per timeframe candle counts) and `historyWindowCandles` for every strategy profile so backtests and live caches know how much historical data to hydrate without relying on hardcoded defaults.

---

## 🧱 Strategy Registry & Runtime Parity

### Strategy registry lifecycle

- Every strategy lives under `packages/core/src/strategies/<strategy-id>/` and exports a `StrategyRegistryEntry`.
- The registry auto-discovers all directories at startup, rejects duplicate ids, and powers `pnpm strategy:list` plus config validation.
- To add a new strategy:
  1. Scaffold a new directory with an `index.ts` that exports the entry.
  2. Declare a default profile name (used when no CLI override is provided).
  3. Create a matching JSON config under `config/strategies/` with `id` pointing to the registry entry.

### Shared strategy runtime

- Both `startTrader` (live) and `runBacktest` now live inside `@agenai/runtime`, and the first-class commands (`pnpm backtest ...`, `pnpm server:start`) do nothing more than call those APIs.
- The runtime snapshot pipeline resolves the instrument symbol/timeframe, tracked timeframes, warmup windows, and cache limits exactly once, then feeds those artifacts into whichever runner invoked it.
- Because the snapshot + metadata layer sits inside `@agenai/runtime`, any config change is honored everywhere without bespoke loaders, ensuring live/backtest parity by construction.

### Required strategy config fields

Every strategy profile must include the following keys so the runtime can self-describe:

- `id`: Must match a registry entry.
- `symbol`: Default trading symbol (used when CLI flags omit overrides).
- `timeframes.execution`: Primary loop timeframe.
- `trackedTimeframes`: Optional array to declare extra caches; used by runtime parity.
- `warmupPeriods`: Map of timeframe → candle count (`default` fallback is recommended).
- `historyWindowCandles`: Upper bound for cache sizes and backtest timeframes when no explicit `maxCandles` is supplied.
- `cacheTTLms`: Required for live trading so the runtime knows when to refresh MultiTimeframeCache instances.

Missing any of the above will cause `loadStrategyConfig()` (and therefore every CLI) to fail fast with a descriptive validation error.

### CLI usage examples

The CLI entry points now consume the registry metadata end-to-end:

```bash
# List every registered strategy and its default profile
pnpm strategy:list

# Run a backtest (--strategy is REQUIRED)
pnpm backtest -- \
  --strategy=ultra_aggressive_btc_usdt \
  --start "2024-01-01T00:00:00Z" --end "2024-01-02T00:00:00Z" \
  --withMetrics

# Launch the trader server (--strategy is REQUIRED)
pnpm server:start -- --strategy=ultra_aggressive_btc_usdt
```

**Important:** The `--strategy=<id>` flag is now **required** for both backtest and server CLIs. Use the strategy's registered `id` (not the profile name). The flag accepts `--strategyId` as an alias. If you omit the flag, you'll get a helpful error listing all available strategy ids.

Because the CLI commands defer to the shared runtime factory, warmup windows, cache sizes, and tracked timeframes stay in sync between historical simulations and live execution.

---

## ⚙️ Risk Config Example

`config/risk/default.json`:

```json
{
	"maxLeverage": 5,
	"riskPerTradePercent": 0.01,
	"maxPositions": 1,
	"slPct": 1.0,
	"tpPct": 2.0,
	"minPositionSize": 0.0005,
	"maxPositionSize": 0.01
}
```

---

## 🛠️ Getting Started

### **1. Install dependencies**

```bash
pnpm install
```

### **2. Create environment file**

```bash
cp .env.example .env.live
```

Set:

- `EXCHANGE_ID` (`mexc`)
- `MEXC_API_KEY` / `MEXC_API_SECRET` (leave blank for paper mode)
- `EXECUTION_MODE` (`paper` or `live`)
- Symbol + timeframe overrides

### **3. Run a parity backtest (uses @agenai/runtime)**

```bash
# List available strategies first
pnpm strategy:list

# Run backtest with required --strategy flag
pnpm backtest -- \
  --strategy=ultra_aggressive_btc_usdt \
  --start "2024-01-01T00:00:00Z" \
  --end "2024-01-02T00:00:00Z"
```

### **4. Start the trader server (paper/live via @agenai/runtime)**

```bash
pnpm server:start -- --strategy=ultra_aggressive_btc_usdt
```

### **5. Dev mode**

```bash
pnpm dev
```

---

## 🧰 Developer Commands

Quick reference for the unified workspace scripts:

| Command                                                      | Description                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                   | Run every package's local development watcher (recursive `dev`).                                         |
| `pnpm test`                                                  | Validate strategy structure, then execute all package test suites.                                       |
| `pnpm backtest -- --strategy=<id> --start <iso> --end <iso>` | Run a new backtest, persisting JSON under `output/backtests/` (add `--withMetrics` to auto-run metrics). |
| `pnpm metrics:process --file <backtest>`                     | Analyze any saved backtest file and export summary KPIs plus CSV diagnostics.                            |
| `pnpm strategy:list [--json]`                                | Print the registered strategies from the core registry.                                                  |
| `pnpm runtime:print-config -- --strategy=<id>`               | Show canonicalized configs, paths, and fingerprints for the requested strategy.                          |
| `pnpm validate:strategies`                                   | Standalone structural validation for per-strategy folders.                                               |
| `pnpm clean`                                                 | Remove build artifacts across packages and the `output/` folder.                                         |
| `pnpm format`                                                | Format the entire repo with Prettier.                                                                    |
| `pnpm trader:build`                                          | Compile the `@agenai/trader-cli` worker for production usage.                                            |
| `pnpm trader:start`                                          | Run the compiled trader worker (expects `trader:build` first).                                           |
| `pnpm server:build`                                          | Build the `@agenai/trader-server` HTTP entrypoint.                                                       |
| `pnpm server:start -- --strategy=<id>`                       | Start the compiled trader server in production mode (--strategy required).                               |

---

## 📊 Metrics Engine

- Analyze any saved backtest via `pnpm metrics:process [--file <path>] [--mode summary|trades|grouped] [--riskFreeRate 0.02] [--riskUnitUsd 150]`.
- Outputs `output/metrics/<run>.summary.json`, `...trades.csv`, and `...playtypes.csv` for spreadsheets or dashboards.
- Metrics include drawdown spans, Sharpe/Sortino variants, R-multiple CAGR, streak diagnostics, and play-type/session insights.
- Append `--withMetrics` to any `pnpm backtest ...` command to generate a JSON artifact and immediately process it via the metrics CLI.

---

## 🧭 Live Trading Flow

```
Market Data Provider (WebSocket/Polling)
   ↓ (closed candle event)
runTick() Pipeline:
   1. Get Position & Calculate Unrealized PnL
   2. Check Forced Exits (SL/TP/Trailing Stop)
   3. Strategy.decide() → Trade Intent
   4. Risk Manager → Trade Plan
   5. Execution Provider → Order/Fill
   6. Snapshot Account State
   7. Log Metrics & Diagnostics
   ↓
Persist Trade Records (optional)
```

### Backtest Flow (Same Pipeline)

```
Historical Candles (from @agenai/data)
   ↓ (replay each candle)
runTick() Pipeline (identical to live)
   ↓
Metrics Engine Analysis
```

Both modes execute the **same `runTick()` function** ensuring deterministic parity.

---

## � Testing & Quality

### Test Structure

- **Unit Tests**: Each package has `*.test.ts` files using Vitest
- **Parity Tests**: `runtime/src/runtimeParity.test.ts` verifies live/backtest produce identical intents
- **Import Boundary Tests**: `runtime/src/__tests__/import-boundary.test.ts` enforces no exchange imports in runtime

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @agenai/runtime test

# Watch mode for development
pnpm --filter @agenai/core test --watch
```

### Import Boundaries

Strict rules enforced by tests:

- `@agenai/runtime` **MUST NOT** import from exchange packages
- Data flows through `ExchangeAdapter` → `DataProvider` → `MarketDataProvider` abstractions
- Prevents tight coupling and enables runtime flexibility

---

## 🤖 AI Coding Assistant Guidelines

When contributing to this codebase:

1. **Modularity First**: Keep packages isolated with clear interfaces
2. **Config-Driven**: Never hardcode—use `/config` JSON files
3. **Pure Functions**: Indicators and models must be deterministic
4. **Type Safety**: Leverage TypeScript strictly; avoid `any`
5. **Abstraction Layers**: Exchange access through `ExchangeAdapter`, no direct CCXT in runtime
6. **No Circular Imports**: Use dependency injection via `@agenai/app-di`
7. **Runtime Parity**: Live and backtest share `runTick()` pipeline
8. **Test Coverage**: Add tests for new features; verify parity invariants
9. **Import Boundaries**: Respect layer separation (see tests)
10. **Documentation**: Update README/CONTRIBUTING for architectural changes

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed development workflows.

---

## 🗺 Roadmap

### **v1 – MVP (current)**

- Exchange client
- Indicators
- AR(4) + MACD strategy
- SL/TP
- Live event loop

### **v2 – Platform**

- WebSocket candles
- Multi-symbol
- Dashboard UI
- Trade logging

### **v3 – Advanced**

- Portfolio engine
- Multi-strategy
- Reinforcement training

---

## 📄 License

MIT
