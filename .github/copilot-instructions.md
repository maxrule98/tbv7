# GitHub Copilot Instructions for AgenAI Trader

This document provides context and guidelines for GitHub Copilot when assisting with the AgenAI Trader codebase.

---

## Project Overview

AgenAI Trader is a **modular TypeScript algorithmic trading platform** for cryptocurrency futures. The project prioritizes:

- **Runtime Parity**: Live trading and backtesting share identical code paths
- **Type Safety**: Strict TypeScript with explicit types throughout
- **Modularity**: Clean package boundaries with dependency injection
- **Testability**: Pure functions, deterministic strategies, comprehensive tests

---

## Critical Architecture Rules

### 1. Import Boundaries (ENFORCED BY TESTS)

**Rule**: `@agenai/runtime` MUST NOT import from exchange packages

```typescript
// ❌ FORBIDDEN in @agenai/runtime
import { MexcClient } from "@agenai/exchange-mexc";
import { BinanceClient } from "@agenai/exchange-binance";

// ✅ CORRECT: Use abstractions
import type { ExchangeAdapter } from "@agenai/core";
import type { MarketDataProvider } from "./marketData/types";
```

**Why**: Enables runtime flexibility and prevents tight coupling. Data flows through:

```
ExchangeAdapter → DataProvider → MarketDataProvider → Runtime
```

**Verification**: `packages/runtime/src/__tests__/import-boundary.test.ts`

### 2. Runtime Parity (VERIFIED BY TESTS)

**Rule**: Live and backtest modes execute the same `runTick()` pipeline

```typescript
// Both modes call this SAME function
export async function runTick(input: TickInput): Promise<TickResult> {
	// 1. Get position & unrealized PnL
	// 2. Check forced exits (SL/TP/trailing)
	// 3. Strategy decision
	// 4. Risk planning
	// 5. Execution
	// 6. Snapshot & logging
}
```

**Why**: Ensures deterministic behavior and prevents look-ahead bias

**Locations**:

- Pipeline: `packages/runtime/src/loop/runTick.ts`
- Live wrapper: `packages/runtime/src/startTrader.ts`
- Backtest wrapper: `packages/runtime/src/backtest/backtestRunner.ts`
- Verification: `packages/runtime/src/runtimeParity.test.ts`

### 3. Closed-Candle Policy

**Rule**: Strategies only execute on completed candles

```typescript
// ✅ CORRECT: Wait for candle completion
feed.onCandle(async (event: ClosedCandleEvent) => {
  // event.candle is now complete and immutable
  await runTick({ candle: event.candle, ... });
});

// ❌ WRONG: Acting on incomplete data
const currentPrice = await exchange.fetchTicker();
await strategy.decide({ price: currentPrice }); // No!
```

**Why**: Prevents look-ahead bias in backtests and ensures live/backtest consistency

### 4. Dependency Injection

**Rule**: Apps use `@agenai/app-di` for service wiring

```typescript
// ✅ CORRECT: In apps/trader-cli or apps/backtest-cli
import { createDependencies } from "@agenai/app-di";

const deps = createDependencies(runtimeConfig);
const result = await startTrader(deps);

// ❌ WRONG: Direct instantiation in runtime
const mexcClient = new MexcClient({ ... }); // No! Keep this in DI layer
```

**Why**: Prevents circular dependencies and centralizes configuration

---

## Package Structure & Dependencies

### Package Hierarchy

```
@agenai/core                  # Base types, strategy registry, config
  ↑
  ├── @agenai/indicators      # Pure indicator functions
  ├── @agenai/models-quant    # Forecasting models
  ├── @agenai/data            # Historical data loading
  ├── @agenai/strategy-engine # Strategy orchestration
  ├── @agenai/risk-engine     # Position sizing
  ├── @agenai/execution-engine# Order execution
  ↑
@agenai/runtime               # Unified live/backtest runtime
  ↑
@agenai/app-di                # Dependency injection
  ↑
apps/* (trader-cli, trader-server, backtest-cli)
```

### Exchange Packages (ISOLATED)

```
@agenai/exchange-mexc         # MEXC adapter (ccxt wrapper)
@agenai/exchange-binance      # Binance adapters (ccxt wrapper)
  ↓ (only through DataProvider)
@agenai/data                  # Abstracts exchange access
```

---

## Common Patterns

### 1. Creating Strategies

