import { describe, expect, it, vi } from "vitest";
import type { RuntimeSnapshot } from "@agenai/runtime";
import {
	createBacktestExecution,
	createDataProvider,
	createExchangeAdapter,
	createExecutionProvider,
	createMarketDataProvider,
} from "./index";

vi.mock("@agenai/exchange-mexc", () => ({
	MexcClient: class {
		fetchOHLCV = async () => [];
		createMarketOrder = async () => ({
			id: "paper",
			symbol: "",
			type: "market",
			side: "buy",
			amount: 0,
		});
		getBalanceUSDT = async () => 0;
		getPosition = async () => ({
			side: "FLAT",
			size: 0,
			entryPrice: null,
			unrealizedPnl: null,
		});
	},
}));

vi.mock("@agenai/exchange-binance", () => ({
	BinanceUsdMClient: class {
		fetchOHLCV = async () => [];
	},
}));

vi.mock("@agenai/data", () => ({
	DefaultDataProvider: class {
		client: unknown;
		constructor({ client }: { client: unknown }) {
			this.client = client;
		}
	},
}));

vi.mock("@agenai/runtime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@agenai/runtime")>();
	class MockPollingMarketDataProvider {
		venue: string;
		constructor(_client: unknown, { venue }: { venue: string }) {
			this.venue = venue;
		}
	}
	class MockBinanceUsdMMarketDataProvider {
		venue = "binance";
		constructor(_client: unknown) {}
	}
	class MockMexcExecutionProvider {
		venue = "mexc";
		mode: string;
		client: unknown;
		accountConfig: unknown;
		constructor({
			client,
			mode,
			accountConfig,
		}: {
			client: unknown;
			mode: string;
			accountConfig: unknown;
		}) {
			this.client = client;
			this.mode = mode;
			this.accountConfig = accountConfig;
		}
		getPosition = () => ({ side: "FLAT" });
		updatePosition = () => undefined;
		snapshotAccount = () => ({ balance: 0 });
		execute = () => ({ id: "paper" });
	}
	return {
		...actual,
		PollingMarketDataProvider: MockPollingMarketDataProvider,
		BinanceUsdMMarketDataProvider: MockBinanceUsdMMarketDataProvider,
		MexcExecutionProvider: MockMexcExecutionProvider,
	};
});

vi.mock("@agenai/execution-engine", () => ({
	PaperAccount: class {
		startingBalance: number;
		constructor(startingBalance: number) {
			this.startingBalance = startingBalance;
		}
	},
	ExecutionEngine: class {
		getPosition = () => ({ side: "FLAT" });
		updatePosition = () => undefined;
		snapshotPaperAccount = () => ({ balance: 0 });
		execute = () => ({ id: "paper" });
	},
}));

vi.mock("@agenai/risk-engine", () => ({
	RiskManager: class {
		constructor(_config: unknown) {}
	},
}));

const makeSnapshot = (venue = "mexc"): RuntimeSnapshot =>
	({
		config: {
			sessionId: "test",
			agenaiConfig: {
				exchange: {
					id: venue,
					exchange: venue,
					credentials: { apiKey: "", apiSecret: "" },
					market: "futures",
				},
				env: { executionMode: "paper" },
				risk: {},
			},
			accountConfig: { startingBalance: 1_000 },
			venues: {
				signalVenue: venue,
				executionVenue: venue,
				signalTimeframes: ["1m"],
				executionTimeframe: "1m",
			},
			profiles: {},
			selection: { invalidSources: [] },
			runtimeParams: {
				symbol: "BTC/USDT",
				executionTimeframe: "1m",
				pollIntervalMs: 1_000,
			},
			strategyConfig: { id: "test" },
			strategyId: "test",
		},
		metadata: {
			runtimeParams: {
				symbol: "BTC/USDT",
				executionTimeframe: "1m",
				pollIntervalMs: 1_000,
			},
			strategyConfigFingerprint: "x",
			runtimeContextFingerprint: "y",
			selection: {},
		},
		strategyConfigFingerprint: "x",
		runtimeContextFingerprint: "y",
	}) as unknown as RuntimeSnapshot;

const isFunction = (fn: unknown): fn is (...args: any[]) => any =>
	typeof fn === "function";

describe("app-di factories", () => {
	it("creates live exchange, market data, and execution providers for mexc", () => {
		const snapshot = makeSnapshot("mexc");
		const adapter = createExchangeAdapter(snapshot);
		expect(isFunction(adapter.fetchOHLCV)).toBe(true);
		const md = createMarketDataProvider(snapshot, adapter, 1_000);
		expect((md as { venue?: string }).venue).toBe("mexc");
		const exec = createExecutionProvider(snapshot, adapter);
		expect(exec.getPosition("BTC/USDT").side).toBe("FLAT");
	});

	it("creates live market data provider for binance", () => {
		const snapshot = makeSnapshot("binance");
		const adapter = createExchangeAdapter(snapshot);
		const md = createMarketDataProvider(snapshot, adapter, 1_000);
		expect((md as { venue?: string }).venue).toBe("binance");
	});

	it("creates backtest adapter, data provider, and execution provider", () => {
		const snapshot = makeSnapshot();
		const adapter = createExchangeAdapter(snapshot);
		expect(isFunction(adapter.fetchOHLCV)).toBe(true);
		const dataProvider = createDataProvider(adapter);
		expect(dataProvider).toBeDefined();
		const executionProvider = createBacktestExecution(snapshot, adapter);
		expect(executionProvider.getPosition("BTC/USDT").side).toBe("FLAT");
	});
});
