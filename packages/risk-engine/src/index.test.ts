import { describe, expect, it } from "vitest";
import { ActivePositionSide, PositionSide, TradeIntent } from "@agenai/core";
import { RiskManager, RiskConfig } from "./index";

type PositionState = {
	side: PositionSide;
	size: number;
};

const baseRiskConfig: RiskConfig = {
	riskPerTradePercent: 0.01,
	slPct: 1,
	tpPct: 2,
	minPositionSize: 0.001,
	maxPositionSize: 10,
	trailingActivationPct: 0.01,
	trailingTrailPct: 0.005,
};

const createManager = (): RiskManager => new RiskManager(baseRiskConfig);

const flatState: PositionState = { side: "FLAT", size: 0 };

const buildIntent = (intent: TradeIntent["intent"]): TradeIntent => ({
	symbol: "BTCUSDT",
	intent,
	reason: "test",
});

describe("RiskManager.plan", () => {
	it("builds an OPEN_LONG plan with buy side metadata", () => {
		const manager = createManager();
		const plan = manager.plan(buildIntent("OPEN_LONG"), 100, 10_000, flatState);
		expect(plan).not.toBeNull();
		expect(plan?.action).toBe("OPEN");
		expect(plan?.positionSide).toBe<ActivePositionSide>("LONG");
		expect(plan?.side).toBe("buy");
		expect(plan?.stopLossPrice).toBe(99);
		expect(plan?.takeProfitPrice).toBe(102);
		expect(plan?.quantity).toBeGreaterThan(0);
	});

	it("builds an OPEN_SHORT plan with sell side metadata", () => {
		const manager = createManager();
		const plan = manager.plan(
			buildIntent("OPEN_SHORT"),
			100,
			10_000,
			flatState
		);
		expect(plan).not.toBeNull();
		expect(plan?.action).toBe("OPEN");
		expect(plan?.positionSide).toBe<ActivePositionSide>("SHORT");
		expect(plan?.side).toBe("sell");
		expect(plan?.stopLossPrice).toBe(101);
		expect(plan?.takeProfitPrice).toBe(98);
		expect(plan?.quantity).toBeGreaterThan(0);
	});

	it("returns null when closing a long with no position", () => {
		const manager = createManager();
		const plan = manager.plan(
			buildIntent("CLOSE_LONG"),
			100,
			10_000,
			flatState
		);
		expect(plan).toBeNull();
	});

	it("creates CLOSE_LONG and CLOSE_SHORT plans that mirror exposure", () => {
		const manager = createManager();
		const longPlan = manager.plan(buildIntent("CLOSE_LONG"), 95, 10_000, {
			side: "LONG",
			size: 2,
		});
		const shortPlan = manager.plan(buildIntent("CLOSE_SHORT"), 105, 10_000, {
			side: "SHORT",
			size: 3,
		});
		expect(longPlan).not.toBeNull();
		expect(longPlan?.side).toBe("sell");
		expect(longPlan?.quantity).toBe(2);
		expect(longPlan?.action).toBe("CLOSE");
		expect(shortPlan).not.toBeNull();
		expect(shortPlan?.side).toBe("buy");
		expect(shortPlan?.quantity).toBe(3);
	});
});
