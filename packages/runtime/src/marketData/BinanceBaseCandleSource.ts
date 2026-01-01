import WebSocket from "ws";
import { Candle } from "@agenai/core";
import { runtimeLogger } from "../runtimeShared";
import { normalizeSymbolForVenue, toCanonicalSymbol } from "../symbols";
import type { BaseCandleSource } from "./types";

const STREAM_ENDPOINT = "wss://fstream.binance.com/stream";

/**
 * Phase F: BaseCandleSource implementation for Binance
 *
 * Emits ONLY base timeframe candles via WebSocket.
 * NO aggregation, NO gap repair, NO CandleStore usage.
 * MarketDataPlant handles all orchestration.
 */
export class BinanceBaseCandleSource implements BaseCandleSource {
	readonly venue = "binance";

	private ws: WebSocket | null = null;
	private running = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private onCandleCallback:
		| ((
				candle: Candle,
				meta: { receivedAt: number; source: "ws" | "poll" | "rest" }
		  ) => void)
		| null = null;
	private canonicalSymbol = "";
	private wsSymbol = "";
	private timeframe = "";

	async start(args: {
		symbol: string;
		timeframe: string;
		onCandle: (
			candle: Candle,
			meta: { receivedAt: number; source: "ws" | "poll" | "rest" }
		) => void;
	}): Promise<void> {
		if (this.running) {
			throw new Error("BinanceBaseCandleSource already running");
		}

		this.canonicalSymbol = toCanonicalSymbol(args.symbol);
		this.wsSymbol = normalizeSymbolForVenue("binance", args.symbol)
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "");
		this.timeframe = args.timeframe;
		this.onCandleCallback = args.onCandle;
		this.running = true;

		this.connect();
	}

	async stop(): Promise<void> {
		if (!this.running) {
			return;
		}

		this.running = false;
		this.cleanupWs();

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.onCandleCallback = null;
	}

	private connect(): void {
		if (!this.running) {
			return;
		}

		const stream = `${this.wsSymbol}@kline_${this.timeframe}`;
		const url = `${STREAM_ENDPOINT}?streams=${stream}`;

		this.ws = new WebSocket(url);

		this.ws.on("open", () => {
			runtimeLogger.info("binance_source_connected", {
				venue: this.venue,
				symbol: this.canonicalSymbol,
				timeframe: this.timeframe,
			});
		});

		this.ws.on("message", (payload) => {
			void this.handleMessage(payload.toString());
		});

		this.ws.on("close", () => {
			runtimeLogger.warn("binance_source_disconnected", {
				venue: this.venue,
				symbol: this.canonicalSymbol,
				timeframe: this.timeframe,
			});
			this.scheduleReconnect();
		});

		this.ws.on("error", (error) => {
			runtimeLogger.error("binance_source_error", {
				venue: this.venue,
				message: error instanceof Error ? error.message : String(error),
			});
		});
	}

	private scheduleReconnect(): void {
		if (!this.running || this.reconnectTimer) {
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
			} catch {
				// ignore termination errors
			}
			this.ws = null;
		}
	}

	private async handleMessage(raw: string): Promise<void> {
		if (!this.running || !this.onCandleCallback) {
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

			const kline = payload.data?.k as Record<string, unknown> | undefined;

			// Only emit closed candles
			if (!kline || kline.x !== true) {
				return;
			}

			const candle: Candle = {
				symbol: this.canonicalSymbol,
				timeframe: this.timeframe,
				timestamp: Number(kline.t ?? 0),
				open: Number(kline.o ?? 0),
				high: Number(kline.h ?? 0),
				low: Number(kline.l ?? 0),
				close: Number(kline.c ?? 0),
				volume: Number(kline.v ?? 0),
			};

			const receivedAt = Date.now();

			// Emit to Plant
			this.onCandleCallback(candle, {
				receivedAt,
				source: "ws",
			});
		} catch (error) {
			runtimeLogger.error("binance_source_parse_error", {
				venue: this.venue,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
