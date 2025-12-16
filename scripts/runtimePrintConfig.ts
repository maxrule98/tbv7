#!/usr/bin/env ts-node
import process from "node:process";
import { createRuntimeSnapshot, parseStrategyArg } from "@agenai/runtime";
import type { LoadRuntimeConfigOptions } from "@agenai/runtime";

const USAGE = `Usage:
  pnpm runtime:print-config -- --strategy=<id> [options]

Options:
  --strategy <id>          Strategy id (required)
  --strategyProfile <id>   Strategy profile file name
  --riskProfile <id>       Risk profile name
  --accountProfile <id>    Account profile name
  --exchangeProfile <id>   Exchange profile name
  --envPath <path>        Custom .env path
  --configDir <path>      Custom config directory
  --strategyDir <path>    Custom strategies directory
  --symbol <symbol>       Override runtime symbol
  --timeframe <tf>        Override runtime timeframe
  --help                  Show this message`;

type ArgValue = string | boolean;

const parseCliArgs = (argv: string[]): Record<string, ArgValue> => {
	const args: Record<string, ArgValue> = {};
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token || token === "--") {
			continue;
		}
		if (!token.startsWith("--")) {
			continue;
		}
		const eqIdx = token.indexOf("=");
		if (eqIdx !== -1) {
			const key = token.slice(2, eqIdx);
			const value = token.slice(eqIdx + 1);
			args[key] = value;
			continue;
		}
		const key = token.slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith("--")) {
			args[key] = next;
			i += 1;
		} else {
			args[key] = true;
		}
	}
	return args;
};

const printCanonicalSection = (label: string, payload: string): void => {
	console.log(`\n# ${label}`);
	console.log(payload);
};

const main = async (): Promise<void> => {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.length === 0) {
		console.log(USAGE);
		return;
	}

	const strategyId = parseStrategyArg(argv);
	const argMap = parseCliArgs(argv);

	const snapshot = createRuntimeSnapshot({
		requestedStrategyId: strategyId,
		envPath: argMap.envPath as string | undefined,
		configDir: argMap.configDir as string | undefined,
		strategyDir: argMap.strategyDir as string | undefined,
		strategyProfile: argMap.strategyProfile as string | undefined,
		riskProfile: argMap.riskProfile as string | undefined,
		accountProfile: argMap.accountProfile as string | undefined,
		exchangeProfile: argMap.exchangeProfile as string | undefined,
		instrument: {
			symbol: argMap.symbol as string | undefined,
			timeframe: argMap.timeframe as string | undefined,
		},
	});

	const cache = snapshot.fingerprintCache;
	const summary = {
		strategyId: snapshot.config.strategyId,
		profiles: snapshot.config.profiles,
		fingerprints: {
			strategyConfig: snapshot.strategyConfigFingerprint,
			runtimeContext: snapshot.runtimeContextFingerprint,
			riskConfig: snapshot.riskConfigFingerprint,
		},
		strategyConfig: {
			path: cache.strategy.path ?? null,
			source: cache.strategy.source,
			profile: cache.strategy.profile ?? null,
			fileHash: cache.strategy.fileHash ?? null,
			fingerprint: cache.strategy.fingerprint,
			byteLength: cache.strategy.byteLength,
			canonicalKeys: cache.strategy.keys,
		},
		riskConfig: {
			path: cache.risk.path ?? null,
			source: cache.risk.source,
			profile: cache.risk.profile ?? null,
			fileHash: cache.risk.fileHash ?? null,
			fingerprint: cache.risk.fingerprint,
			byteLength: cache.risk.byteLength,
			canonicalKeys: cache.risk.keys,
		},
		runtimeContext: {
			fingerprint: cache.runtimeContext.fingerprint,
			byteLength: cache.runtimeContext.byteLength,
			canonicalKeys: cache.runtimeContext.keys,
		},
	};

	console.log(JSON.stringify(summary, null, 2));
	printCanonicalSection(
		"canonicalStrategyConfig",
		cache.strategy.canonicalJson
	);
	printCanonicalSection("canonicalRiskConfig", cache.risk.canonicalJson);
	printCanonicalSection(
		"canonicalRuntimeContext",
		cache.runtimeContext.canonicalJson
	);
};

main().catch((error) => {
	console.error(
		"runtime:print-config failed:",
		error instanceof Error ? error.message : error
	);
	process.exitCode = 1;
});
