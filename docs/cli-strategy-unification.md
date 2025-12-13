# CLI Strategy Selection Unification - Implementation Summary

**Date:** 2025-12-13  
**Task:** Unify CLI strategy selection flags across backtest + server

## Problem Statement

- The server CLI supported `--strategy=...` but backtest CLI ignored it and fell back to default strategy
- This caused silent wrong-strategy runs (e.g., running `vwap_delta_gamma` when expecting `ultra_aggressive_btc_usdt`)
- No validation or helpful error messages when strategy was missing or invalid

## Solution Implemented

### 1. Created Shared Parse Helper

**File:** `packages/runtime/src/parseStrategyArg.ts`

- **Canonical flag:** `--strategy=<id>` or `--strategy <id>`
- **Alias support:** `--strategyId=<id>` or `--strategyId <id>`
- **Validation:** Checks against registered strategy IDs from `@agenai/core` registry
- **Error handling:**
  - Missing flag: Lists all available strategy IDs
  - Invalid flag: Shows what was provided and lists valid alternatives
- **Normalization:** Trims and lowercases input for consistent matching

### 2. Updated Backtest CLI

**File:** `apps/backtest-cli/src/index.ts`

- Imports and uses `parseStrategyArg` from `@agenai/runtime`
- Calls parser before any other logic to fail fast with helpful errors
- Updated USAGE string to show `--strategy` as required
- Clarified that `--strategyProfile` is for config profiles, not strategy ID

### 3. Updated Trader Server CLI

**File:** `apps/trader-server/src/index.ts`

- Imports and uses `parseStrategyArg` from `@agenai/runtime`
- Removed custom `getStrategyArg` function (now uses shared helper)
- Consistent error handling and validation with backtest CLI

### 4. Updated Documentation

**File:** `README.md`

- Updated CLI usage examples to show required `--strategy` flag
- Clarified difference between `--strategy` (ID) and `--strategyProfile` (config profile)
- Updated command reference table
- Added prominent note about required `--strategy` flag

### 5. Added Tests

**File:** `packages/runtime/src/parseStrategyArg.test.ts`

- 8 comprehensive tests covering:
  - Both flag formats (`--strategy=<id>` and `--strategy <id>`)
  - Alias support (`--strategyId`)
  - Case normalization
  - Missing flag error messages
  - Invalid strategy ID error messages
  - Flag precedence

## Verification

✅ **Build:** `pnpm build` - All packages compile successfully  
✅ **Tests:** `pnpm test` - 15 tests in runtime package (8 new), all pass  
✅ **Missing flag:** Provides helpful error listing available strategies  
✅ **Invalid flag:** Shows clear error with available alternatives  
✅ **Valid usage:** Both CLIs accept `--strategy=<id>` and use it correctly  
✅ **Alias works:** `--strategyId` accepted as alternative

## Usage Examples

```bash
# List available strategies
pnpm strategy:list

# Backtest with required strategy flag
pnpm backtest -- \
  --strategy=ultra_aggressive_btc_usdt \
  --start "2024-01-01T00:00:00Z" \
  --end "2024-01-02T00:00:00Z" \
  --withMetrics

# Server with required strategy flag
pnpm server:start -- --strategy=ultra_aggressive_btc_usdt

# Using alias
pnpm backtest -- \
  --strategyId=vwap_delta_gamma \
  --start "2024-01-01T00:00:00Z" \
  --end "2024-01-02T00:00:00Z"
```

## Error Examples

```bash
# Missing flag
$ pnpm backtest -- --start ... --end ...
Error: Missing required --strategy flag.

Usage:
  --strategy=<id>

Available strategy ids:
  - ultra_aggressive_btc_usdt
  - vwap_delta_gamma

# Invalid strategy
$ pnpm backtest -- --strategy=invalid_one --start ... --end ...
Error: Invalid strategy id: "invalid_one"

Available strategy ids:
  - ultra_aggressive_btc_usdt
  - vwap_delta_gamma
```

## Benefits

1. **Single source of truth:** Shared parser in `@agenai/runtime`
2. **Consistent validation:** Same error messages across all CLIs
3. **Fail fast:** Errors before any heavy processing or data loading
4. **Helpful errors:** Always shows available options
5. **Flexible input:** Supports multiple flag formats and aliases
6. **No silent failures:** Required flag prevents accidental wrong-strategy runs
7. **Maintainable:** Adding new CLIs automatically gets consistent parsing
8. **Well-tested:** 8 comprehensive unit tests ensure reliability

## Files Changed

- ✨ `packages/runtime/src/parseStrategyArg.ts` (new)
- ✨ `packages/runtime/src/parseStrategyArg.test.ts` (new)
- ♻️ `packages/runtime/src/index.ts` (export added)
- ♻️ `apps/backtest-cli/src/index.ts` (uses shared parser)
- ♻️ `apps/trader-server/src/index.ts` (uses shared parser)
- 📝 `README.md` (updated docs and examples)

## Next Steps

Consider extending this pattern to other CLI flags that need consistency:

- `--symbol`, `--timeframe` validation
- Profile flags (`--accountProfile`, `--riskProfile`, etc.)
- Common environment/config flags
