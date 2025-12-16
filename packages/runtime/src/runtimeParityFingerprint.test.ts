import { describe, it, expect } from "vitest";
import { createRuntimeSnapshot } from "./runtimeSnapshot";
import type { LoadedRuntimeConfig } from "./loadRuntimeConfig";

describe("runtime parity fingerprints", () => {
	it("emits identical fingerprints across execution modes", () => {
		const paperSnapshot = createRuntimeSnapshot({
			requestedStrategyId: "ultra_aggressive_btc_usdt",
			strategyProfile: "ultra-aggressive-btc-usdt",
		});
		const altRuntimeConfig: LoadedRuntimeConfig = {
			...paperSnapshot.config,
			agenaiConfig: {
				...paperSnapshot.config.agenaiConfig,
				env: {
					...paperSnapshot.config.agenaiConfig.env,
					executionMode:
						paperSnapshot.config.agenaiConfig.env.executionMode === "paper"
							? "backtest"
							: "paper",
				},
			},
		};
		const backtestSnapshot = createRuntimeSnapshot({
			runtimeConfig: altRuntimeConfig,
		});

		expect(paperSnapshot.strategyConfigFingerprint).toBe(
			backtestSnapshot.strategyConfigFingerprint
		);
		expect(paperSnapshot.runtimeContextFingerprint).toBe(
			backtestSnapshot.runtimeContextFingerprint
		);
	});

	it("changes runtime context fingerprint when risk config changes", () => {
		const baseSnapshot = createRuntimeSnapshot({
			requestedStrategyId: "ultra_aggressive_btc_usdt",
			strategyProfile: "ultra-aggressive-btc-usdt",
		});
		const modifiedConfig: LoadedRuntimeConfig = {
			...baseSnapshot.config,
			agenaiConfig: {
				...baseSnapshot.config.agenaiConfig,
				risk: {
					...baseSnapshot.config.agenaiConfig.risk,
					riskPerTradePercent:
						(baseSnapshot.config.agenaiConfig.risk.riskPerTradePercent ??
							0.01) + 0.001,
				},
			},
		};
		const modifiedSnapshot = createRuntimeSnapshot({
			runtimeConfig: modifiedConfig,
		});

		expect(baseSnapshot.runtimeContextFingerprint).not.toBe(
			modifiedSnapshot.runtimeContextFingerprint
		);
	});
});
