# Cleanup Notes

- **apps/backtester-cli**
  - Purpose: Legacy CLI for historical backtesting.
  - Why legacy: Not referenced by root scripts besides the broad `dev` glob, no README coverage, and config/runtimes now rely on `packages/backtest-core` instead.
  - Suggested action: Confirm with team, then delete or merge functionality into a single `pnpm backtest` tool.

- **apps/dashboard**
  - Purpose: React dashboard (likely Vite/Next) for visualization.
  - Why legacy: No deployment scripts, no current API endpoints feeding it, and Render logs mention only CLI worker usage.
  - Suggested action: Audit usage; if unused, archive or extract reusable UI components before removal.

- **apps/trader-server**
  - Purpose: HTTP/WebSocket wrapper around trader runtime.
  - Why legacy: Server scripts (`build:server`, `start:server`) are unused in Render deploys; worker now runs purely via CLI.
  - Suggested action: Decide whether a server is still needed; if not, delete and keep any remaining shared code inside `packages/runtime`.

- **packages/persistence**
  - Purpose: DB adapter layer (empty `src/`).
  - Why legacy: Package exists but has no implementation, tests, or references in the monorepo.
  - Suggested action: Remove or repurpose for actual storage integration when required.

- **apps/backtester-cli/config/** duplicates\*\*
  - Purpose: Contains config snapshots duplicating `/config`.
  - Why legacy: Increases drift risk; new VWAP strategy already sources from `/configs`.
  - Suggested action: Deduplicate configs under a single directory and remove stale copies.
