import type { Candle, CandleStore, MarketDataClient } from "@agenai/core";
import { timeframeToMs } from "@agenai/core";
import { repairCandleGap } from "@agenai/data";
import type {
	BaseCandleSource,
	ClosedCandleEvent,
	ClosedCandleHandler,
} from "./types";
import { aggregateNewlyClosed } from "./aggregateCandles";

export interface MarketDataPlantOptions {
	venue: string;
	symbol: string;
	marketDataClient: MarketDataClient;
	candleStore: CandleStore;
	source: BaseCandleSource;
	logger?: {
		info(event: string, payload?: Record<string, unknown>): void;
		warn(event: string, payload?: Record<string, unknown>): void;
		error(event: string, payload?: Record<string, unknown>): void;
	};
}

export interface MarketDataPlantStartOptions {
	timeframes: string[];
	executionTimeframe: string;
	historyLimit: number;
}

/**
 * Phase F: MarketDataPlant
 *
 * Orchestrates market data ingestion for multiple timeframes by:
 * 1. Subscribing to ONE base timeframe (lowest requested) via BaseCandleSource
 * 2. Storing candles in CandleStore
 * 3. Aggregating upward to higher timeframes
 * 4. Repairing gaps via REST backfill
 * 5. Emitting ClosedCandleEvent for all timeframes
 *
 * Plant owns the orchestration; sources emit base timeframe candles only.
 */
export class MarketDataPlant {
	private readonly venue: string;
	private readonly symbol: string;
	private readonly marketDataClient: MarketDataClient;
	private readonly candleStore: CandleStore;
	private readonly source: BaseCandleSource;
	private readonly logger: {
		info(event: string, payload?: Record<string, unknown>): void;
		warn(event: string, payload?: Record<string, unknown>): void;
		error(event: string, payload?: Record<string, unknown>): void;
	};
	private readonly handlers: Set<ClosedCandleHandler> = new Set();

	private baseTimeframe: string | null = null;
	private requestedTimeframes: string[] = [];
	private executionTimeframe: string | null = null;
	private lastBaseTsMs = 0;
	private isRunning = false;

	constructor(options: MarketDataPlantOptions) {
		this.venue = options.venue;
		this.symbol = options.symbol;
		this.marketDataClient = options.marketDataClient;
		this.candleStore = options.candleStore;
		this.source = options.source;
		this.logger = options.logger ?? {
			info: () => {},
			warn: () => {},
			error: () => {},
		};
	}

	/**
	 * Start the plant: bootstrap history, start base feed
	 */
	async start(options: MarketDataPlantStartOptions): Promise<void> {
		if (this.isRunning) {
			throw new Error("MarketDataPlant already running");
		}

		this.requestedTimeframes = [...options.timeframes];
		this.executionTimeframe = options.executionTimeframe;

		// Select base timeframe (smallest interval)
		this.baseTimeframe = this.selectBaseTimeframe(this.requestedTimeframes);

		this.logger.info("plant_starting", {
			venue: this.venue,
			symbol: this.symbol,
			baseTimeframe: this.baseTimeframe,
			requestedTimeframes: this.requestedTimeframes,
			executionTimeframe: this.executionTimeframe,
			historyLimit: options.historyLimit,
		});

		// Bootstrap base timeframe history
		await this.bootstrapHistory(this.baseTimeframe, options.historyLimit);

		// Start base candle source
		this.isRunning = true;
		await this.source.start({
			symbol: this.symbol,
			timeframe: this.baseTimeframe,
			onCandle: (candle, meta) => {
				void this.processBaseCandle(candle, meta);
			},
		});
	}

	/**
	 * Stop source, clean up
	 */
	async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		// Stop the base candle source
		await this.source.stop();

