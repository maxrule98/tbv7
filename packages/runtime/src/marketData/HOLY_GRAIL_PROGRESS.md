# Holy Grail Data Architecture - Progress Tracker

**Machine-Searchable Marker:**

```
HG_PHASE_COMPLETED=A,B,C
```

## Phase Checklist

### Phase A: Deterministic Time Utilities ✅ COMPLETED

- [x] Create `packages/core/src/time/time.ts` with pure utilities
- [x] Export timeframeToMs, bucketTimestamp, isBucketAligned, assertBucketAligned
- [x] Add comprehensive tests
- [x] Update existing usages to use core time utilities

### Phase B: TickSnapshot Type and Builder ✅ COMPLETED

- [x] Create `packages/runtime/src/types/tickSnapshot.ts` with rich TickSnapshot type
- [x] Create `packages/runtime/src/loop/buildTickSnapshot.ts` builder function
- [x] Update runTick to accept TickSnapshot
- [x] Update startTrader to build and pass TickSnapshot
- [x] Update backtestRunner to build and pass TickSnapshot
- [x] Add guard tests for phase completion

### Phase C: Extract Gap Repair Logic ✅ COMPLETED

- [x] Create `packages/data/src/reconcile/gapRepair.ts`
- [x] Extract duplicated gap repair from both providers
- [x] Add unit tests for gap repair (19 test scenarios)
- [x] Update pollingMarketDataProvider to use shared function
- [x] Update binanceUsdMMarketDataProvider to use shared function

### Phase D: Centralize Storage with CandleStore (NOT STARTED)

- [ ] Create `packages/core/src/data/CandleStore.ts`
- [ ] Implement ingest(), getSnapshot(), detectGaps()
- [ ] Update runners to use CandleStore
- [ ] Delete BacktestTimeframeCache

### Phase E: Split ExchangeAdapter Interface (NOT STARTED)

- [ ] Create MarketDataClient and ExecutionClient interfaces
- [ ] Update exchange packages
- [ ] Enforce venue split in DI

### Phase F: Introduce MarketDataPlant (NOT STARTED)

- [ ] Create MarketDataPlant orchestrator
- [ ] Migrate subscription logic
- [ ] Wire Plant → CandleStore → runTick

---

## Current Commit Notes (Phase C)

**✅ PHASE C COMPLETED: 2025-12-31**

### Files Created:

1. `packages/data/src/reconcile/gapRepair.ts` - Shared gap repair logic (115 lines)
2. `packages/data/src/reconcile/gapRepair.test.ts` - Comprehensive tests (19 test scenarios, 24 passing tests)

### Files Modified:

1. `packages/data/src/index.ts` - Export repairCandleGap function and types
2. `packages/runtime/src/marketData/pollingMarketDataProvider.ts` - Replace repairGap method with shared function
3. `packages/runtime/src/marketData/binanceUsdMMarketDataProvider.ts` - Replace repairGap method with shared function
4. `packages/runtime/src/marketData/HOLY_GRAIL_PROGRESS.md` - Updated marker to A,B,C

### Code Eliminated:

- **70+ lines of duplicated gap repair logic** removed from both providers
- **Both `private async repairGap` wrapper methods completely eliminated**
- Gap repair logic now directly uses shared `repairCandleGap()` function at call sites
- Providers keep their own logging and metadata handling

### Key Improvements:

1. **Pure function with dependency injection**: fetchCandles callback injected
2. **Deterministic bucketing**: Uses `bucketTimestamp()` from @agenai/core
3. **Strict boundary filtering**: Excludes candles outside [fromTs, toTs) range
4. **Sorting and deduplication**: Handles out-of-order and duplicate timestamps
5. **No wrapper methods**: Direct calls to shared function eliminate indirection

### Test Coverage:

- No gap scenarios (2 tests)
- Single missing candle (2 tests)
- Multiple missing candles (2 tests)
- Out-of-order and duplicate handling (3 tests)
- Boundary filtering (3 tests)
- Logging callback (3 tests)
- Edge cases (4 tests)

### Behavior Preserved:

- ✅ Same gap detection logic
- ✅ Same candle fetching with padding
- ✅ Same filtering and sorting
- ✅ Providers keep their own logging (candle_gap_repaired)
- ✅ Metadata preserved (source="poll"/"rest", gapFilled=true)
- ✅ Binance provider still normalizes candles

### Validation Commands Run:

```bash
pnpm --filter @agenai/data test     # ✅ 24 tests passing (gapRepair tests)
pnpm -r build                       # ✅ All packages build
```

---

## Previous Commit Notes (Phase A + B)

**✅ PHASE A + B COMPLETED: 2025-12-31**

### Files Created:

