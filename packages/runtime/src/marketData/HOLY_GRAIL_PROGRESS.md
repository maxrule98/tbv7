# Holy Grail Data Architecture - Progress Tracker

**Machine-Searchable Marker:**

```
HG_PHASE_COMPLETED=A,B,C,D,E
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

### Phase D: Centralize Storage with CandleStore ✅ COMPLETED

- [x] Create `packages/core/src/data/CandleStore.ts` (232 lines)
- [x] Implement ingest(), ingestMany(), getSeries(), getLatestCandle()
- [x] Add comprehensive tests (34 tests passing)
- [x] Update startTrader.ts to use CandleStore (replaced Map<string, Candle[]>)
- [x] Update backtestRunner.ts to use CandleStore
- [x] Delete BacktestTimeframeCache.ts (67 lines eliminated)
- [x] Add guard tests to prevent regression
- [x] Verify runtime parity maintained (4/4 tests passing)

**Implementation Notes:**

- CandleStore provides unified candle storage for both live and backtest modes
- Deterministic time bucketing via bucketTimestamp from @agenai/core/time
- Deduplication strategy: last-write-wins for same timestamp
- Per-timeframe window limits with default fallback
- Maintains sorted ascending order via binary search insertion
- Synchronous getSeries() returns defensive copy
- BacktestTimeframeCache completely replaced and deleted

### Phase E: Split ExchangeAdapter Interface ✅ COMPLETED

- [x] Create MarketDataClient and ExecutionClient interfaces in @agenai/core
- [x] Update ExchangeAdapter to type composition (MarketDataClient & ExecutionClient)
- [x] Update runtime backtestRunner to use ExecutionClient (removed ExchangeAdapter)
- [x] Update market data providers to use MarketDataClient
- [x] Update execution providers to use ExecutionClient
- [x] Enforce venue split in DI (apps/app-di)
- [x] Clean up identity functions (removed createMarketDataClient)
- [x] Add guard tests for Phase E completion
- [x] Verify zero ExchangeAdapter references in packages/runtime/src

**Implementation Notes:**

- MarketDataClient: Read-only interface for fetchOHLCV (signal venue)
- ExecutionClient: Write interface for orders/positions/balance (execution venue)
- ExchangeAdapter: Backward-compatible type composition (deprecated)
- Import boundaries preserved: runtime/data/execution cannot import exchange packages
- Venue split enabled: Different exchanges can be used for signals vs execution
- Type safety: TypeScript enforces correct client usage in DI layer
- Clean modularity: Removed unused parameters and identity functions

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

## Phase Constraints

**What NOT to do in current architecture:**

❌ **NO aggregation/resampling in CandleStore** - Wait for Phase F
❌ **NO gap repair in CandleStore** - Handled by providers via repairCandleGap()
❌ **NO multi-exchange reconciliation** - Future phase
❌ **NO MarketDataPlant creation** - Phase F only
❌ **NO new DI packages or duplicate factories**

**Current architecture (Phase D):**

✅ CandleStore handles storage, deduplication, window trimming
✅ Providers handle gap detection and repair via repairCandleGap()
✅ Both live (startTrader) and backtest (backtestRunner) use CandleStore
✅ Strategies receive CandleStore (with MultiTimeframeCache-compatible interface) in backtest mode
✅ Live strategies use MultiTimeframeCache (different from CandleStore)
✅ Interface split complete (MarketDataClient/ExecutionClient) - do not reintroduce ExchangeAdapter into runtime.
