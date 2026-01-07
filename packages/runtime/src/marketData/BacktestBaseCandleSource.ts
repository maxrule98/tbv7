import { Candle } from "@agenai/core";
import type { BaseCandleSource } from "./types";

interface BacktestBaseCandleSourceOptions {
	venue: string;
	symbol: string;
	timeframe: string;
	candles: Candle[];
	logger?: {
		info: (event: string, data?: Record<string, unknown>) => void;
		warn: (event: string, data?: Record<string, unknown>) => void;
		error: (event: string, data?: Record<string, unknown>) => void;
	};
}

/**
 * Phase G: BaseCandleSource implementation for backtesting
 *
 * Emits pre-loaded historical candles synchronously in ascending timestamp order.
 * NO network calls, NO timers, NO async gaps - purely deterministic replay.
 * MarketDataPlant still handles aggregation and gap detection.
 */
export class BacktestBaseCandleSource implements BaseCandleSource {
	readonly venue: string;
	private readonly symbol: string;
	private readonly timeframe: string;
	private readonly candles: Candle[];
	private readonly logger?: BacktestBaseCandleSourceOptions["logger"];

	private stopped = false;

	constructor(options: BacktestBaseCandleSourceOptions) {
		this.venue = options.venue;
		this.symbol = options.symbol;
		this.timeframe = options.timeframe;
		this.candles = options.candles;
		this.logger = options.logger;
	}

	async start(args: {
		symbol: string;
		timeframe: string;
		onCandle: (
			candle: Candle,
			meta: {
				receivedAt: number;
				source: "ws" | "poll" | "rest" | "backtest";
			}
		) => void;
	}): Promise<void> {
		// Validate symbol/timeframe match configuration
		if (args.symbol !== this.symbol) {
			throw new Error(
				`BacktestBaseCandleSource: symbol mismatch. Expected '${this.symbol}', got '${args.symbol}'`
			);
		}

		if (args.timeframe !== this.timeframe) {
			throw new Error(
				`BacktestBaseCandleSource: timeframe mismatch. Expected '${this.timeframe}', got '${args.timeframe}'`
			);
		}

		this.logger?.info("backtest_base_source_start", {
			venue: this.venue,
			symbol: this.symbol,
			timeframe: this.timeframe,
			candleCount: this.candles.length,
		});

		// Defensive: Sort candles by timestamp ascending
		const sortedCandles = [...this.candles].sort(
			(a, b) => a.timestamp - b.timestamp
		);

		// Emit all candles, awaiting each handler to ensure execution completes
		for (const candle of sortedCandles) {
			// Check stopped flag to allow early termination
			if (this.stopped) {
				this.logger?.info("backtest_base_source_stopped_early", {
					venue: this.venue,
					symbol: this.symbol,
					timeframe: this.timeframe,
				});
				break;
			}

			await args.onCandle(candle, {
				receivedAt: candle.timestamp, // For backtest, arrival = candle close time
				source: "backtest", // Backtest source indicator
			});
		}

		this.logger?.info("backtest_base_source_complete", {
			venue: this.venue,
			symbol: this.symbol,
			timeframe: this.timeframe,
			emitted: this.stopped ? "partial (stopped early)" : sortedCandles.length,
		});
	}

	async stop(): Promise<void> {
		if (this.stopped) {
			return; // Idempotent
		}

		this.stopped = true;

		this.logger?.info("backtest_base_source_stop", {
			venue: this.venue,
			symbol: this.symbol,
			timeframe: this.timeframe,
		});
	}
}
