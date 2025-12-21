import fs from "node:fs";
import path from "node:path";
import { Candle, PositionSide, TradeIntent, createLogger } from "../../..";
import { getDefaultStrategyDir, resolveStrategyConfigPath } from "../../config";
import {
	MultiTimeframeCache,
	MultiTimeframeCacheOptions,
	createMTFCache,
} from "../../data/multiTimeframeCache";
import type { VWAPFullTraversalConfig, VWAPFullTraversalDeps } from "./config";
import { VWAP_FULL_TRAVERSAL_ID, DEFAULT_CONFIG } from "./config";
import { DeltaGammaProvider } from "./deltaProvider";
import {
	SessionVWAPCalculator,
	SessionVWAPState,
	hasTouchedLowerBand,
	hasTouchedUpperBand,
} from "./vwapIndicator";
import {
	type StrategyState,
	evaluateLongEntry,
	evaluateShortEntry,
	buildEntryIntent,
} from "./entryLogic";
import { type DeltaHistory, evaluateExit, buildExitIntent } from "./exitLogic";

const logger = createLogger("vwap-full-traversal");

export class VWAPFullTraversalStrategy {
	private vwapCalc: SessionVWAPCalculator;
	private deltaProvider: DeltaGammaProvider;
	private state: StrategyState;
	private deltaHistory: DeltaHistory = {
		current: null,
		previous: null,
	};
	private deltaAbsHistory: number[] = [];

	constructor(
		private readonly config: VWAPFullTraversalConfig,
		private readonly deps: VWAPFullTraversalDeps
	) {
		this.vwapCalc = new SessionVWAPCalculator(config.sdMultiplier);
		this.deltaProvider = new DeltaGammaProvider();
		this.state = {
			touchedUpper: false,
			touchedLower: false,
			lastSessionStart: 0,
		};
	}

	async decide(position: PositionSide = "FLAT"): Promise<TradeIntent> {
		const timeframe = this.config.timeframes.execution;
		const candles = await this.deps.cache.getCandles(timeframe);

		if (!candles.length) {
			return this.noAction("no_candles");
		}

		const latest = candles[candles.length - 1] as Candle;

		// Update VWAP state
		const vwapState = this.vwapCalc.update(latest);

		// Check for session reset
		if (vwapState.sessionStart !== this.state.lastSessionStart) {
			this.resetState(vwapState.sessionStart);
		}

		// Update touch flags
		this.updateTouchFlags(latest, vwapState);

		// Process candle for delta/gamma calculation
		// In production with live trades, use processTrade() instead
		this.deltaProvider.processCandle(latest);
		this.deltaProvider.closeBucket(latest.timestamp);

		// Get delta and gamma
		const delta = this.deltaProvider.getDelta(latest.timestamp);
		const gamma = this.deltaProvider.getGamma(latest.timestamp);

		if (delta === null || gamma === null) {
			return this.noAction("waiting_for_delta_data", latest, vwapState);
		}

		// Update delta history
		this.updateDeltaHistory(delta);

		// Track delta magnitude for optional entry gate
		this.updateDeltaAbsHistory(delta);

		// Handle position management
		if (position !== "FLAT") {
			return this.handlePosition(position, latest, vwapState, gamma);
		}

		// Evaluate entries
		return this.evaluateEntry(latest, vwapState, delta, gamma);
	}

	private handlePosition(
		position: PositionSide,
		candle: Candle,
		vwapState: SessionVWAPState,
		gamma: number
	): TradeIntent {
		const exitSignal = evaluateExit(
			position,
			candle,
			vwapState,
			this.deltaHistory,
			gamma
		);

		if (exitSignal && exitSignal.shouldExit) {
			const intent = buildExitIntent(candle, position, exitSignal);
			if (intent) {
				// Reset state on exit
				this.resetState(vwapState.sessionStart);
				this.logExit(intent, exitSignal);
				return intent;
			}
		}

		return {
			symbol: candle.symbol,
			intent: "NO_ACTION",
			reason: "manage_position",
			timestamp: candle.timestamp,
			metadata: {
				position,
				vwap: vwapState.vwap,
				delta: this.deltaHistory.current,
				gamma,
			},
		};
	}

