import { describe, expect, it, vi } from "vitest";
import type {
	AccountConfig,
	AgenaiConfig,
	StrategyConfig,
	StrategyId,
	StrategySelectionResult,
} from "@agenai/core";
import type {
	ExecutionResult,
	PaperAccountSnapshot,
	PaperPositionSnapshot,
} from "@agenai/execution-engine";
import { RiskManager } from "@agenai/risk-engine";
import type { TradePlan } from "@agenai/risk-engine";
import type {
	LoadedRuntimeConfig,
	RuntimeConfigResolutionTrace,
	RuntimeResolvedPathSummary,
	VenueSelection,
} from "./loadRuntimeConfig";
import { createRuntimeSnapshot } from "./runtimeSnapshot";
import {
	logStrategyRuntimeMetadata,
	logTimeframeFingerprint,
	runtimeLogger,
} from "./runtimeShared";
import type { StrategyRuntimeFingerprints } from "./fingerprints";
import { runTick } from "./loop/runTick";
import type { ExecutionProvider } from "./execution/executionProvider";
import type { TraderStrategy } from "./types";

const baseStrategyId = "ultra_aggressive_btc_usdt" as StrategyId;

const strategyConfig: StrategyConfig = {
	id: baseStrategyId,
	symbol: "BTC/USDT",
	timeframes: {
		execution: "1m",
		confirming: "5m",
	},
	trackedTimeframes: ["15m"],
	warmupPeriods: {
		default: 50,
		"1m": 120,
	},
	historyWindowCandles: 500,
};

const agenaiConfig: AgenaiConfig = {
	env: {
		exchangeId: "mexc",
		executionMode: "paper",
		mexcApiKey: "",
		mexcApiSecret: "",
		defaultSymbol: "BTC/USDT",
		defaultTimeframe: "1m",
	},
	exchange: {
		id: "mexc",
		exchange: "mexc",
		market: "futures",
		testnet: false,
		restEndpoint: "",
		wsEndpoint: "",
		defaultSymbol: "BTC/USDT",
		credentials: {
			apiKey: "",
			apiSecret: "",
		},
	},
	strategy: strategyConfig,
	risk: {
		maxLeverage: 1,
		riskPerTradePercent: 0.01,
		maxPositions: 1,
		slPct: 0.01,
		tpPct: 0.02,
		minPositionSize: 0.001,
		maxPositionSize: 10,
		trailingActivationPct: 0.01,
		trailingTrailPct: 0.005,
	},
};

const accountConfig: AccountConfig = {
	startingBalance: 1_000,
};

const selection: StrategySelectionResult = {
	requestedValue: undefined,
	envValue: undefined,
	requestedId: null,
	envId: null,
	resolvedStrategyId: baseStrategyId,
	invalidSources: [],
};

const createPathSummary = (
	absolute: string,
	relative = absolute
): RuntimeResolvedPathSummary => ({
	absolute,
	relativeToWorkspace: relative,
	relativeToCwd: relative,
});

const mockResolution: RuntimeConfigResolutionTrace = {
	cwd: "/workspace/apps/trader-server",
	workspaceRoot: "/workspace",
	envPath: createPathSummary("/workspace/.env", ".env"),
	configDir: createPathSummary("/workspace/config", "config"),
	strategyDir: createPathSummary("/workspace/config", "config"),
	accountConfigPath: createPathSummary(
		"/workspace/config/account/paper.json",
		"config/account/paper.json"
	),
	strategyConfigPath: createPathSummary(
		"/workspace/config/strategies/vwap.json",
		"config/strategies/vwap.json"
	),
	riskConfigPath: createPathSummary(
		"/workspace/config/risk/default.json",
		"config/risk/default.json"
	),
	exchangeConfigPath: createPathSummary(
		"/workspace/config/exchange/mexc.json",
		"config/exchange/mexc.json"
	),
};

const mockVenues: VenueSelection = {
	signalVenue: "mexc",
	executionVenue: "mexc",
	signalTimeframes: Array.from(
		new Set([
			strategyConfig.timeframes?.execution ?? "1m",
			strategyConfig.timeframes?.confirming ?? "5m",
			...(strategyConfig.trackedTimeframes ?? []),
		])
	),
	executionTimeframe: strategyConfig.timeframes?.execution ?? "1m",
};

