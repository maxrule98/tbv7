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
    exchange-binance/
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

`config/strategies/macd_ar4.json`:

```json
{
	"symbol": "BTC/USDT",
	"timeframe": "1m",
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

### **3. Run trader (paper by default)**

```bash
pnpm --filter trader-cli dev
```

### **4. Dev mode**

```bash
pnpm dev
```

---

## 🧰 Developer Commands

Quick reference for the unified workspace scripts:

| Command                                                | Description                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `pnpm dev`                                             | Run every package's local development watcher (recursive `dev`).            |
| `pnpm test`                                            | Validate strategy structure, then execute all package test suites.          |
| `pnpm backtest -- --start <iso> --end <iso> [options]` | Launch the backtest CLI with passthrough CLI args.                          |
| `pnpm metrics:process [--file <path>]`                 | Summarize the latest `output/backtests/*.json` result (or a provided file). |
| `pnpm strategy:list [--json]`                          | Print the registered strategies from the core registry.                     |
| `pnpm validate:strategies`                             | Standalone structural validation for per-strategy folders.                  |
| `pnpm clean`                                           | Remove build artifacts across packages and the `output/` folder.            |
| `pnpm format`                                          | Format the entire repo with Prettier.                                       |
| `pnpm trader:build`                                    | Compile the `@agenai/trader-cli` worker for production usage.               |
| `pnpm trader:start`                                    | Run the compiled trader worker (expects `trader:build` first).              |
| `pnpm server:build`                                    | Build the `@agenai/trader-server` HTTP entrypoint.                          |
| `pnpm server:start`                                    | Start the compiled trader server in production mode.                        |

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
