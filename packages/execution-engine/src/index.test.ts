import { describe, expect, it } from "vitest";
import type { TradePlan } from "@agenai/risk-engine";
import type { ExchangeAdapter } from "@agenai/core";
import { ExecutionEngine, PaperAccount } from "./index";

const dummyClient: ExchangeAdapter = {
	createMarketOrder: async () => ({
		id: "paper",
		symbol: "",
		type: "market",
		side: "buy",
		amount: 0,
	}),
	fetchOHLCV: async () => [],
	getBalanceUSDT: async () => 0,
	getPosition: async () => ({
		side: "FLAT",
		size: 0,
		entryPrice: null,
		unrealizedPnl: null,
	}),
};

const createEngine = (): ExecutionEngine =>
	new ExecutionEngine({
		client: dummyClient,
		mode: "paper",
		paperAccount: new PaperAccount(100_000),
	});

const buildPlan = (overrides: Partial<TradePlan>): TradePlan => ({
	symbol: "BTCUSDT",
	action: "OPEN",
	positionSide: "LONG",
	side: "buy",
	type: "market",
	quantity: 1,
	stopLossPrice: 99,
	takeProfitPrice: 101,
	reason: "test",
	...overrides,
});

describe("ExecutionEngine paper mode", () => {
	it("opens long positions and tracks trailing anchors", async () => {
		const engine = createEngine();
		const result = await engine.execute(buildPlan({}), { price: 100 });
		expect(result.status).toBe("paper_filled");
		const position = engine.getPosition("BTCUSDT");
		expect(position.side).toBe("LONG");
		expect(position.stopLossPrice).toBe(99);
		expect(position.takeProfitPrice).toBe(101);
		expect(position.peakPrice).toBe(100);
		expect(position.troughPrice).toBe(100);
	});

	it("closes long trades and realizes pnl", async () => {
		const engine = createEngine();
		await engine.execute(buildPlan({}), { price: 100 });
		const closePlan = buildPlan({
			action: "CLOSE",
			positionSide: "LONG",
			side: "sell",
			quantity: 1,
			stopLossPrice: 100,
			takeProfitPrice: 100,
			reason: "exit",
		});
		const result = await engine.execute(closePlan, { price: 110 });
		expect(result.status).toBe("paper_closed");
		expect(result.realizedPnl).toBeCloseTo(10);
		const position = engine.getPosition("BTCUSDT");
		expect(position.side).toBe("FLAT");
	});

	it("opens short positions using sell to open metadata", async () => {
		const engine = createEngine();
		const openShort = buildPlan({
			action: "OPEN",
			positionSide: "SHORT",
			side: "sell",
			stopLossPrice: 101,
			takeProfitPrice: 98,
		});
		await engine.execute(openShort, { price: 100 });
		const position = engine.getPosition("BTCUSDT");
		expect(position.side).toBe("SHORT");
		expect(position.stopLossPrice).toBe(101);
		expect(position.takeProfitPrice).toBe(98);
		expect(position.peakPrice).toBe(100);
		expect(position.troughPrice).toBe(100);
	});

	it("closes short trades and books gains when price drops", async () => {
		const engine = createEngine();
		const openShort = buildPlan({
			action: "OPEN",
			positionSide: "SHORT",
			side: "sell",
			quantity: 2,
			stopLossPrice: 101,
			takeProfitPrice: 98,
		});
		await engine.execute(openShort, { price: 100 });
		const closeShort = buildPlan({
			action: "CLOSE",
			positionSide: "SHORT",
			side: "buy",
			quantity: 2,
			stopLossPrice: 100,
			takeProfitPrice: 100,
			reason: "cover",
		});
		const result = await engine.execute(closeShort, { price: 90 });
		expect(result.status).toBe("paper_closed");
		expect(result.realizedPnl).toBeCloseTo(20);
		const position = engine.getPosition("BTCUSDT");
		expect(position.side).toBe("FLAT");
	});
});
