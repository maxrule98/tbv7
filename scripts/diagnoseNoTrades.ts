#!/usr/bin/env ts-node
/**
 * Diagnostic script to understand why no trades are occurring
 * Checks if setups are being detected but filtered out by quality filters
 */

import { runBacktest } from "@agenai/runtime";
import { createRuntimeSnapshot, loadRuntimeConfig } from "@agenai/runtime";

const start = new Date("2025-12-20T11:00:00.000Z").getTime();
const end = new Date("2025-12-20T11:30:00.000Z").getTime();

console.log("\n🔍 Diagnosing why no trades occurred...\n");
console.log(
	`Time range: ${new Date(start).toISOString()} to ${new Date(end).toISOString()}\n`
);

const config = {
	symbol: "BTC/USDT",
	timeframe: "1m",
	strategyId: "ultra_aggressive_btc_usdt" as const,
	startTimestamp: start,
	endTimestamp: end,
};

const runtimeBootstrap = loadRuntimeConfig({
	requestedStrategyId: "ultra_aggressive_btc_usdt",
});

const snapshot = createRuntimeSnapshot({
	runtimeConfig: runtimeBootstrap,
});

console.log("Strategy Config Quality Filters:");
console.log(
	JSON.stringify(snapshot.config.strategyConfig.qualityFilters, null, 2)
);
console.log("\n");

// Key filters to check:
const filters = snapshot.config.strategyConfig.qualityFilters;
console.log("⚠️  Key restrictive filters:");
console.log(`  • requireCvdAlignment: ${filters.requireCvdAlignment}`);
console.log(`  • minConfidence: ${filters.minConfidence}`);
console.log(
	`  • requireLongDiscountToVwapPct: ${filters.requireLongDiscountToVwapPct}`
);
console.log(
	`  • requireShortPremiumToVwapPct: ${filters.requireShortPremiumToVwapPct}`
);
console.log("\n");

console.log("💡 Hypothesis:");
console.log(
	"   The strategy may be generating setups, but they're being filtered out by:"
);
console.log("   1. CVD alignment requirement (must match trade direction)");
console.log("   2. Confidence thresholds (min 22-28% depending on play type)");
console.log("   3. VWAP positioning requirements");
console.log("\n");
console.log(
	"To see detailed diagnostics, check logs for 'ultra_diagnostics' events"
);
console.log("which show all setup checks and why they passed/failed.\n");
