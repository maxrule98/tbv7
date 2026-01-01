# Phase F: MarketDataPlant Implementation

**Status**: ✅ COMPLETED  
**Date**: 2025-12-31

## Overview

Phase F implements the MarketDataPlant orchestrator for multi-timeframe market data management in the Holy Grail architecture. The Plant centralizes data ingestion, gap repair, and aggregation logic, while providers become simple "sources" that emit base timeframe candles only.

## Architecture

### Key Concept: Orchestration Layer

**Before Phase F (Phases A-E)**:

- Providers handled multi-timeframe subscriptions individually
- Each provider implemented its own gap repair and aggregation logic
- CandleStore usage was provider-specific
- No centralized orchestration of data flow

**After Phase F**:

- **MarketDataPlant** is the central orchestrator
- Providers become **BaseCandleSource** (simple sources emitting ONE base timeframe)
- Plant owns: base timeframe selection, gap detection/repair, aggregation, storage, event emission
- Data flow: `BaseCandleSource → Plant → CandleStore → Aggregation → Events`

### Base Timeframe Selection

The Plant automatically selects the **lowest requested timeframe** as the base feed:

- Requested: `["5m", "1m", "15m"]` → Base: `"1m"`
- Requested: `["1h", "15m"]` → Base: `"15m"`
- All higher timeframes are aggregated upward from the base

### Gap Detection & Repair

**Gap Detection** (in `processBaseCandle`):

```typescript
if (this.lastBaseTsMs >= 0 && candle.timestamp > this.lastBaseTsMs) {
	const expectedNext = this.lastBaseTsMs + baseTfMs;
	if (candle.timestamp > expectedNext) {
		await this.repairGap(expectedNext, candle.timestamp);
	}
}
```

**Gap Repair** (via `@agenai/data`):

- Calls `repairCandleGap` with injected `fetchCandles` function
- Fetches missing candles from REST API
- Ingests repaired candles into CandleStore
- Emits events for repaired candles

### Aggregation Strategy

**Pure Functions** (in `aggregateCandles.ts`):

- `aggregateCandle()`: Compose OHLCV from base candles within target bucket
- `detectClosedBuckets()`: Find which target timeframes crossed bucket boundaries
- `aggregateNewlyClosed()`: Aggregate only newly closed candles

**Aggregation Logic**:

1. When base candle arrives, detect which higher timeframe buckets just closed
2. For each closed bucket:
   - Fetch base candles from CandleStore for that bucket
   - Aggregate: open=first, high=max, low=min, close=last, volume=sum
   - Ingest aggregated candle into CandleStore
   - Emit ClosedCandleEvent

### Event Flow

```
Base Candle Arrives
  ↓
Gap Detection
  ↓ (if gap)
Gap Repair via REST → Ingest → Emit repaired events
  ↓
Ingest Base Candle
  ↓
Emit Base Candle Event
  ↓
Detect Closed Higher Timeframes
  ↓
Aggregate Each Closed Timeframe
  ↓
Ingest Aggregated Candles
  ↓
Emit Aggregated Events
  ↓
Update lastBaseTsMs
```

## Implementation Details

### Files Created

1. **`packages/runtime/src/marketData/aggregateCandles.ts`** (125 lines)
   - Pure aggregation utility functions
   - `aggregateCandle()`: Core aggregation logic
   - `detectClosedBuckets()`: Boundary detection
   - `aggregateNewlyClosed()`: Main orchestration
   - All use `timeframeToMs` and `bucketTimestamp` from `@agenai/core`

2. **`packages/runtime/src/marketData/MarketDataPlant.ts`** (441 lines)
   - Class `MarketDataPlant` with constructor, start, stop, onCandle
   - **Constructor**: Accepts `MarketDataPlantOptions` (venue, symbol, marketDataClient, candleStore, logger)
   - **start()**: Bootstrap history, select base timeframe, start polling
   - **stop()**: Clean up timers
   - **onCandle()**: Subscribe to closed candle events
   - **Private Methods**:
     - `selectBaseTimeframe()`: Choose lowest timeframe
     - `bootstrapHistory()`: Fetch initial candles via REST
     - `startPolling()`: Begin poll loop (default 10s interval)
     - `pollOnce()`: Fetch recent candles, process new ones
     - `processBaseCandle()`: Detect gaps, repair, ingest, emit, aggregate
     - `repairGap()`: Call `repairCandleGap` from `@agenai/data`
     - `aggregateAndEmit()`: Aggregate higher timeframes and emit events
     - `emitEvent()`: Notify all handlers

