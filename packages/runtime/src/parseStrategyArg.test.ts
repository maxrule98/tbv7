import { describe, it, expect } from "vitest";
import { parseStrategyArg } from "./parseStrategyArg";

describe("parseStrategyArg", () => {
	it("parses --strategy=<id> format", () => {
		const result = parseStrategyArg([
			"--strategy=ultra_aggressive_btc_usdt",
			"--start",
			"2024-01-01",
		]);
		expect(result).toBe("ultra_aggressive_btc_usdt");
	});

	it("parses --strategy <id> format with space", () => {
		const result = parseStrategyArg([
			"--strategy",
			"vwap_delta_gamma",
			"--start",
			"2024-01-01",
		]);
		expect(result).toBe("vwap_delta_gamma");
	});

	it("accepts --strategyId alias with equals", () => {
		const result = parseStrategyArg([
			"--strategyId=ultra_aggressive_btc_usdt",
			"--other",
			"value",
		]);
		expect(result).toBe("ultra_aggressive_btc_usdt");
	});

	it("accepts --strategyId alias with space", () => {
		const result = parseStrategyArg([
			"--strategyId",
			"vwap_delta_gamma",
			"--other",
			"value",
		]);
		expect(result).toBe("vwap_delta_gamma");
	});

	it("normalizes strategy id to lowercase", () => {
		const result = parseStrategyArg(["--strategy=ULTRA_AGGRESSIVE_BTC_USDT"]);
		expect(result).toBe("ultra_aggressive_btc_usdt");
	});

	it("throws helpful error when flag is missing", () => {
		expect(() => parseStrategyArg(["--start", "2024-01-01"])).toThrow(
			/Missing required --strategy flag/
		);
		expect(() => parseStrategyArg(["--start", "2024-01-01"])).toThrow(
			/Available strategy ids/
		);
	});

	it("throws helpful error for invalid strategy id", () => {
		expect(() => parseStrategyArg(["--strategy=invalid_one"])).toThrow(
			/Invalid strategy id: "invalid_one"/
		);
		expect(() => parseStrategyArg(["--strategy=invalid_one"])).toThrow(
			/Available strategy ids/
		);
	});

	it("prefers --strategy over --strategyId when both present", () => {
		// First flag wins
		const result = parseStrategyArg([
			"--strategy=ultra_aggressive_btc_usdt",
			"--strategyId=vwap_delta_gamma",
		]);
		expect(result).toBe("ultra_aggressive_btc_usdt");
	});
});
