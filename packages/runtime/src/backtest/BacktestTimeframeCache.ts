import { Candle, MultiTimeframeCache } from "@agenai/core";

export interface BacktestTimeframeCacheOptions {
	timeframes: string[];
	limit?: number;
}

export class BacktestTimeframeCache implements MultiTimeframeCache {
	private readonly frames = new Map<string, Candle[]>();
	private readonly limit: number;
	private readonly tracked: Set<string>;

	constructor(options: BacktestTimeframeCacheOptions) {
		this.limit = Math.max(options.limit ?? 1, 1);
		this.tracked = new Set(options.timeframes);
		for (const tf of this.tracked) {
			this.frames.set(tf, []);
		}
	}

	async getCandles(timeframe: string): Promise<Candle[]> {
		this.ensureTracked(timeframe);
		return [...(this.frames.get(timeframe) ?? [])];
	}

	async getLatestCandle(timeframe: string): Promise<Candle | undefined> {
		this.ensureTracked(timeframe);
		const candles = this.frames.get(timeframe);
		return candles?.[candles.length - 1];
	}

	async refreshAll(): Promise<void> {
		// Backtests push candles manually, so refresh is a no-op.
	}

	setCandles(timeframe: string, candles: Candle[]): void {
		this.ensureTracked(timeframe);
		const trimmed = this.trim(candles);
		this.frames.set(timeframe, trimmed);
	}

	appendCandles(timeframe: string, candles: Candle[]): void {
		if (!candles.length) {
			return;
		}
		this.ensureTracked(timeframe);
		const existing = this.frames.get(timeframe) ?? [];
		existing.push(...candles);
		this.frames.set(timeframe, this.trim(existing));
	}

	appendCandle(timeframe: string, candle: Candle): void {
		this.appendCandles(timeframe, [candle]);
	}

	private trim(candles: Candle[]): Candle[] {
		if (candles.length <= this.limit) {
			return [...candles];
		}
		return candles.slice(candles.length - this.limit);
	}

	private ensureTracked(timeframe: string): void {
		if (!this.tracked.has(timeframe)) {
			throw new Error(
				`Timeframe ${timeframe} is not tracked in backtest cache`
			);
		}
	}
}
