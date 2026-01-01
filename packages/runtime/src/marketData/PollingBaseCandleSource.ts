import { Candle, MarketDataClient } from "@agenai/core";
import { timeframeToMs } from "@agenai/data";
import { runtimeLogger } from "../runtimeShared";
import type { BaseCandleSource } from "./types";

const DEFAULT_POLL_INTERVAL_MS = 10_000;

/**
 * Phase F: BaseCandleSource implementation for polling
 *
 * Polls MarketDataClient for ONLY base timeframe candles.
 * NO aggregation, NO gap repair, NO CandleStore usage.
 * MarketDataPlant handles all orchestration.
 */
export class PollingBaseCandleSource implements BaseCandleSource {
	readonly venue: string;
	private readonly client: MarketDataClient;
	private readonly pollIntervalMs: number;

	private running = false;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private lastProcessedTs = 0;
	private onCandleCallback:
		| ((
				candle: Candle,
				meta: { receivedAt: number; source: "ws" | "poll" | "rest" }
		  ) => void)
		| null = null;
	private symbol = "";
	private timeframe = "";
	private timeframeMs = 0;

	constructor(
		client: MarketDataClient,
		options: { pollIntervalMs?: number; venue?: string } = {}
	) {
		this.client = client;
		this.venue = options.venue ?? "mexc";
		this.pollIntervalMs = Math.max(
			options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
			1_000
		);
	}

	async start(args: {
		symbol: string;
		timeframe: string;
		onCandle: (
			candle: Candle,
			meta: { receivedAt: number; source: "ws" | "poll" | "rest" }
		) => void;
	}): Promise<void> {
		if (this.running) {
			throw new Error("PollingBaseCandleSource already running");
		}

		this.symbol = args.symbol;
		this.timeframe = args.timeframe;
		this.timeframeMs = timeframeToMs(args.timeframe);
		this.onCandleCallback = args.onCandle;
		this.running = true;

		runtimeLogger.info("polling_source_started", {
			venue: this.venue,
			symbol: this.symbol,
			timeframe: this.timeframe,
			pollIntervalMs: this.pollIntervalMs,
		});

		// Start polling loop
		this.schedulePoll();
	}

	async stop(): Promise<void> {
		if (!this.running) {
			return;
		}

		this.running = false;

		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}

		this.onCandleCallback = null;

		runtimeLogger.info("polling_source_stopped", {
			venue: this.venue,
			symbol: this.symbol,
			timeframe: this.timeframe,
		});
	}

	private schedulePoll(): void {
		if (!this.running) {
			return;
		}

		this.pollTimer = setTimeout(() => {
			this.pollTimer = null;
			void this.pollOnce().finally(() => this.schedulePoll());
		}, this.pollIntervalMs);
	}

	private async pollOnce(): Promise<void> {
		if (!this.running || !this.onCandleCallback) {
			return;
		}

		try {
			// Fetch recent candles
			const candles = await this.client.fetchOHLCV(
				this.symbol,
				this.timeframe,
				5 // Fetch last 5 to catch up if needed
			);

			if (candles.length === 0) {
				return;
			}

			// Sort by timestamp ascending
			candles.sort((a, b) => a.timestamp - b.timestamp);

			const receivedAt = Date.now();

			// Emit only candles newer than last processed
			for (const candle of candles) {
				if (candle.timestamp > this.lastProcessedTs) {
					// Normalize candle to match expected format
					const normalized: Candle = {
						...candle,
						symbol: this.symbol,
						timeframe: this.timeframe,
					};

					this.onCandleCallback(normalized, {
						receivedAt,
						source: "poll",
					});

					this.lastProcessedTs = candle.timestamp;
				}
			}
		} catch (error) {
			runtimeLogger.error("polling_source_error", {
				venue: this.venue,
				symbol: this.symbol,
				timeframe: this.timeframe,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
