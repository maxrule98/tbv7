# Contributing to AgenAI Trader

Thank you for your interest in contributing to AgenAI Trader! This document provides guidelines and workflows for development.

---

## 📋 Table of Contents

- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing Guidelines](#testing-guidelines)
- [Adding New Features](#adding-new-features)
- [Debugging](#debugging)
- [Pull Request Process](#pull-request-process)

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js**: >= 18.x
- **pnpm**: >= 8.x
- **TypeScript**: 5.x (installed via pnpm)

### Initial Setup

```bash
# Clone the repository
git clone <repository-url>
cd trading-bot-v7

# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Verify tests pass
pnpm test

# Create environment file
cp .env.example .env
```

### Development Environment

```bash
# Run all packages in watch mode
pnpm dev

# Run specific package in watch mode
pnpm --filter @agenai/core dev

# Build specific package
pnpm --filter @agenai/runtime build
```

---

## 🏗️ Project Architecture

### Package Dependencies

```
apps/trader-cli ──┐
apps/trader-server┤
apps/backtest-cli ┴─→ @agenai/app-di ──→ @agenai/runtime ──┐
                                                            ├→ @agenai/core
@agenai/runtime ──→ @agenai/strategy-engine ───────────────┤
                 ──→ @agenai/risk-engine ──────────────────┤
                 ──→ @agenai/execution-engine ─────────────┤
                 ──→ @agenai/data ─────────────────────────┤
                 ──→ @agenai/indicators ───────────────────┤
                 ──→ @agenai/models-quant ─────────────────┤
                 ──→ @agenai/metrics ──────────────────────┘

@agenai/data ──→ @agenai/exchange-mexc ──→ @agenai/core
              ──→ @agenai/exchange-binance
```

### Critical Architectural Rules

1. **Import Boundaries**: `@agenai/runtime` MUST NOT import exchange packages directly
   - Enforced by `runtime/src/__tests__/import-boundary.test.ts`
   - Data flows through abstractions: `ExchangeAdapter` → `DataProvider` → `MarketDataProvider`

2. **Runtime Parity**: Live and backtest modes share the same tick pipeline
   - Both call `runTick()` in `@agenai/runtime/loop/runTick.ts`
   - Verified by `runtime/src/runtimeParity.test.ts`

3. **Dependency Injection**: Apps use `@agenai/app-di` for consistent wiring
   - Prevents circular dependencies
   - Centralizes service creation logic

4. **Closed-Candle Policy**: Strategies only execute on completed candles
   - Prevents look-ahead bias in backtests
   - Ensures live/backtest determinism

---

## 🔄 Development Workflow

### 1. Creating a New Package

```bash
# Create package directory
mkdir -p packages/my-package/src

# Create package.json
cat > packages/my-package/package.json << 'EOF'
{
  "name": "@agenai/my-package",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@agenai/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "vitest": "^1.6.1"
  }
}
EOF

# Create tsconfig files
cat > packages/my-package/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
EOF

cat > packages/my-package/tsconfig.build.json << 'EOF'
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "declaration": true,
    "declarationMap": true
  },
  "exclude": ["**/*.test.ts", "**/__tests__/**"]
}
EOF

# Install dependencies
pnpm install
```

### 2. Adding a New Strategy

```bash
# 1. Create strategy directory
mkdir -p packages/core/src/strategies/my_strategy

# 2. Create index.ts with StrategyRegistryEntry
cat > packages/core/src/strategies/my_strategy/index.ts << 'EOF'
import type { StrategyRegistryEntry } from "../types";
import { decide } from "./decide";

export const myStrategy: StrategyRegistryEntry = {
  id: "my_strategy",
  defaultProfileName: "my_strategy_default",
  decide,
};
EOF

# 3. Implement decide() function
cat > packages/core/src/strategies/my_strategy/decide.ts << 'EOF'
import type { TradeIntent } from "../../types";
import type { StrategyContext } from "../types";

export async function decide(context: StrategyContext): Promise<TradeIntent> {
  // Your strategy logic here
  return {
    intent: "NO_ACTION",
    reason: "not_implemented",
    symbol: context.symbol,
    timestamp: context.candle.timestamp,
  };
}
EOF

# 4. Create JSON config
cat > config/strategies/my_strategy_default.json << 'EOF'
{
  "id": "my_strategy",
  "symbol": "BTC/USDT",
  "timeframes": {
    "execution": "1m",
    "confirming": "5m"
  },
  "trackedTimeframes": ["15m"],
  "warmupPeriods": {
    "default": 50,
    "1m": 120
  },
  "historyWindowCandles": 500
}
EOF

# 5. Verify registration
pnpm strategy:list
```

### 3. Adding an Indicator

```bash
# Create indicator file
cat > packages/indicators/src/myIndicator.ts << 'EOF'
/**
 * My custom indicator
 * @param values - Input array
 * @param period - Lookback period
 * @returns Indicator values
 */
export function myIndicator(values: number[], period: number): number[] {
  // Pure function implementation
  const result: number[] = [];
  // ... calculation logic
  return result;
}
EOF

# Export from index
echo 'export { myIndicator } from "./myIndicator";' >> packages/indicators/src/index.ts

# Add tests
cat > packages/indicators/src/myIndicator.test.ts << 'EOF'
import { describe, it, expect } from "vitest";
import { myIndicator } from "./myIndicator";

describe("myIndicator", () => {
  it("should calculate correctly", () => {
    const input = [1, 2, 3, 4, 5];
    const result = myIndicator(input, 3);
    expect(result).toBeDefined();
  });
});
EOF
```

---

## 📏 Code Standards

### TypeScript Guidelines

1. **Strict Mode**: Always use strict TypeScript

   ```typescript
   // ✅ Good
   function processCandle(candle: Candle): number {
   	return candle.close;
   }

   // ❌ Bad
   function processCandle(candle: any): any {
   	return candle.close;
   }
   ```

2. **Explicit Return Types**: Declare return types for exported functions

   ```typescript
   // ✅ Good
   export function calculateEMA(values: number[], period: number): number[] {
   	// ...
   }

   // ❌ Bad
   export function calculateEMA(values, period) {
   	// ...
   }
   ```

3. **Interface Over Type**: Prefer interfaces for object shapes

   ```typescript
   // ✅ Good
   export interface StrategyConfig {
   	id: string;
   	symbol: string;
   }

   // ⚠️ Use sparingly
   export type StrategyConfig = {
   	id: string;
   	symbol: string;
   };
   ```

### Naming Conventions

- **Files**: `camelCase.ts` (e.g., `runtimeSnapshot.ts`)
- **Classes**: `PascalCase` (e.g., `RiskManager`)
- **Functions**: `camelCase` (e.g., `calculateEMA`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_WARMUP`)
- **Interfaces**: `PascalCase` (e.g., `TradeIntent`)
- **Types**: `PascalCase` (e.g., `StrategyId`)

### Code Organization

```typescript
// 1. Imports (grouped: external, workspace, relative)
import { describe, it, expect } from "vitest";
import { Candle } from "@agenai/core";
import { calculateEMA } from "./ema";

// 2. Types/Interfaces
interface LocalConfig {
	threshold: number;
}

// 3. Constants
const DEFAULT_PERIOD = 20;

// 4. Functions (pure functions first)
function helper(value: number): number {
	return value * 2;
}

// 5. Exports
export function mainFunction(input: number): number {
	return helper(input);
}
```

### Comments

- Use JSDoc for public APIs
- Add inline comments for complex logic
- Avoid obvious comments

```typescript
/**
 * Calculate exponential moving average
 * @param values - Price array
 * @param period - Lookback period
 * @returns EMA values aligned with input
 */
export function calculateEMA(values: number[], period: number): number[] {
	// Skip calculation if insufficient data
	if (values.length < period) return [];

	// ... implementation
}
```

---

## 🧪 Testing Guidelines

### Test Structure

```typescript
import { describe, it, expect, vi } from "vitest";
import { myFunction } from "./myModule";

describe("myModule", () => {
	describe("myFunction", () => {
		it("should handle normal case", () => {
			const result = myFunction(10);
			expect(result).toBe(20);
		});

		it("should handle edge case", () => {
			const result = myFunction(0);
			expect(result).toBe(0);
		});

		it("should throw on invalid input", () => {
			expect(() => myFunction(-1)).toThrow();
		});
	});
});
```

### Testing Checklist

- [ ] **Unit Tests**: Pure functions have 100% coverage
- [ ] **Integration Tests**: Runtime components test full pipelines
- [ ] **Parity Tests**: Live/backtest produce identical outputs
- [ ] **Boundary Tests**: Import rules enforced
- [ ] **Edge Cases**: Handle empty arrays, nulls, zeros
- [ ] **Error Cases**: Invalid inputs throw descriptive errors

### Running Tests

```bash
# All tests
pnpm test

# Specific package
pnpm --filter @agenai/runtime test

# Watch mode
pnpm --filter @agenai/core test --watch

# Coverage (if configured)
pnpm test --coverage
```

---

## ✨ Adding New Features

### 1. Planning Phase

- Review architecture principles
- Check for existing similar code
- Design interfaces first
- Consider runtime parity implications

### 2. Implementation Phase

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Implement with tests
# ... write code ...

# 3. Verify locally
pnpm -r build
pnpm test

# 4. Run boundary checks
pnpm --filter @agenai/runtime test import-boundary

# 5. Test live/backtest parity
pnpm --filter @agenai/runtime test runtimeParity
```

### 3. Documentation Phase

- Update README.md if architecture changes
- Add JSDoc comments to public APIs
- Update CONTRIBUTING.md if workflow changes
- Add config examples to `/config` directory

---

## 🐛 Debugging

### Debug Logging

```typescript
import { createLogger } from "@agenai/core";

const logger = createLogger("my-module");

// Structured logging
logger.info("event_name", {
	key: "value",
	timestamp: Date.now(),
});

// Warning/Error
logger.warn("warning_event", { reason: "details" });
logger.error("error_event", { error: err.message });
```

### Debug Strategies

```bash
# Verbose runtime logs
NODE_ENV=development pnpm server:start -- --strategy=my_strategy

# Inspect config resolution
pnpm runtime:print-config -- --strategy=my_strategy

# Run single backtest with logs
pnpm backtest -- \
  --strategy=my_strategy \
  --start "2024-01-01T00:00:00Z" \
  --end "2024-01-01T01:00:00Z" \
  --maxCandles 10
```

### Common Issues

1. **Import Errors**: Check `tsconfig.json` paths and package dependencies
2. **Runtime Parity Failures**: Verify both modes use same `runTick()` pipeline
3. **Missing Candles**: Check warmup periods and time windows
4. **Type Errors**: Run `pnpm -r build` to catch cross-package issues

---

## 🔀 Pull Request Process

### Before Submitting

1. **Code Quality**

   ```bash
   pnpm format
   pnpm -r build
   pnpm test
   ```

2. **Verify Changes**
   - [ ] All tests pass
   - [ ] No new TypeScript errors
   - [ ] Import boundaries respected
   - [ ] Runtime parity maintained
   - [ ] Documentation updated

3. **Commit Messages**

   ```
   feat(runtime): add tick result diagnostics

   - Add diagnostics field to TickResult
   - Include skip reasons and guard exit info
   - Update parity test to verify diagnostics

   Closes #123
   ```

### PR Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Parity tests verified
- [ ] Manual testing performed

## Checklist

- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings
- [ ] Tests pass
```

### Review Process

1. Automated checks run (build, test, lint)
2. Code review by maintainer
3. Address feedback
4. Approval + merge

---

## 📞 Getting Help

- **Issues**: Open GitHub issue with reproducible example
- **Questions**: Start a discussion in GitHub Discussions
- **Security**: Email security@example.com (do not open public issue)

---

## 📄 License

By contributing, you agree that your contributions will be licensed under the project's MIT License.
