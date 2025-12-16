import { describe, it, expect } from "vitest";
import { createRuntimeSnapshot } from "./runtimeSnapshot";
import type { LoadedRuntimeConfig } from "./loadRuntimeConfig";

const buildSnapshot = (nodeEnv: string) => {
	const originalEnv = process.env.NODE_ENV;
	process.env.NODE_ENV = nodeEnv;
	try {
		return createRuntimeSnapshot({
			requestedStrategyId: "ultra_aggressive_btc_usdt",
			strategyProfile: "ultra-aggressive-btc-usdt",
		});
	} finally {
		if (typeof originalEnv === "string") {
			process.env.NODE_ENV = originalEnv;
		} else {
			delete process.env.NODE_ENV;
		}
	}
};

describe("runtime fingerprints", () => {
	it("keeps strategy fingerprint stable across NODE_ENV", () => {
		const prodSnapshot = buildSnapshot("production");
		const testSnapshot = buildSnapshot("test");
		expect(prodSnapshot.strategyConfigFingerprint).toBe(
			testSnapshot.strategyConfigFingerprint
		);
	});

	it("keeps runtime context fingerprint stable when only execution mode changes", () => {
		const baseSnapshot = createRuntimeSnapshot({
			requestedStrategyId: "ultra_aggressive_btc_usdt",
			strategyProfile: "ultra-aggressive-btc-usdt",
		});
		const liveRuntimeConfig: LoadedRuntimeConfig = {
			...baseSnapshot.config,
			agenaiConfig: {
				...baseSnapshot.config.agenaiConfig,
				env: {
					...baseSnapshot.config.agenaiConfig.env,
					executionMode: "live",
				},
			},
		};
		const liveSnapshot = createRuntimeSnapshot({
			runtimeConfig: liveRuntimeConfig,
		});

		expect(baseSnapshot.strategyConfigFingerprint).toBe(
			liveSnapshot.strategyConfigFingerprint
		);
		expect(baseSnapshot.runtimeContextFingerprint).toBe(
			liveSnapshot.runtimeContextFingerprint
		);
	});
});