3. **`packages/runtime/src/marketData/aggregateCandles.test.ts`** (221 lines)
   - 11 test cases covering all aggregation functions
   - Edge cases: empty arrays, bucket boundaries, multiple timeframes
   - Tests: 1m→5m, 1m→15m aggregations

4. **`packages/runtime/src/marketData/MarketDataPlant.test.ts`** (269 lines)
   - 6 test cases covering Plant lifecycle
   - Tests: base selection, bootstrap, aggregation, gap repair, events, cleanup
   - Uses mocked MarketDataClient and real CandleStore

### Files Modified

1. **`packages/runtime/src/marketData/types.ts`**
   - Added `BaseCandleSource` interface after `MarketDataProvider`
   - Interface methods: `start(args)` and `stop()`
   - Phase F documentation comments

2. **`packages/runtime/src/marketData/index.ts`**
   - Exported: `MarketDataPlant`, `aggregateCandle`, `aggregateNewlyClosed`

## Key Design Decisions

### 1. Polling-Based Architecture

**Decision**: Plant uses polling instead of WebSocket subscriptions directly

**Rationale**:

- Simplifies provider contract (no WebSocket management in Plant)
- Enables gap detection on every poll
- Providers can still use WebSockets internally (e.g., BinanceUsdMMarketDataProvider)
- Poll interval configurable (default 10s)

### 2. Explicit Logger Type

**Decision**: Logger type defined explicitly in class, not as `Required<Options["logger"]>`

**Rationale**:

- TypeScript couldn't infer that logger is always defined after constructor
- Constructor provides fallback no-op logger if not provided
- Explicit type removes 9 false-positive "possibly undefined" errors

### 3. Gap Detection from Timestamp 0

**Decision**: Changed gap detection from `lastBaseTsMs > 0` to `lastBaseTsMs >= 0`

**Rationale**:

- Timestamp 0 (Unix epoch) is a valid candle timestamp
- Original check `> 0` excluded gaps after 0ms candles
- Caused test failure: bootstrap at 0ms → poll at 180_000ms → no gap detected
- Fix: `>= 0` allows gap detection from epoch

### 4. GapRepairResult Structure

**Decision**: Access `.missing` property from `repairCandleGap` result, not direct array

**Rationale**:

- `repairCandleGap` returns object: `{missing: Candle[], gapSize: number, fromTs, toTs}`
- Initial implementation incorrectly assumed array return type
- Fix: iterate over `result.missing` instead of `result`

### 5. CandleStore API

**Decision**: Always pass `timeframe` as first parameter to `ingest()` and `ingestMany()`

**Rationale**:

- CandleStore indexes by timeframe, requires it for bucket normalization
- Signature: `ingest(timeframe: string, candle: Candle)`
- Initial implementation missed timeframe parameter → 4 compilation errors
- Fix: `this.candleStore.ingest(this.baseTimeframe, candle)`

## Testing

### Test Coverage

**Aggregation Tests** (11 tests):

- ✅ Aggregate 1m→5m candles
- ✅ Aggregate 1m→15m candles
- ✅ Return null when no base candles in bucket
- ✅ Only include candles within bucket boundaries
- ✅ Detect closed buckets when crossing boundary
- ✅ Detect multiple closed timeframes
- ✅ Return empty when within bucket
- ✅ Handle first candle correctly
- ✅ Aggregate newly closed buckets
- ✅ Return empty array when no closed buckets
- ✅ Aggregate multiple timeframes

**Plant Tests** (6 tests):

