import WebSocket from "ws";
import { Candle, ExchangeAdapter } from "@agenai/core";
import { timeframeToMs, repairCandleGap } from "@agenai/data";
import { runtimeLogger } from "../runtimeShared";
import { normalizeSymbolForVenue, toCanonicalSymbol } from "../symbols";
import {
	ClosedCandleEvent,
	ClosedCandleHandler,
	MarketDataBootstrapRequest,
	MarketDataBootstrapResult,
	MarketDataFeed,
	MarketDataFeedOptions,
	MarketDataProvider,
} from "./types";

const STREAM_ENDPOINT = "wss://fstream.binance.com/stream";
const DEFAULT_BOOTSTRAP_LIMIT = 500;
const GAP_FETCH_PADDING = 2;
const POLL_GRACE_FACTOR = 1.5;
const MIN_POLL_GRACE_MS = 5_000;
const MAX_REPAIR_CANDLES = 50;
const WS_HEALTH_FACTOR = 1.75;
const MIN_WS_HEALTH_MS = 10_000;

export class BinanceUsdMMarketDataProvider implements MarketDataProvider {
	readonly venue = "binance";

	constructor(private readonly client: ExchangeAdapter) {}

	async bootstrap(
		request: MarketDataBootstrapRequest
	): Promise<MarketDataBootstrapResult> {
		const candlesByTimeframe = new Map<string, Candle[]>();
		for (const timeframe of request.timeframes) {
			const candles = await this.fetchCandles(
				request.symbol,
				timeframe,
				request.limit || DEFAULT_BOOTSTRAP_LIMIT
			);
			candlesByTimeframe.set(timeframe, candles);
		}
		return { candlesByTimeframe };
	}

	createFeed(options: MarketDataFeedOptions): MarketDataFeed {
		return new BinanceUsdMClosedCandleFeed({
			...options,
			venue: this.venue,
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

interface BinanceFeedOptions extends MarketDataFeedOptions {
	venue: string;
	fetchCandles: (
		timeframe: string,
		limit: number,
		since?: number
	) => Promise<Candle[]>;
}

class BinanceUsdMClosedCandleFeed implements MarketDataFeed {
	private readonly listeners = new Set<ClosedCandleHandler>();
	private readonly timeframes: string[];
	private readonly timeframeMs: Map<string, number>;
	private readonly canonicalSymbol: string;
	private readonly identityByTimeframe = new Map<string, string>();
	private readonly lastEmitted = new Map<string, number>();
	private readonly pendingEmissions = new Map<string, Set<number>>();
	private readonly lastWsArrival = new Map<string, number>();
	private readonly arrivalSamples = new Map<string, number[]>();
	private readonly wsSymbol: string;
	private ws: WebSocket | null = null;
	private running = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly fallbackOffsetMs: number;

	constructor(private readonly options: BinanceFeedOptions) {
		this.timeframes = Array.from(new Set(options.timeframes));
		this.timeframeMs = new Map(
			this.timeframes.map((tf) => [tf, timeframeToMs(tf)])
		);
		this.canonicalSymbol = toCanonicalSymbol(options.symbol);
		for (const timeframe of this.timeframes) {
			this.identityByTimeframe.set(timeframe, this.buildIdentityKey(timeframe));
		}
		this.wsSymbol = normalizeSymbolForVenue("binance", options.symbol)
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "");
		this.fallbackOffsetMs = options.fallbackOffsetMs ?? 500;
	}

	start(): void {
		if (this.running) {
			return;
		}
		this.running = true;
		this.connect();
		this.scheduleFallback();
	}

	stop(): void {
		if (!this.running) {
			return;
		}
		this.running = false;
		this.cleanupWs();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.fallbackTimer) {
			clearTimeout(this.fallbackTimer);
			this.fallbackTimer = null;
		}
	}

	onCandle(handler: ClosedCandleHandler): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	private connect(): void {
		if (!this.running) {
			return;
		}
		const stream = this.timeframes
			.map((tf) => `${this.wsSymbol}@kline_${tf}`)
			.join("/");
		const url = `${STREAM_ENDPOINT}?streams=${stream}`;
		this.ws = new WebSocket(url);
		this.ws.on("open", () => {
			runtimeLogger.info("binance_ws_connected", {
				venue: this.options.venue,
				symbol: this.options.symbol,
				timeframes: this.timeframes,
			});
		});
		this.ws.on("message", (payload) => {
			void this.handleMessage(payload.toString());
		});
		this.ws.on("close", () => {
			runtimeLogger.warn("binance_ws_disconnected", {
				venue: this.options.venue,
				symbol: this.options.symbol,
			});
			this.scheduleReconnect();
		});
		this.ws.on("error", (error) => {
			runtimeLogger.error("binance_ws_error", {
				message: error instanceof Error ? error.message : String(error),
			});
		});
	}

	private scheduleReconnect(): void {
		if (!this.running) {
			return;
		}
		if (this.reconnectTimer) {
			return;
		}
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.cleanupWs();
			this.connect();
		}, 1_000);
	}

