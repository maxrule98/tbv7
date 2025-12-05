import { Candle } from "@agenai/core";
import {
	CandleHandler,
	DataProviderLogger,
	LiveSubscription,
	LiveSubscriptionOptions,
	MarketDataClient,
} from "./types";

interface PollingSubscriptionOptions extends LiveSubscriptionOptions {
	client: MarketDataClient;
	logger?: DataProviderLogger;
}

export class PollingLiveSubscription implements LiveSubscription {
	private readonly listeners = new Set<CandleHandler>();
	private readonly buffers = new Map<string, Candle[]>();
	private readonly lastTimestampByTimeframe = new Map<string, number>();
	private readonly timeframes: string[];
	private readonly pollIntervalMs: number;
	private readonly bufferSize: number;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;

	constructor(private readonly options: PollingSubscriptionOptions) {
		if (!options.timeframes.length) {
			throw new Error("Live subscription requires at least one timeframe");
		}
		this.timeframes = Array.from(new Set(options.timeframes));
		this.pollIntervalMs = Math.max(options.pollIntervalMs ?? 10_000, 1_000);
		this.bufferSize = Math.max(options.bufferSize ?? 600, 1);
		for (const timeframe of this.timeframes) {
			this.buffers.set(timeframe, []);
		}
	}

	start(): void {
		if (this.running) {
			return;
		}
		this.running = true;
		void this.tick();
	}

	stop(): void {
		if (!this.running) {
			return;
		}
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	onCandle(handler: CandleHandler): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	getCandles(timeframe: string): Candle[] {
		const buffer = this.buffers.get(timeframe);
		if (!buffer) {
			throw new Error(
				`Timeframe ${timeframe} is not tracked by this subscription`
			);
		}
		return [...buffer];
	}

	private async tick(): Promise<void> {
		if (!this.running) {
			return;
		}

		await this.runOnce();

		if (this.running) {
			this.timer = setTimeout(() => {
				void this.tick();
			}, this.pollIntervalMs);
		}
	}

	public async runOnce(): Promise<void> {
		await Promise.all(this.timeframes.map((tf) => this.pollTimeframe(tf)));
	}

	private async pollTimeframe(timeframe: string): Promise<void> {
		try {
			const candles = await this.options.client.fetchOHLCV(
				this.options.symbol,
				timeframe,
				1
			);
			const latest = candles[candles.length - 1];
			if (!latest) {
				return;
			}
			const lastTimestamp = this.lastTimestampByTimeframe.get(timeframe);
			if (lastTimestamp === latest.timestamp) {
				return;
			}
			this.lastTimestampByTimeframe.set(timeframe, latest.timestamp);
			this.appendToBuffer(timeframe, latest);
			await this.emit(latest);
		} catch (error) {
			this.options.logger?.error?.("live_poll_error", {
				timeframe,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private appendToBuffer(timeframe: string, candle: Candle): void {
		const buffer = this.buffers.get(timeframe);
		if (!buffer) {
			return;
		}
		buffer.push(candle);
		while (buffer.length > this.bufferSize) {
			buffer.shift();
		}
	}

	private async emit(candle: Candle): Promise<void> {
		if (!this.listeners.size) {
			return;
		}
		const listeners = Array.from(this.listeners);
		await Promise.allSettled(
			listeners.map(async (listener) => {
				try {
					await listener(candle);
				} catch (error) {
					this.options.logger?.error?.("live_listener_error", {
						message: error instanceof Error ? error.message : String(error),
					});
				}
			})
		);
	}
}