	private evaluateEntry(
		candle: Candle,
		vwapState: SessionVWAPState,
		delta: number,
		gamma: number
	): TradeIntent {
		// Check delta magnitude gate first
		if (!this.checkDeltaMagnitudeGate(delta)) {
			return this.noAction("delta_magnitude_gate_failed", candle, vwapState);
		}

		// Try long entry
		const longSignal = evaluateLongEntry(
			candle,
			vwapState,
			delta,
			gamma,
			this.state
		);

		if (longSignal.canEnter) {
			const intent = buildEntryIntent(candle, longSignal);
			// Reset state on entry
			this.resetState(vwapState.sessionStart);
			this.logEntry(intent, longSignal);
			return intent;
		}

		// Try short entry
		const shortSignal = evaluateShortEntry(
			candle,
			vwapState,
			delta,
			gamma,
			this.state
		);

		if (shortSignal.canEnter) {
			const intent = buildEntryIntent(candle, shortSignal);
			// Reset state on entry
			this.resetState(vwapState.sessionStart);
			this.logEntry(intent, shortSignal);
			return intent;
		}

		// No entry, return diagnostic info
		return {
			symbol: candle.symbol,
			intent: "NO_ACTION",
			reason: longSignal.reason || shortSignal.reason,
			timestamp: candle.timestamp,
			metadata: {
				vwap: vwapState.vwap,
				upper: vwapState.upper,
				lower: vwapState.lower,
				delta,
				gamma,
				touchedUpper: this.state.touchedUpper,
				touchedLower: this.state.touchedLower,
			},
		};
	}

	private updateTouchFlags(candle: Candle, vwapState: SessionVWAPState): void {
		if (hasTouchedUpperBand(candle, vwapState.upper)) {
			this.state.touchedUpper = true;
		}
		if (hasTouchedLowerBand(candle, vwapState.lower)) {
			this.state.touchedLower = true;
		}
	}

	private updateDeltaHistory(currentDelta: number): void {
		this.deltaHistory.previous = this.deltaHistory.current;
		this.deltaHistory.current = currentDelta;
	}

	/**
	 * Track absolute delta values for magnitude gate
	 */
	private updateDeltaAbsHistory(delta: number): void {
		this.deltaAbsHistory.push(Math.abs(delta));
		// Maintain rolling window
		const period =
			this.config.deltaAbsSmaPeriod ?? DEFAULT_CONFIG.deltaAbsSmaPeriod!;
		if (this.deltaAbsHistory.length > period) {
			this.deltaAbsHistory.shift();
		}
	}

	/**
	 * Check if current delta passes magnitude gate
	 * Returns true if gate is disabled OR if delta magnitude exceeds threshold
	 */
	private checkDeltaMagnitudeGate(delta: number): boolean {
		// Gate disabled - always pass
		if (!this.config.enableDeltaMagnitudeGate) {
			return true;
		}

		const period =
			this.config.deltaAbsSmaPeriod ?? DEFAULT_CONFIG.deltaAbsSmaPeriod!;
		const multiplier =
			this.config.deltaAbsMultiplier ?? DEFAULT_CONFIG.deltaAbsMultiplier!;

		// Not enough history - pass by default
		if (this.deltaAbsHistory.length < period) {
			return true;
		}

		// Calculate SMA of absolute delta
		const sum = this.deltaAbsHistory.reduce((acc, val) => acc + val, 0);
		const sma = sum / this.deltaAbsHistory.length;

		// Check if current delta magnitude exceeds threshold
		const threshold = sma * multiplier;
		return Math.abs(delta) >= threshold;
	}