	private cleanupWs(): void {
		if (this.ws) {
			this.ws.removeAllListeners();
			try {
				this.ws.terminate();
			} catch (error) {
				// ignore termination errors
			}
			this.ws = null;
		}
	}

	private async handleMessage(raw: string): Promise<void> {
		if (!this.running) {
			return;
		}
		try {
			const payload = JSON.parse(raw) as {
				stream?: string;
				data?: {
					e?: string;
					E: number;
					s: string;
					k: Record<string, unknown>;
				};
			};
			const stream = payload.stream ?? "";
			const timeframe = this.extractTimeframe(stream);
			if (!timeframe || !this.timeframeMs.has(timeframe)) {
				return;
			}
			const kline = payload.data?.k as Record<string, unknown> | undefined;
			if (!kline || kline.x !== true) {
				return;
			}
			const candle = this.mapCandle(kline, timeframe);
			await this.handleClosedCandle(timeframe, candle, Date.now(), "ws");
		} catch (error) {
			runtimeLogger.error("binance_ws_parse_error", {
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private extractTimeframe(stream: string): string | null {
		const match = stream.match(/@kline_(.+)$/);
		return match?.[1] ?? null;
	}

	private mapCandle(kline: Record<string, unknown>, timeframe: string): Candle {
		return {
			symbol: this.canonicalSymbol,
			timeframe,
			timestamp: Number(kline.t ?? 0),
			open: Number(kline.o ?? 0),
			high: Number(kline.h ?? 0),
			low: Number(kline.l ?? 0),
			close: Number(kline.c ?? 0),
			volume: Number(kline.v ?? 0),
		};
	}

	private normalizeCandle(candle: Candle, timeframe: string): Candle {
		if (
			candle.symbol === this.canonicalSymbol &&
			candle.timeframe === timeframe
		) {
			return candle;
		}
		return {
			...candle,
			symbol: this.canonicalSymbol,
			timeframe,
		};
	}

	private async handleClosedCandle(
		timeframe: string,
		candle: Candle,
		receivedAt: number,
		source: ClosedCandleEvent["source"],
		gapFilled = false
	): Promise<void> {
		const normalized = this.normalizeCandle(candle, timeframe);
		await this.processCandle(
			timeframe,
			normalized,
			receivedAt,
			source,
			gapFilled
		);
	}

	private async emitEvent(
		timeframe: string,
		candle: Candle,
		receivedAt: number,
		source: ClosedCandleEvent["source"],
		gapFilled: boolean
	): Promise<void> {
		const tfMs = this.timeframeMs.get(timeframe) ?? 0;
		const expectedClose = candle.timestamp + tfMs;
		const arrivalDelayMs = Math.max(0, receivedAt - expectedClose);
		this.recordArrival(timeframe, arrivalDelayMs);
		const event: ClosedCandleEvent = {
			venue: this.options.venue,
			symbol: this.canonicalSymbol,
			timeframe,
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
		await this.notifyListeners(event);
	}

	private async processCandle(
		timeframe: string,
		candle: Candle,
		receivedAt: number,
		source: ClosedCandleEvent["source"],
		gapFilled: boolean,
		skipGapDetection = false
	): Promise<void> {
		const tfMs = this.timeframeMs.get(timeframe);
		if (!tfMs) {
			return;
		}
		const key = this.identityKey(timeframe);
		const lastTs = this.lastEmitted.get(key) ?? 0;
		if (!skipGapDetection && lastTs && candle.timestamp > lastTs + tfMs) {
			const missing = Math.floor((candle.timestamp - lastTs) / tfMs) - 1;
			runtimeLogger.warn("candle_gap_detected", {
				venue: this.options.venue,
				symbol: this.canonicalSymbol,
				timeframe,
				gapSize: missing,
				lastTimestamp: lastTs,
				currentTimestamp: candle.timestamp,
			});

			// Repair gap using shared function
			const startTimestamp = lastTs + tfMs;
			const endTimestamp = candle.timestamp;
			const result = await repairCandleGap({
				timeframe,
				lastTs: startTimestamp - tfMs,
				nextTs: endTimestamp,
				fetchCandles: async (fromTs) => {
					const needed = Math.max(
						Math.floor((endTimestamp - fromTs) / tfMs),
						1
					);
					return this.options.fetchCandles(
						timeframe,
						needed + GAP_FETCH_PADDING,
						fromTs
					);
				},
			});

			const normalizedCandles = result.missing.map((c) =>
				this.normalizeCandle(c, timeframe)
			);

			for (const repairedCandle of normalizedCandles) {
				await this.processCandle(
					timeframe,
					repairedCandle,
					Date.now(),
					"rest",
					true,
					true
				);
			}

			if (normalizedCandles.length) {
				runtimeLogger.info("candle_gap_repaired", {
					venue: this.options.venue,
					symbol: this.canonicalSymbol,
					timeframe,
					repairedCandles: normalizedCandles.length,
				});
			}
		}
		if (!this.reserveTimestamp(key, candle.timestamp)) {
			return;
		}
		try {
			await this.emitEvent(timeframe, candle, receivedAt, source, gapFilled);
			this.lastEmitted.set(key, candle.timestamp);
			if (source === "ws") {
				this.lastWsArrival.set(key, receivedAt);
			}
		} finally {
			this.releaseTimestamp(key, candle.timestamp);
		}
	}

	private reserveTimestamp(key: string, timestamp: number): boolean {
		const lastTs = this.lastEmitted.get(key) ?? 0;
		if (lastTs && timestamp <= lastTs) {
			return false;
		}
		const pending = this.pendingEmissions.get(key) ?? new Set<number>();
		if (pending.has(timestamp)) {
			return false;
		}
		pending.add(timestamp);
		this.pendingEmissions.set(key, pending);
		return true;
	}

	private releaseTimestamp(key: string, timestamp: number): void {
		const pending = this.pendingEmissions.get(key);
		if (!pending) {
			return;
		}
		pending.delete(timestamp);
		if (!pending.size) {
			this.pendingEmissions.delete(key);
		}
	}

	private recordArrival(timeframe: string, delay: number): void {
		const samples = this.arrivalSamples.get(timeframe) ?? [];
		samples.push(delay);
		if (samples.length >= 50) {
			const sorted = [...samples].sort((a, b) => a - b);
			const p50 = this.percentile(sorted, 0.5);
			const p95 = this.percentile(sorted, 0.95);
			const max = sorted[sorted.length - 1];
			runtimeLogger.info("candle_delay_summary", {
				venue: this.options.venue,
				timeframe,
				p50,
				p95,
				max,
				sampleSize: samples.length,
			});
			samples.length = 0;
		}
		this.arrivalSamples.set(timeframe, samples);
	}

	private percentile(values: number[], percentile: number): number {
		if (!values.length) {
			return 0;
		}
		const index = Math.min(
			values.length - 1,
			Math.floor(percentile * values.length)
		);
		return values[index];
	}

	private async notifyListeners(event: ClosedCandleEvent): Promise<void> {
		if (!this.listeners.size) {
			return;
		}
		const tasks = Array.from(this.listeners).map(async (handler) => {
			try {
				await handler(event);
			} catch (error) {
				runtimeLogger.error("candle_handler_error", {
					message: error instanceof Error ? error.message : String(error),
				});
			}
		});
		await Promise.allSettled(tasks);
	}

	private scheduleFallback(): void {
		if (!this.running) {
			return;
		}
		const now = Date.now();
		const nextMinute = Math.floor(now / 60_000) * 60_000 + 60_000;
		const target = nextMinute + this.fallbackOffsetMs;
		const delay = Math.max(target - now, 500);
		this.fallbackTimer = setTimeout(() => {
			this.fallbackTimer = null;
			void this.runFallback().finally(() => this.scheduleFallback());
		}, delay);
	}

	private async runFallback(): Promise<void> {
		if (!this.running) {
			return;
		}
		const now = Date.now();
		for (const timeframe of this.timeframes) {
			await this.detectAndRepairGap(timeframe, now);
		}
	}

	private async detectAndRepairGap(
		timeframe: string,
		now: number
	): Promise<void> {
		const tfMs = this.timeframeMs.get(timeframe);
		if (!tfMs) {
			return;
		}
		const key = this.identityKey(timeframe);
		const lastTs = this.lastEmitted.get(key);
		const wsConnected = this.isWsConnected();
		if (!lastTs) {
			this.logPollRepairNoop(timeframe, "no_history", now, key, {
				wsConnected,
			});
			return;
		}
		const expectedNext = lastTs + tfMs;
		const graceMs = this.pollGraceMs(tfMs);
		const beyondGrace = now > expectedNext + graceMs;
		if (wsConnected && !beyondGrace) {
			this.logPollRepairNoop(timeframe, "within_grace", now, key, {
				expectedNext,
				graceMs,
			});
			return;
		}
		if (wsConnected && this.isWsHealthy(key, now, tfMs)) {
			this.logPollRepairNoop(timeframe, "ws_healthy", now, key, {
				lastWsArrival: this.lastWsArrival.get(key) ?? null,
			});
			return;
		}
		const windowMs = Math.max(now - expectedNext, tfMs);
		const maxCandles = Math.min(
			MAX_REPAIR_CANDLES,
			Math.max(1, Math.ceil(windowMs / tfMs))
		);
		try {
			const candles = await this.options.fetchCandles(
				timeframe,
				maxCandles + GAP_FETCH_PADDING,
				expectedNext
			);
			const missing = candles
				.filter(
					(candle) =>
						candle.timestamp >= expectedNext && candle.timestamp > lastTs
				)
				.sort((a, b) => a.timestamp - b.timestamp)
				.map((candle) => this.normalizeCandle(candle, timeframe));
			if (!missing.length) {
				this.logPollRepairNoop(timeframe, "no_data", now, key, {
					expectedNext,
				});
				return;
			}
			for (const candle of missing) {
				await this.processCandle(
					timeframe,
					candle,
					Date.now(),
					"poll",
					true,
					true
				);
			}
			runtimeLogger.info("poll_repair_backfill", {
				venue: this.options.venue,
				symbol: this.canonicalSymbol,
				timeframe,
				candlesRepaired: missing.length,
				fromTimestamp: missing[0]?.timestamp,
				toTimestamp: missing[missing.length - 1]?.timestamp,
			});
		} catch (error) {
			runtimeLogger.warn("poll_repair_error", {
				venue: this.options.venue,
				symbol: this.canonicalSymbol,
				timeframe,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private isWsHealthy(key: string, now: number, tfMs: number): boolean {
		const lastArrival = this.lastWsArrival.get(key);
		if (!lastArrival) {
			return false;
		}
		const healthWindow = Math.max(tfMs * WS_HEALTH_FACTOR, MIN_WS_HEALTH_MS);
		return now - lastArrival <= healthWindow;
	}

	private pollGraceMs(tfMs: number): number {
		return Math.max(Math.floor(tfMs * POLL_GRACE_FACTOR), MIN_POLL_GRACE_MS);
	}

	private isWsConnected(): boolean {
		return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
	}

	private buildIdentityKey(timeframe: string): string {
		return `${this.canonicalSymbol}:${timeframe.toLowerCase()}`;
	}

	private identityKey(timeframe: string): string {
		let key = this.identityByTimeframe.get(timeframe);
		if (!key) {
			key = this.buildIdentityKey(timeframe);
			this.identityByTimeframe.set(timeframe, key);
		}
		return key;
	}

	private logPollRepairNoop(
		timeframe: string,
		reason: string,
		now: number,
		key: string,
		extra: Record<string, unknown> = {}
	): void {
		runtimeLogger.info("poll_repair_noop", {
			venue: this.options.venue,
			symbol: this.canonicalSymbol,
			timeframe,
			reason,
			now,
			lastTimestamp: this.lastEmitted.get(key) ?? null,
			wsConnected: this.isWsConnected(),
			...extra,
		});
	}
}
