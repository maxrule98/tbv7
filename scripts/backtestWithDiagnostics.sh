#!/bin/bash
# Run backtest with diagnostic logging to analyze strategy behavior

echo "🔬 Running backtest with diagnostic logging..."
echo ""

# Set log level to capture diagnostics
export LOG_LEVEL=info

# Run backtest for a manageable period
pnpm backtest -- \
  --strategy=ultra_aggressive_btc_usdt \
  --start "2024-12-15T00:00:00.000Z" \
  --end "2024-12-20T23:59:59.000Z" \
  --withMetrics \
  2>&1 | tee /tmp/backtest_with_diagnostics.log

echo ""
echo "📊 Analyzing diagnostics..."
echo ""

# Extract key diagnostic info
echo "=== Strategy Diagnostics Summary ==="
grep '"event":"strategy_diagnostics"' /tmp/backtest_with_diagnostics.log | wc -l | xargs echo "Total diagnostic events:"

echo ""
echo "=== Sample Diagnostic (first occurrence) ==="
grep '"event":"strategy_diagnostics"' /tmp/backtest_with_diagnostics.log | head -1 | jq '.' 2>/dev/null || echo "jq not available"

echo ""
echo "=== All Strategy Decisions ==="
grep '"event":"strategy_decision"' /tmp/backtest_with_diagnostics.log | tail -20

echo ""
echo "Full log saved to: /tmp/backtest_with_diagnostics.log"