	private resetState(sessionStart: number): void {
		this.state = {
			touchedUpper: false,
			touchedLower: false,
			lastSessionStart: sessionStart,
		};
		this.deltaHistory = {
			current: null,
			previous: null,
		};
		this.deltaAbsHistory = [];
	}

	private noAction(
		reason: string,
		candle?: Candle,
		vwapState?: SessionVWAPState
	): TradeIntent {
		return {
			symbol: candle?.symbol ?? this.config.symbol,
			intent: "NO_ACTION",
			reason,
			timestamp: candle?.timestamp,
			metadata: vwapState
				? {
						vwap: vwapState.vwap,
						upper: vwapState.upper,
						lower: vwapState.lower,
					}
				: {},
		};
	}

	private logEntry(intent: TradeIntent, signal: any): void {
		logger.info("strategy_entry", {
			strategy: "vwap_full_traversal",
			symbol: intent.symbol,
			intent: intent.intent,
			reason: intent.reason,
			timestamp: new Date(intent.timestamp!).toISOString(),
			vwap: signal.vwap,
			sd: signal.sd,
			upper: signal.upper,
			lower: signal.lower,
			delta: signal.delta,
			gamma: signal.gamma,
			stop: signal.stop,
		});
	}

	private logExit(intent: TradeIntent, signal: any): void {
		logger.info("strategy_exit", {
			strategy: "vwap_full_traversal",
			symbol: intent.symbol,
			intent: intent.intent,
			exit_reason: intent.reason,
			timestamp: new Date(intent.timestamp!).toISOString(),
			vwap: signal.vwap,
			upper: signal.upper,
			lower: signal.lower,
			delta: signal.delta,
			gamma: signal.gamma,
		});
	}

	/**
	 * Process a trade for delta calculation
	 * This should be called from the trade stream
	 */
	processTrade(trade: {
		timestamp: number;
		price: number;
		size: number;
		side: "buy" | "sell";
	}): void {
		this.deltaProvider.processTrade(trade);
	}

	/**
	 * Mark a candle as closed for delta calculation
	 */
	closeCandle(timestamp: number): void {
		this.deltaProvider.closeBucket(timestamp);
		this.deltaProvider.cleanup();
	}
}

// Helper functions
export const createVWAPFullTraversalCache = (
	clientFetcher: MultiTimeframeCacheOptions["fetcher"],
	symbol: string,
	timeframes: string[],
	maxAgeMs: number
): MultiTimeframeCache =>
	createMTFCache({
		symbol,
		timeframes,
		maxAgeMs,
		fetcher: clientFetcher,
		limit: 500,
	});

export const loadVWAPFullTraversalConfig = (
	configPath = resolveStrategyConfigPath(
		getDefaultStrategyDir(),
		"vwap_full_traversal_delta_gamma_1m"
	)
): VWAPFullTraversalConfig => {
	const contents = fs.readFileSync(configPath, "utf-8");
	return JSON.parse(contents) as VWAPFullTraversalConfig;
};

// Registry entry for strategy discovery
export const vwapFullTraversalModule = {
	id: VWAP_FULL_TRAVERSAL_ID,
	manifest: {
		strategyId: VWAP_FULL_TRAVERSAL_ID,
		name: "VWAP Full Traversal Delta Gamma 1m",
	},
	defaultProfile: "default",

	loadConfig: loadVWAPFullTraversalConfig,

	createStrategy(
		config: VWAPFullTraversalConfig,
		deps: VWAPFullTraversalDeps
	): VWAPFullTraversalStrategy {
		return new VWAPFullTraversalStrategy(config, deps);
	},

	dependencies: {
		createCache: createVWAPFullTraversalCache,
		buildBacktestDeps(
			_config: VWAPFullTraversalConfig,
			options: { cache: MultiTimeframeCache }
		): VWAPFullTraversalDeps {
			const deltaProvider = new DeltaGammaProvider();
			return {
				cache: options.cache,
				deltaProvider,
			};
		},
	},
};

export default vwapFullTraversalModule;