const runtimeConfig: LoadedRuntimeConfig = {
	agenaiConfig,
	accountConfig,
	strategyConfig,
	strategyId: baseStrategyId,
	runtimeParams: {
		strategyId: baseStrategyId,
		symbol: "BTC/USDT",
		timeframes: strategyConfig.timeframes ?? { execution: "1m" },
		executionTimeframe: strategyConfig.timeframes?.execution ?? "1m",
	},
	selection,
	profiles: {},
	resolution: mockResolution,
	venues: mockVenues,
};

class StubExecutionProvider implements ExecutionProvider {
	readonly venue = "parity";
	readonly mode: "backtest" | "paper";
	private equity: number;
	private position: PaperPositionSnapshot;

	constructor(mode: "backtest" | "paper", startingEquity: number) {
		this.mode = mode;
		this.equity = startingEquity;
		this.position = this.createFlat();
	}

	private createFlat(): PaperPositionSnapshot {
		return {
			side: "FLAT",
			size: 0,
			entryPrice: 0,
			avgEntryPrice: null,
			realizedPnl: 0,
			trailingStopPrice: 0,
			isTrailingActive: false,
			stopLossPrice: undefined,
			takeProfitPrice: undefined,
			peakPrice: 0,
			troughPrice: 0,
		} satisfies PaperPositionSnapshot;
	}

	getPosition(_symbol: string): PaperPositionSnapshot {
		return this.position;
	}

	updatePosition(
		_symbol: string,
		updates: Partial<PaperPositionSnapshot>
	): void {
		this.position = { ...this.position, ...updates };
	}

	snapshotAccount(_unrealizedPnl: number): PaperAccountSnapshot | null {
		return {
			startingBalance: this.equity,
			balance: this.equity,
			equity: this.equity,
			totalRealizedPnl: 0,
			maxEquity: this.equity,
			maxDrawdown: 0,
			trades: {
				total: 0,
				wins: 0,
				losses: 0,
				breakeven: 0,
			},
		} satisfies PaperAccountSnapshot;
	}

	execute(
		plan: TradePlan,
		context: { price: number }
	): Promise<ExecutionResult> {
		this.position = {
			...this.position,
			side: plan.positionSide,
			size: plan.quantity,
			entryPrice: context.price,
			avgEntryPrice: context.price,
			stopLossPrice: plan.stopLossPrice,
			takeProfitPrice: plan.takeProfitPrice,
			trailingStopPrice: plan.stopLossPrice,
			isTrailingActive: false,
			peakPrice: context.price,
			troughPrice: context.price,
		} satisfies PaperPositionSnapshot;
		return Promise.resolve({
			symbol: plan.symbol,
			side: plan.side,
			status: "paper_filled",
			price: context.price,
			quantity: plan.quantity,
			mode: "paper",
			totalRealizedPnl: 0,
		});
	}
}

