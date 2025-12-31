# Holy Grail Data Architecture - Progress Tracker

**Machine-Searchable Marker:**

```
HG_PHASE_COMPLETED=A,B
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

### Phase C: Extract Gap Repair Logic (NOT STARTED)

- [ ] Create `packages/data/src/utils/gapRepair.ts`
- [ ] Extract duplicated gap repair from both providers
- [ ] Add unit tests for gap repair

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

## Current Commit Notes (Phase A + B)

**✅ PHASE A + B COMPLETED: 2025-12-31**

### Files Created:

1. `packages/core/src/time/time.ts` - Pure time utilities (UTC epoch ms only)
2. `packages/core/src/time.ts` - Barrel export for time utilities
3. `packages/core/src/time/time.test.ts` - Comprehensive tests for time utilities (24 passing)
4. `packages/runtime/src/types/tickSnapshot.ts` - Rich TickSnapshot type definition
5. `packages/runtime/src/loop/buildTickSnapshot.ts` - Snapshot builder with validation
6. `packages/runtime/src/loop/buildTickSnapshot.test.ts` - Snapshot builder tests (7 passing)
7. `packages/runtime/src/__tests__/holyGrailPhaseGuard.test.ts` - Guard rails against plan drift (6 passing)
8. `packages/runtime/src/marketData/HOLY_GRAIL_PROGRESS.md` - This progress tracker

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
