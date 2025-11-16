# AgenAI Trader – Next-Gen Quant Trading Bot (v1)

AgenAI Trader is a modular, TypeScript-based algorithmic trading platform designed for **crypto futures**, built for both **manually designed strategies** and **AI-driven quant research**.

This repository starts fresh at **v1**, representing the final architecture aligned with our latest bot design and strategy engine.

---

## 🚀 Project Goals

- Build a **powerful, modular trading engine** with:

  - Exchange adapters (starting with Binance USDT-M Futures)
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

- Binance WebSockets (candles/trades)
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

- Converts trade plan → CCXT orders
- Syncs positions
- Manages SL/TP
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
	"riskPerTradePct": 0.5,
	"maxPositions": 1,
	"slPct": 1.0,
	"tpPct": 2.0
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

- API keys
- Testnet/mainnet toggle
- Symbol
- Logging options

### **3. Run live trader (testnet)**

```bash
pnpm --filter trader-cli dev
```

### **4. Dev mode**

```bash
pnpm dev
```

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
4. Exchange access must go through `exchange-binance`
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