- ✅ Select lowest timeframe as base
- ✅ Bootstrap base timeframe history on start
- ✅ Emit aggregated 5m candle when base 1m candles cross boundary
- ✅ Detect and repair gaps in base timeframe
- ✅ Emit events for execution timeframe
- ✅ Stop cleanly without errors

### Test Strategy

**Mocking Approach**:

- `MarketDataClient`: Mocked with `vi.fn()` for controlled responses
- `CandleStore`: Real instance (uses in-memory Map)
- `Logger`: Optional (uses no-op fallback in tests)

**Gap Repair Test**:

- Bootstrap: 0ms candle
- Poll: Returns 180_000ms candle (3 minutes later)
- Expected: Detects gap, calls `fetchOHLCV` with `since=60_000`
- Verifies: `gapRepairCalls.length > 0` and `emittedEvents.length >= 3`

## Integration Points

### With @agenai/core

**Dependencies**:

- `CandleStore`: For unified storage
- `MarketDataClient`: For REST API access
- `timeframeToMs`, `bucketTimestamp`: For time calculations
- `Candle` type: Standard candle interface

**Exports**:

- Plant uses types from `@agenai/core`
- No circular dependencies

### With @agenai/data

**Dependencies**:

- `repairCandleGap`: For gap detection and REST backfill
- `GapRepairInput`, `GapRepairResult` types

**Usage**:

```typescript
const fetchCandles = async (since: number) => {
	return this.marketDataClient.fetchOHLCV(
		this.symbol,
		this.baseTimeframe,
		100,
		since
	);
};

const result = await repairCandleGap({
	timeframe: this.baseTimeframe,
	lastTs: expectedTs - timeframeToMs(this.baseTimeframe),
	nextTs: actualTs,
	fetchCandles,
});

for (const candle of result.missing) {
	this.candleStore.ingest(this.baseTimeframe, candle);
}
```

### With Providers (Future Work)

**Next Steps**:

1. Refactor `BinanceUsdMMarketDataProvider` to implement `BaseCandleSource`
2. Refactor `PollingMarketDataProvider` to implement `BaseCandleSource`
3. Remove: Multi-timeframe logic, gap repair, CandleStore usage
4. Keep: Base timeframe subscription, candle emission

### With startTrader (Future Work)

**Integration Pattern**:

```typescript
// Create dependencies
const candleStore = new CandleStore(/* ... */);
const marketDataClient = new MexcClient(/* ... */);

// Create Plant
const plant = new MarketDataPlant({
	venue: "mexc",
	symbol: "BTC/USDT",
	marketDataClient,
	candleStore,
	logger: createLogger("plant"),
});

// Subscribe to events
plant.onCandle(async (event: ClosedCandleEvent) => {
	// Only trigger runTick for execution timeframe
	if (event.timeframe === executionTimeframe) {
		const snapshot = buildTickSnapshot({ candleStore /* ... */ });
		await runTick(snapshot);
	}
});

// Start Plant
await plant.start({
	timeframes: ["1m", "5m", "15m"],
	executionTimeframe: "1m",
	historyLimit: 500,
	pollIntervalMs: 10_000,
});
```

## Performance Considerations

### Memory

- **CandleStore**: Bounded by `cacheLimit` (default 500 candles per timeframe)
- **Event Handlers**: Set-based storage, O(1) add/remove
- **Aggregation**: Only processes newly closed buckets, not all history

### CPU

- **Gap Detection**: O(1) per candle (simple timestamp comparison)
- **Aggregation**: O(n) where n = candles in closed bucket (typically 5-60)
- **Polling**: Non-blocking async, configurable interval (default 10s)

### Network

- **Bootstrap**: Single REST call per timeframe (only base timeframe)
- **Gap Repair**: REST calls only when gaps detected
- **Polling**: Lightweight REST calls (limit=5) every 10s

## Error Handling

### Bootstrap Errors

```typescript
try {
	await this.bootstrapHistory(this.baseTimeframe, historyLimit);
} catch (error) {
	this.logger.error("plant_bootstrap_error", {
		venue: this.venue,
		symbol: this.symbol,
		timeframe: this.baseTimeframe,
		error: error instanceof Error ? error.message : String(error),
	});
	throw error;
}
```