		this.logger.info("plant_stopped", {
			venue: this.venue,
			symbol: this.symbol,
		});
	}

	/**
	 * Subscribe to closed candle events
	 */
	onCandle(handler: ClosedCandleHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	/**
	 * Select base timeframe (smallest interval among requested)
	 */
	private selectBaseTimeframe(timeframes: string[]): string {
		if (timeframes.length === 0) {
			throw new Error("At least one timeframe must be requested");
		}

		let baseTf = timeframes[0];
		let baseMs = timeframeToMs(baseTf);

		for (const tf of timeframes) {
			const ms = timeframeToMs(tf);
			if (ms < baseMs) {
				baseMs = ms;
				baseTf = tf;
			}
		}

		return baseTf;
	}

	/**
	 * Bootstrap base timeframe history from REST
	 */
	private async bootstrapHistory(
		timeframe: string,
		limit: number
	): Promise<void> {
		try {
			const candles = await this.marketDataClient.fetchOHLCV(
				this.symbol,
				timeframe,
				limit
			);

			for (const candle of candles) {
				this.candleStore.ingest(timeframe, candle);
			}

			if (candles.length > 0) {
				this.lastBaseTsMs = candles[candles.length - 1].timestamp;
			}

			this.logger.info("plant_bootstrap_complete", {
				venue: this.venue,
				symbol: this.symbol,
				timeframe,
				candleCount: candles.length,
				lastTimestamp: this.lastBaseTsMs,
			});
		} catch (error) {
			this.logger.error("plant_bootstrap_error", {
				venue: this.venue,
				symbol: this.symbol,
				timeframe,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Process a base candle: detect gaps, repair, aggregate, emit
	 */
	private async processBaseCandle(
		candle: Candle,
		meta: { receivedAt: number; source: "ws" | "poll" | "rest" }
	): Promise<void> {
		if (!this.baseTimeframe) {
			return;
		}

		const baseTfMs = timeframeToMs(this.baseTimeframe);

		// Detect and repair gaps
		if (this.lastBaseTsMs >= 0 && candle.timestamp > this.lastBaseTsMs) {
			const expectedNext = this.lastBaseTsMs + baseTfMs;
			if (candle.timestamp > expectedNext) {
				await this.repairGap(expectedNext, candle.timestamp);
			}
		}

		// Ingest base candle
		this.candleStore.ingest(this.baseTimeframe, candle);

		// Emit base candle event
		await this.emitEvent({
			venue: this.venue,
			symbol: this.symbol,
			timeframe: this.baseTimeframe,
			candle,
			arrivalDelayMs: meta.receivedAt - candle.timestamp,
			source: meta.source,
		});

		// Aggregate higher timeframes
		await this.aggregateAndEmit(this.lastBaseTsMs, candle.timestamp);

		// Update last seen timestamp
		this.lastBaseTsMs = candle.timestamp;
	}

	/**
	 * Repair gap in base timeframe candles
	 */
	private async repairGap(expectedTs: number, actualTs: number): Promise<void> {
		if (!this.baseTimeframe) {
			return;
		}

		this.logger.warn("candle_gap_detected", {
			venue: this.venue,
			symbol: this.symbol,
			timeframe: this.baseTimeframe,
			expectedTs,
			actualTs,
			gapMs: actualTs - expectedTs,
		});

		try {
			const fetchCandles = async (since: number): Promise<Candle[]> => {
				return this.marketDataClient.fetchOHLCV(
					this.symbol,
					this.baseTimeframe!,
					100,
					since
				);
			};

			const repaired = await repairCandleGap({
				timeframe: this.baseTimeframe,
				lastTs: expectedTs - timeframeToMs(this.baseTimeframe),
				nextTs: actualTs,
				fetchCandles,
			});

			// Ingest repaired candles
			for (const repairedCandle of repaired.missing) {
				this.candleStore.ingest(this.baseTimeframe, repairedCandle);

				// Emit repaired candle event
				await this.emitEvent({
					venue: this.venue,
					symbol: this.symbol,
					timeframe: this.baseTimeframe,
					candle: repairedCandle,
					arrivalDelayMs: Date.now() - repairedCandle.timestamp,
					gapFilled: true,
					source: "rest",
				});
			}

			this.logger.info("candle_gap_repaired", {
				venue: this.venue,
				symbol: this.symbol,
				timeframe: this.baseTimeframe,
				repairedCount: repaired.missing.length,
			});
		} catch (error) {
			this.logger.error("candle_gap_repair_failed", {
				venue: this.venue,
				symbol: this.symbol,
				timeframe: this.baseTimeframe,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Aggregate higher timeframes and emit newly closed candles
	 */
	private async aggregateAndEmit(
		previousBaseTsMs: number,
		currentBaseTsMs: number
	): Promise<void> {
		if (!this.baseTimeframe) {
			return;
		}

		// Get target timeframes (all except base)
		const targetTimeframes = this.requestedTimeframes.filter(
			(tf) => tf !== this.baseTimeframe
		);

		if (targetTimeframes.length === 0) {
			return;
		}

		// Get base candles from store
		const baseCandles = this.candleStore.getSeries(this.baseTimeframe);

		// Aggregate newly closed candles
		const aggregated = aggregateNewlyClosed(
			baseCandles,
			targetTimeframes,
			previousBaseTsMs,
			currentBaseTsMs,
			this.symbol
		);

		// Emit aggregated candles
		for (const { timeframe, candle } of aggregated) {
			// Ingest into store
			this.candleStore.ingest(timeframe, candle);

			// Emit event
			await this.emitEvent({
				venue: this.venue,
				symbol: this.symbol,
				timeframe,
				candle,
				arrivalDelayMs: Date.now() - candle.timestamp,
				source: "rest", // Aggregated from base candles
			});
		}
	}

	/**
	 * Emit closed candle event to all handlers
	 */
	private async emitEvent(event: ClosedCandleEvent): Promise<void> {
		for (const handler of this.handlers) {
			try {
				await handler(event);
			} catch (error) {
				this.logger.error("plant_handler_error", {
					venue: this.venue,
					symbol: this.symbol,
					timeframe: event.timeframe,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
}