```typescript
// packages/core/src/strategies/my_strategy/index.ts
import type { StrategyRegistryEntry } from "../types";
import { decide } from "./decide";

export const myStrategy: StrategyRegistryEntry = {
	id: "my_strategy",
	defaultProfileName: "my_strategy_default",
	decide,
};

// packages/core/src/strategies/my_strategy/decide.ts
import type { TradeIntent } from "../../types";
import type { StrategyContext } from "../types";

export async function decide(context: StrategyContext): Promise<TradeIntent> {
	const { candle, buffer, config } = context;

	// Your logic here

	return {
		intent: "OPEN_LONG",
		reason: "my_signal_triggered",
		symbol: context.symbol,
		timestamp: candle.timestamp,
	};
}
```

### 2. Adding Indicators

```typescript
// packages/indicators/src/myIndicator.ts

/**
 * Pure function: no side effects, deterministic
 */
export function myIndicator(values: number[], period: number): number[] {
	if (values.length < period) return [];

	const result: number[] = [];
	// ... calculation
	return result;
}

// Export from index
export { myIndicator } from "./myIndicator";
```

### 3. Logging Pattern

```typescript
import { createLogger } from "@agenai/core";

const logger = createLogger("my-module");

// Structured logging
logger.info("event_name", {
	key: "value",
	timestamp: Date.now(),
});
```

### 4. Testing Pattern

```typescript
import { describe, it, expect } from "vitest";

describe("myFunction", () => {
	it("should handle normal case", () => {
		const result = myFunction(10);
		expect(result).toBe(20);
	});

	it("should handle edge cases", () => {
		expect(myFunction(0)).toBe(0);
		expect(() => myFunction(-1)).toThrow();
	});
});
```

---

## Code Style

### TypeScript

- **Always use strict types** (no `any`)
- **Explicit return types** for exported functions
- **Prefer interfaces** over type aliases for object shapes
- **Use `const` by default**, `let` only when mutating

```typescript
// ✅ Good
export interface Config {
	period: number;
	threshold: number;
}

export function calculate(config: Config): number {
	return config.period * config.threshold;
}

// ❌ Bad
export function calculate(config: any): any {
	return config.period * config.threshold;
}
```

### Naming