1. `packages/core/src/time/time.ts` - Pure time utilities (UTC epoch ms only)
2. `packages/core/src/time/index.ts` - Time module barrel export (time + constants)
3. `packages/core/src/time/constants.ts` - Time constants (MINUTE_MS, HOUR_MS, etc.)
4. `packages/core/src/time/time.test.ts` - Comprehensive tests for time utilities (24 passing)
5. `packages/runtime/src/types/tickSnapshot.ts` - Rich TickSnapshot type definition
6. `packages/runtime/src/loop/buildTickSnapshot.ts` - Snapshot builder with validation
7. `packages/runtime/src/loop/buildTickSnapshot.test.ts` - Snapshot builder tests (7 passing)
8. `packages/runtime/src/__tests__/holyGrailPhaseGuard.test.ts` - Guard rails against plan drift (6 passing)
9. `packages/runtime/src/marketData/HOLY_GRAIL_PROGRESS.md` - This progress tracker

### Files Modified:

1. `packages/core/src/index.ts` - Export time utilities
2. `packages/runtime/src/index.ts` - Export TickSnapshot types and buildTickSnapshot
3. `packages/runtime/src/loop/runTick.ts` - Accept TickSnapshot instead of raw candle/buffer
4. `packages/runtime/src/startTrader.ts` - Build and pass TickSnapshot to runTick
5. `packages/runtime/src/backtest/backtestRunner.ts` - Build and pass TickSnapshot to runTick
6. `packages/runtime/src/runtimeParity.test.ts` - Updated to use TickSnapshot with aligned timestamps
7. `packages/data/src/utils/timeframe.ts` - Re-export time utilities from @agenai/core for backward compatibility

### Test Results:

- **All packages build successfully**: 15/15 packages ✅
- **All tests passing**:
  - @agenai/core: 29 tests (including 24 new time utility tests)
  - @agenai/runtime: 33 tests (including 13 new tests for TickSnapshot)
  - @agenai/data: 3 tests
  - @agenai/execution-engine: 4 tests
  - @agenai/risk-engine: 4 tests
  - apps/app-di: 3 tests
  - apps/backtest-cli: 3 tests
  - **Total: 79 tests passing, 0 failing**

### Breaking Changes:

**NONE** - All changes maintain backward compatibility:

- runTick signature changed but all callsites updated simultaneously
- @agenai/data re-exports time utilities from core (no breaking imports)
- TickSnapshot is additive - no existing APIs removed

### Behavior Preserved:

- ✅ Runtime/backtest parity maintained (runtimeParity.test.ts passes)
- ✅ Same candle buffers passed to strategy decide()
- ✅ Same execution logic
- ✅ All existing tests pass
- ✅ Import boundaries verified (holyGrailPhaseGuard.test.ts)

### Key Achievements:

1. **Deterministic time layer**: All timestamps validated for alignment
2. **Rich snapshot type**: Captures execution candle + multi-timeframe series + metadata
3. **Canonical runTick**: Now uses TickSnapshot, preparing for future phases
4. **Guard rails**: Automated tests prevent plan drift

### Validation Commands Run:

```bash
pnpm -r build      # ✅ All 15 packages built
pnpm -r test       # ✅ All 79 tests passed
```

---

## Audit Findings (Pre-Implementation)

### Time Utilities Current State:

- `timeframeToMs()` exists in `packages/data/src/utils/timeframe.ts`
- No bucketing/alignment utilities found
- Timestamp normalization not formalized
- Multiple places assume timestamps are aligned but don't validate

### runTick Call Sites:

- `packages/runtime/src/startTrader.ts` - Live trading loop
- `packages/runtime/src/backtest/backtestRunner.ts` - Backtest replay
- Both pass raw `candle` and `buffer` parameters

### Buffer Management:

- `startTrader.ts` uses `Map<string, Candle[]>` for buffers (lines ~330-360)
- `backtestRunner.ts` uses `BacktestTimeframeCache` (line 227)
- No unified snapshot concept

### Existing Snapshot Types:

- **NONE FOUND** - Buffers passed directly as arrays

---

## Do Not Do In This Phase (A + B)

❌ **NO aggregation/resampling logic** - Phase C/D
❌ **NO gap repair extraction** - Phase C
❌ **NO CandleStore unification** - Phase D
❌ **NO interface split (MarketDataClient/ExecutionClient)** - Phase E
❌ **NO venue enforcement in DI** - Phase E
❌ **NO MarketDataPlant creation** - Phase F
❌ **NO provider refactoring** - Phase F
❌ **NO new DI packages or duplicate factories**

✅ **ONLY:**

- Pure time utilities with tests
- TickSnapshot type definition
- Snapshot builder with validation
- runTick signature update
- Runner wiring to pass snapshots
- Guard tests

---

## Next Phase Recommendation

**Phase C: Extract Gap Repair Logic**

Why this next:

1. Safe, isolated change (pure extraction)
2. Eliminates 70+ lines of duplication
3. No architectural changes required
4. Easy to test and validate
5. Prepares for Phase D (CandleStore needs gap detection)

Estimated effort: 2-3 days
Risk level: LOW
