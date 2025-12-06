import { describe, expect, it } from "vitest";
import { resolveStrategyProfileName } from "./profiles";

describe("resolveStrategyProfileName", () => {
	it("returns the override when provided", () => {
		const custom = resolveStrategyProfileName(
			"vwap_delta_gamma",
			"custom-profile"
		);
		expect(custom).toBe("custom-profile");
	});

	it("falls back to the registry default profile", () => {
		const resolved = resolveStrategyProfileName("ultra_aggressive_btc_usdt");
		expect(resolved).toBe("ultra-aggressive-btc-usdt");
	});
});