- **Files**: `camelCase.ts` (e.g., `runtimeSnapshot.ts`)
- **Classes**: `PascalCase` (e.g., `RiskManager`)
- **Functions**: `camelCase` (e.g., `calculateEMA`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_PERIOD`)
- **Interfaces**: `PascalCase` (e.g., `TradeIntent`)

### Comments

- Use **JSDoc** for public APIs
- Add **inline comments** for complex logic
- Avoid obvious comments

```typescript
/**
 * Calculate exponential moving average
 * @param values - Price array
 * @param period - Lookback period
 * @returns EMA values aligned with input
 */
export function calculateEMA(values: number[], period: number): number[] {
	// Skip if insufficient data
	if (values.length < period) return [];

	// ... implementation
}
```

---

## Key Files to Reference

### Core Configuration

- `packages/core/src/config.ts` - Config loading and validation
- `packages/core/src/strategies/registry.ts` - Strategy discovery

### Runtime Core

- `packages/runtime/src/loop/runTick.ts` - **CANONICAL TICK PIPELINE**
- `packages/runtime/src/startTrader.ts` - Live trading loop
- `packages/runtime/src/backtest/backtestRunner.ts` - Backtest replay
- `packages/runtime/src/runtimeSnapshot.ts` - Config resolution

### Data Flow

- `packages/data/src/provider.ts` - Historical data provider
- `packages/data/src/historical.ts` - Paginated fetch logic
- `packages/runtime/src/marketData/types.ts` - Market data interfaces

### Dependency Injection

- `apps/app-di/src/index.ts` - Service creation and wiring

### Tests (CRITICAL)

- `packages/runtime/src/__tests__/import-boundary.test.ts` - Import rules
- `packages/runtime/src/runtimeParity.test.ts` - Live/backtest parity

---

## Common Tasks

### Adding a New Strategy

1. Create `packages/core/src/strategies/my_strategy/index.ts`
2. Implement `decide()` function
3. Add JSON config to `config/strategies/my_strategy.json`
4. Verify with `pnpm strategy:list`
5. Test with backtest

### Adding a New Indicator

1. Create `packages/indicators/src/myIndicator.ts`
2. Implement pure function
3. Export from `packages/indicators/src/index.ts`
4. Add unit tests
5. Use in strategy `decide()` function

### Modifying Runtime Logic

1. **NEVER** bypass `runTick()` pipeline
2. Update in `packages/runtime/src/loop/runTick.ts`
3. Verify parity test still passes: `pnpm --filter @agenai/runtime test runtimeParity`
4. Check import boundaries: `pnpm --filter @agenai/runtime test import-boundary`

### Adding Exchange Support

1. Create adapter in new package (e.g., `@agenai/exchange-kraken`)
2. Implement `ExchangeAdapter` interface
3. Wrap CCXT client
4. Add to `@agenai/data` provider options
5. **DO NOT** import directly in `@agenai/runtime`

---

## Anti-Patterns to Avoid

### ❌ Hardcoded Configuration

```typescript
// ❌ Bad
const SYMBOL = "BTC/USDT";
const PERIOD = 20;

// ✅ Good - Use config
const symbol = config.symbol;
const period = config.indicators.period;
```

### ❌ Direct Exchange Access in Runtime

```typescript
// ❌ Bad - in @agenai/runtime
import { MexcClient } from "@agenai/exchange-mexc";
const client = new MexcClient();

// ✅ Good - use abstraction
import type { MarketDataProvider } from "./marketData/types";
// Provider injected via DI
```

### ❌ Mutable Indicators

```typescript
// ❌ Bad - state mutation
class EMACalculator {
	private values: number[] = [];

	add(value: number): number {
		this.values.push(value);
		return this.calculate();
	}
}

// ✅ Good - pure function
export function calculateEMA(values: number[], period: number): number[] {
	// No state, deterministic
}
```

### ❌ Async in Tight Loops

```typescript
// ❌ Bad - sequential awaits
for (const timeframe of timeframes) {
	const candles = await fetchCandles(timeframe);
	data[timeframe] = candles;
}

// ✅ Good - parallel
const promises = timeframes.map((tf) => fetchCandles(tf));
const results = await Promise.all(promises);
```

### ❌ Testing with Real Exchanges

```typescript
// ❌ Bad - live API calls in tests
it("should fetch candles", async () => {
	const client = new MexcClient({ apiKey, secret });
	const candles = await client.fetchOHLCV("BTC/USDT", "1m");
	expect(candles.length).toBeGreaterThan(0);
});

// ✅ Good - mock or stub
it("should fetch candles", async () => {
	const mockClient = {
		fetchOHLCV: vi.fn().mockResolvedValue([
			/* mock data */
		]),
	};
	// Test logic with mock
});
```

---

## Testing Checklist

When making changes, verify:

- [ ] `pnpm -r build` succeeds (no TypeScript errors)
- [ ] `pnpm test` passes (all unit/integration tests)
- [ ] `pnpm --filter @agenai/runtime test import-boundary` passes
- [ ] `pnpm --filter @agenai/runtime test runtimeParity` passes
- [ ] No new `any` types introduced
- [ ] New functions have JSDoc comments
- [ ] Edge cases handled (empty arrays, nulls, zeros)

---

## Performance Considerations

### 1. Indicator Calculation

```typescript
// ✅ Good - calculate once, reuse
const ema = calculateEMA(closes, period);
const macd = calculateMACD(closes, fastPeriod, slowPeriod);

// ❌ Bad - recalculating in loop
for (const candle of buffer) {
	const ema = calculateEMA(
		buffer.map((c) => c.close),
		period
	); // Slow!
}
```

### 2. Array Operations

```typescript
// ✅ Good - single pass
const closes = buffer.map((c) => c.close);

// ❌ Bad - multiple passes
const closes = buffer.filter((c) => c.close > 0).map((c) => c.close);
```

### 3. Logging

```typescript
// ✅ Good - structured, lazy evaluation
logger.info("tick_complete", { symbol, timestamp, intent });

// ❌ Bad - string concatenation
logger.info(`Tick complete for ${symbol} at ${timestamp}`);
```

---

## Security Reminders

- **Never commit API keys** (use `.env` files, add to `.gitignore`)
- **Validate all user inputs** (CLI args, config files)
- **Sanitize file paths** (prevent directory traversal)
- **Rate limit API calls** (respect exchange limits)

---

## When in Doubt

1. Check existing patterns in similar files
2. Verify import boundaries with tests
3. Ensure runtime parity maintained
4. Prefer pure functions over stateful classes
5. Add tests for new functionality
6. Update documentation if architecture changes

---

## Resources

- **Main README**: [README.md](README.md)
- **Contributing Guide**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **Strategy Registry**: `packages/core/src/strategies/registry.ts`
- **Runtime Pipeline**: `packages/runtime/src/loop/runTick.ts`
- **Import Boundary Test**: `packages/runtime/src/__tests__/import-boundary.test.ts`