### Poll Errors

```typescript
try {
	await this.pollOnce();
} catch (error) {
	this.logger.error("plant_poll_error", {
		venue: this.venue,
		symbol: this.symbol,
		error: error instanceof Error ? error.message : String(error),
	});
	// Continue polling on error (don't kill the loop)
}
```

### Gap Repair Errors

```typescript
try {
	const result = await repairCandleGap({
		/* ... */
	});
	// Process result
} catch (error) {
	this.logger.error("candle_gap_repair_failed", {
		venue: this.venue,
		symbol: this.symbol,
		timeframe: this.baseTimeframe,
		error: error instanceof Error ? error.message : String(error),
	});
	// Continue processing (don't block on gap repair failure)
}
```

## Logging Events

### Lifecycle Events

- `plant_starting`: When `start()` called
- `plant_stopped`: When `stop()` called
- `plant_bootstrap_complete`: After history fetch
- `plant_bootstrap_error`: On bootstrap failure

### Operational Events

- `candle_gap_detected`: When gap found between candles
- `candle_gap_repaired`: After successful gap repair
- `candle_gap_repair_failed`: On gap repair failure
- `plant_poll_error`: On polling failure
- `plant_handler_error`: When event handler throws

### Event Emission

All `ClosedCandleEvent` emissions logged via `this.emitEvent()` with metadata:

- `venue`, `symbol`, `timeframe`
- `arrivalDelayMs`: Time between candle close and emission
- `source`: "poll", "ws", or "rest"

## Future Enhancements

### Phase F+ (Provider Refactoring)

1. **BinanceUsdMMarketDataProvider**:
   - Remove multi-timeframe subscription logic
   - Implement `BaseCandleSource` interface
   - Subscribe only to base timeframe via WebSocket
   - Emit candles via `onCandle` callback

2. **PollingMarketDataProvider**:
   - Simplify to single timeframe polling
   - Remove gap repair logic (delegated to Plant)
   - Implement `BaseCandleSource` interface

3. **startTrader Integration**:
   - Wire Plant into trader loop
   - Subscribe to `plant.onCandle()` events
   - Filter events by `executionTimeframe`
   - Pass `candleStore` to `buildTickSnapshot`

### Phase F++ (Advanced Features)

1. **Multi-Symbol Support**:
   - Multiple Plants per trader (one per symbol)
   - Shared `candleStore` with symbol namespacing

2. **Intelligent Polling**:
   - Adaptive poll interval based on data freshness
   - Backpressure handling for slow markets

3. **Gap Repair Strategies**:
   - Configurable repair depth (how far back to repair)
   - Fallback to synthetic candles when REST unavailable

4. **Event Filtering**:
   - Plant-level filtering of events (e.g., only emit execution timeframe)
   - Reduces runTick invocations for multi-timeframe strategies

## Validation

### Build

```bash
pnpm -r build  # ✅ All packages compile successfully
```

### Tests

```bash
pnpm --filter @agenai/runtime test  # ✅ 62/62 tests pass
```

### Import Boundaries

```bash
rg -n "@agenai/exchange-" packages/runtime  # ✅ 0 matches (no violations)
```

### Holy Grail Phase Guard

```bash
pnpm --filter @agenai/runtime test holyGrailPhaseGuard  # ✅ 18/18 tests pass
```

## Conclusion

Phase F successfully implements the MarketDataPlant orchestrator, centralizing multi-timeframe data management and establishing a clean separation between data sources (providers) and data orchestration (Plant). The implementation:

- ✅ Maintains import boundaries (no @agenai/exchange-\* imports in runtime)
- ✅ Uses pure functions for aggregation (deterministic, testable)
- ✅ Handles gaps via REST backfill
- ✅ Emits events for all timeframes (base + aggregated)
- ✅ Passes all tests (62/62)
- ✅ Compiles without errors (all packages)

**Next Steps**: Refactor providers to `BaseCandleSource` and integrate Plant into `startTrader`.
