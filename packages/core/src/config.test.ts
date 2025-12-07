import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadStrategyConfig } from "./config";

const FIXTURE_DIR = path.join(__dirname, "__tests__", "fixtures");

describe("loadStrategyConfig", () => {
	it("throws when the config file omits an id", () => {
		expect(() => loadStrategyConfig(FIXTURE_DIR, "missing-id")).toThrowError(
			/must include an "id"/i
		);
	});

	it("throws when the config file references an unknown strategy id", () => {
		expect(() => loadStrategyConfig(FIXTURE_DIR, "unknown-id")).toThrowError(
			/Unknown strategy id/i
		);
	});
});
