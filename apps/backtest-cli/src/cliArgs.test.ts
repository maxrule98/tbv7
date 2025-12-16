import { describe, it, expect } from "vitest";
import { parseCliArgs } from "./cliArgs";

describe("backtest CLI arg parsing", () => {
	it("captures --strategy flag with space", () => {
		const args = parseCliArgs([
			"--strategy",
			"ultra_aggressive_btc_usdt",
			"--start",
			"2024-01-01T00:00:00Z",
			"--end",
			"2024-01-02T00:00:00Z",
		]);
		expect(args.strategy).toBe("ultra_aggressive_btc_usdt");
	});

	it("captures --strategy flag with equals syntax", () => {
		const args = parseCliArgs([
			"--strategy=ultra_aggressive_btc_usdt",
			"--start",
			"2024-01-01T00:00:00Z",
			"--end",
			"2024-01-02T00:00:00Z",
		]);
		expect(args.strategy).toBe("ultra_aggressive_btc_usdt");
	});

	it("records --strategyId alias for downstream parsing", () => {
		const args = parseCliArgs([
			"--strategyId",
			"vwap_delta_gamma",
			"--start",
			"2024-01-01T00:00:00Z",
			"--end",
			"2024-01-02T00:00:00Z",
		]);
		expect(args.strategyId).toBe("vwap_delta_gamma");
	});
});
