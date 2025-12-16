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
    exchange/
    strategies/
    risk/

  apps/
    trader-cli/
    backtester-cli/
    dashboard/

  packages/
    core/
    exchange-mexc/
    indicators/
    models-quant/
    strategy-engine/
    risk-engine/
    execution-engine/
    persistence/
    backtest-core/
```

Each package is isolated and reusable, following clean modular design.

---

## 🧠 System Architecture

### **1. Market Data**

- MEXC REST/WS swaps (candles/trades)
- REST fallback
- In-memory OHLCV cache

### **2. Indicators**

- EMA, MACD, RSI, ATR (pure functions)
- All deterministic and testable

### **3. Forecasting Models**

- AR(4) fast JS implementation
- MACD histogram forecast
- Error-correction regression

### **4. Strategy Engine**

Consumes:

- Candle windows
- Indicators
- Forecasts
- Config thresholds

Produces:

- `OPEN_LONG`
- `CLOSE_LONG`
- `OPEN_SHORT`
- `CLOSE_SHORT`
- `NO_ACTION`

### **5. Risk Engine**

- Max leverage
- Max positions
- Risk per trade %
- SL/TP sizing

### **6. Execution Engine**

- Converts trade plan → CCXT orders (MEXC linear swaps)
- Paper mode simulator and live order relay
- Rate-limit safe logic

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
Market Data
   → Indicators
      → Forecast Models
         → Strategy Engine
            → Intent
               → Risk Engine
                  → Execution Engine
                     → Exchange
```

---

## 🤖 AI Coding Agent Rules

If an AI assistant (Codex/GPT) is contributing:

1. Keep all code **modular**
2. Never hardcode config—use `/config`
3. Indicators + models must be **pure functions**
4. Exchange access must go through `exchange-mexc`
5. No circular imports
6. Live + backtest must share strategy code
7. Update the README if architecture changes

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
