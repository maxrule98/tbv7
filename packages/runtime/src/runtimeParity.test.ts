import { describe, expect, it, vi } from "vitest";
import type {
	AccountConfig,
	AgenaiConfig,
	StrategyConfig,
	StrategyId,
	StrategySelectionResult,
} from "@agenai/core";
import type {
	LoadedRuntimeConfig,
	RuntimeConfigResolutionTrace,
	RuntimeResolvedPathSummary,
} from "./loadRuntimeConfig";
import { createRuntimeSnapshot } from "./runtimeSnapshot";
import {
	logStrategyRuntimeMetadata,
	logTimeframeFingerprint,
	runtimeLogger,
} from "./runtimeShared";
import type { StrategyRuntimeFingerprints } from "./fingerprints";

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
};

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
});