describe("runtime parity", () => {
	it("emits identical fingerprints across modes", () => {
		const snapshot = createRuntimeSnapshot({
			runtimeConfig,
			instrument: {
				symbol: "BTC/USDT",
				timeframe: "1m",
			},
		});
		const infoSpy = vi
			.spyOn(runtimeLogger, "info")
			.mockImplementation(() => {});

		const traderConfig = {
			symbol: snapshot.metadata.runtimeParams.symbol,
			timeframe: snapshot.metadata.runtimeParams.executionTimeframe,
			useTestnet: false,
		};
		const fingerprints: StrategyRuntimeFingerprints = {
			strategyConfigFingerprint: snapshot.strategyConfigFingerprint,
			runtimeContextFingerprint: snapshot.runtimeContextFingerprint,
		};

		logStrategyRuntimeMetadata({
			mode: "backtest",
			strategyId: snapshot.config.strategyId,
			strategyConfig: snapshot.config.strategyConfig,
			fingerprints,
			metadata: snapshot.metadata,
			source: "builder",
			builderName: "parity",
			profiles: snapshot.config.profiles,
			extra: {
				executionMode: "paper",
				traderConfig,
				pollIntervalMs: 0,
			},
		});

		logStrategyRuntimeMetadata({
			mode: "live",
			strategyId: snapshot.config.strategyId,
			strategyConfig: snapshot.config.strategyConfig,
			fingerprints,
			metadata: snapshot.metadata,
			source: "builder",
			builderName: "parity",
			profiles: snapshot.config.profiles,
			extra: {
				executionMode: "live",
				traderConfig,
				pollIntervalMs: 0,
			},
		});

		const metadataLogs = infoSpy.mock.calls.filter(
			([event]) => event === "strategy_runtime_metadata"
		) as Array<[string, Record<string, unknown>]>;
		expect(metadataLogs).toHaveLength(2);
		const firstMetadata = metadataLogs[0]!;
		const secondMetadata = metadataLogs[1]!;
		const [, firstMetadataPayload] = firstMetadata;
		const [, secondMetadataPayload] = secondMetadata;
		expect(firstMetadataPayload).toMatchObject({
			strategyConfigFingerprint:
				secondMetadataPayload.strategyConfigFingerprint,
			runtimeContextFingerprint:
				secondMetadataPayload.runtimeContextFingerprint,
		});

		const candles = [
			{
				symbol: "BTC/USDT",
				timeframe: "1m",
				timestamp: 1,
				open: 100,
				high: 101,
				low: 99,
				close: 100,
				volume: 1,
			},
			{
				symbol: "BTC/USDT",
				timeframe: "1m",
				timestamp: 2,
				open: 100,
				high: 102,
				low: 99,
				close: 101,
				volume: 2,
			},
		];

		logTimeframeFingerprint({
			mode: "backtest",
			label: "parity",
			symbol: traderConfig.symbol,
			timeframe: traderConfig.timeframe,
			candles,
		});
		logTimeframeFingerprint({
			mode: "live",
			label: "parity",
			symbol: traderConfig.symbol,
			timeframe: traderConfig.timeframe,
			candles,
		});

		const timeframeLogs = infoSpy.mock.calls.filter(
			([event]) => event === "timeframe_fingerprint"
		) as Array<[string, Record<string, unknown>]>;
		expect(timeframeLogs).toHaveLength(2);
		const firstTimeframe = timeframeLogs[0]!;
		const secondTimeframe = timeframeLogs[1]!;
		const [, firstTimeframePayload] = firstTimeframe;
		const [, secondTimeframePayload] = secondTimeframe;
		expect(firstTimeframePayload).toMatchObject({
			headHash: secondTimeframePayload.headHash,
			tailHash: secondTimeframePayload.tailHash,
		});

		infoSpy.mockRestore();
	});

	it("produces identical runTick intents across modes", async () => {
		const snapshot = createRuntimeSnapshot({
			runtimeConfig,
			instrument: {
				symbol: "BTC/USDT",
				timeframe: "1m",
			},
		});

		const strategy = {
			decide: vi.fn().mockResolvedValue({
				intent: "OPEN_LONG",
				reason: "parity_runTick",
				symbol: "BTC/USDT",
				timestamp: 2,
			}),
		} as unknown as TraderStrategy;

		const candles = [
			{
				symbol: "BTC/USDT",
				timeframe: "1m",
				timestamp: 1,
				open: 100,
				high: 101,
				low: 99,
				close: 100,
				volume: 1,
			},
			{
				symbol: "BTC/USDT",
				timeframe: "1m",
				timestamp: 2,
				open: 100,
				high: 102,
				low: 99,
				close: 101,
				volume: 2,
			},
		];

		const riskManager = new RiskManager(agenaiConfig.risk);
		const fingerprints: StrategyRuntimeFingerprints = {
			strategyConfigFingerprint: snapshot.strategyConfigFingerprint,
			runtimeContextFingerprint: snapshot.runtimeContextFingerprint,
		};
		const decisionContext = {
			signalVenue: mockVenues.signalVenue,
			executionVenue: mockVenues.executionVenue,
			timeframe: "1m",
			isClosed: true,
		};
		const baseInput = {
			candle: candles[1]!,
			buffer: candles,
			strategy,
			riskManager,
			riskConfig: agenaiConfig.risk,
			symbol: "BTC/USDT",
			accountEquityFallback: accountConfig.startingBalance ?? 1_000,
			decisionContext,
			fingerprints,
		};

		const backtestTick = await runTick({
			...baseInput,
			executionProvider: new StubExecutionProvider("backtest", 1_000),
		});
		const paperTick = await runTick({
			...baseInput,
			executionProvider: new StubExecutionProvider("paper", 1_000),
		});

		expect(backtestTick.intent.intent).toBe(paperTick.intent.intent);
		expect(backtestTick.skipReason ?? null).toBe(paperTick.skipReason ?? null);
		expect(backtestTick.plan?.action).toBe(paperTick.plan?.action);
	});
});
