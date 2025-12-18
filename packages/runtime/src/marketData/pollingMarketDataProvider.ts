import { Candle } from "@agenai/core";
import {
	DefaultDataProvider,
	LiveSubscription,
	timeframeToMs,
} from "@agenai/data";
import { MexcClient } from "@agenai/exchange-mexc";
import { runtimeLogger } from "../runtimeShared";
import {
	ClosedCandleEvent,
	ClosedCandleHandler,
	MarketDataBootstrapRequest,
	MarketDataBootstrapResult,
	MarketDataFeed,
	MarketDataFeedOptions,
	MarketDataProvider,
} from "./types";

const DEFAULT_POLL_INTERVAL_MS = 10_000;

export class PollingMarketDataProvider implements MarketDataProvider {
	readonly venue: string;
	private readonly dataProvider: DefaultDataProvider;

	constructor(
		private readonly client: MexcClient,
		options: { pollIntervalMs?: number; venue?: string } = {}
	) {
		this.venue = options.venue ?? "mexc";
		this.dataProvider = new DefaultDataProvider({ client });
		this.pollIntervalMs = Math.max(
			options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
			1_000
		);
	}

	private readonly pollIntervalMs: number;

	async bootstrap(
		request: MarketDataBootstrapRequest
	): Promise<MarketDataBootstrapResult> {
		const now = Date.now();
		const limit = Math.max(request.limit ?? 500, 1);
		const largestFrame = request.timeframes.reduce((max, tf) => {
			const size = timeframeToMs(tf);
			return Math.max(max, size);
		}, 60_000);
		const windowMs = largestFrame * (limit + 5);
		const startTimestamp = Math.max(0, now - windowMs);
		const series = await this.dataProvider.loadHistoricalSeries({
			symbol: request.symbol,
			startTimestamp,
			endTimestamp: now,
			requests: request.timeframes.map((tf) => ({
				timeframe: tf,
				limit,
			})),
		});
		const map = new Map<string, Candle[]>();
		for (const entry of series) {
			map.set(entry.timeframe, entry.candles ?? []);
		}
		return { candlesByTimeframe: map };
	}

	createFeed(options: MarketDataFeedOptions): MarketDataFeed {
		return new PollingMarketDataFeed({
			...options,
			dataProvider: this.dataProvider,
			venue: this.venue,
			pollIntervalMs: options.pollIntervalMs ?? this.pollIntervalMs,
			fetchCandles: (timeframe, limit, since) =>
				this.fetchCandles(options.symbol, timeframe, limit, since),
		});
	}

	async fetchCandles(
		symbol: string,
		timeframe: string,
		limit: number,
		since?: number
	): Promise<Candle[]> {
		return this.client.fetchOHLCV(symbol, timeframe, limit, since);
	}
}

interface PollingFeedOptions extends MarketDataFeedOptions {
	venue: string;
	pollIntervalMs: number;
	dataProvider: DefaultDataProvider;
	fetchCandles: (
		timeframe: string,
		limit: number,
		since?: number
	) => Promise<Candle[]>;
}

class PollingMarketDataFeed implements MarketDataFeed {
	private readonly listeners = new Set<ClosedCandleHandler>();
	private readonly lastProcessed = new Map<string, number>();
	private readonly timeframeMs: Map<string, number>;
	private readonly subscription: LiveSubscription;

	constructor(private readonly options: PollingFeedOptions) {
		this.timeframeMs = new Map(
			options.timeframes.map((tf) => [tf, timeframeToMs(tf)])
		);
		this.subscription = options.dataProvider.createLiveSubscription({
			symbol: options.symbol,
			timeframes: options.timeframes,
			pollIntervalMs: options.pollIntervalMs,
			bufferSize: 600,
		});
		this.subscription.onCandle((candle) => {
			void this.handleCandle(candle);
		});
	}

	start(): void {
		this.subscription.start();
	}

	stop(): void {
		this.subscription.stop();
	}

	onCandle(handler: ClosedCandleHandler): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	private async handleCandle(candle: Candle): Promise<void> {
		const timeframe = candle.timeframe;
		if (!this.timeframeMs.has(timeframe)) {
			return;
		}
		const tfMs = this.timeframeMs.get(timeframe) ?? 0;
		const lastTs = this.lastProcessed.get(timeframe) ?? 0;
		if (lastTs && candle.timestamp <= lastTs) {
			return;
		}
		if (lastTs && candle.timestamp > lastTs + tfMs) {
			const missing = Math.floor((candle.timestamp - lastTs) / tfMs) - 1;
			runtimeLogger.warn("candle_gap_detected", {
				venue: this.options.venue,
				symbol: this.options.symbol,
				timeframe,
				gapSize: missing,
			});
			await this.repairGap(timeframe, lastTs + tfMs, candle.timestamp, tfMs);
		}
		await this.emitEvent(candle, "poll", false);
		this.lastProcessed.set(timeframe, candle.timestamp);
	}

	private async repairGap(
		timeframe: string,
		startTimestamp: number,
		endTimestamp: number,
		tfMs: number
	): Promise<void> {
		const needed = Math.max(
			Math.floor((endTimestamp - startTimestamp) / tfMs),
			1
		);
		const candles = await this.options.fetchCandles(
			timeframe,
			needed + 2,
			startTimestamp
		);
		const missingCandles = candles
			.filter(
				(candle) =>
					candle.timestamp >= startTimestamp && candle.timestamp < endTimestamp
			)
			.sort((a, b) => a.timestamp - b.timestamp);
		for (const candle of missingCandles) {
			await this.emitEvent(candle, "rest", true);
			this.lastProcessed.set(timeframe, candle.timestamp);
		}
		if (missingCandles.length) {
			runtimeLogger.info("candle_gap_repaired", {
				venue: this.options.venue,
				timeframe,
				repairedCandles: missingCandles.length,
			});
		}
	}

	private async emitEvent(
		candle: Candle,
		source: ClosedCandleEvent["source"],
		gapFilled: boolean
	): Promise<void> {
		const tfMs = this.timeframeMs.get(candle.timeframe) ?? 0;
		const expectedClose = candle.timestamp + tfMs;
		const arrivalDelayMs = Math.max(0, Date.now() - expectedClose);
		const event: ClosedCandleEvent = {
			venue: this.options.venue,
			symbol: this.options.symbol,
			timeframe: candle.timeframe,
			candle,
			arrivalDelayMs,
			gapFilled,
			source,
		};
		runtimeLogger.info("candle_closed_emitted", {
			venue: event.venue,
			symbol: event.symbol,
			timeframe: event.timeframe,
			timestamp: candle.timestamp,
			arrivalDelayMs,
			source,
			gapFilled,
		});
		if (!this.listeners.size) {
			return;
		}
		const handlers = Array.from(this.listeners).map(async (handler) => {
			try {
				await handler(event);
			} catch (error) {
				runtimeLogger.error("candle_handler_error", {
					message: error instanceof Error ? error.message : String(error),
				});
			}
		});
		await Promise.allSettled(handlers);
	}
}
