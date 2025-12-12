import { StrategyId, createLogger } from "@agenai/core";
import {
	createRuntimeSnapshot,
	loadRuntimeConfig,
	startTrader,
} from "@agenai/runtime";

const logger = createLogger("trader-cli");

const main = async (): Promise<void> => {
	const argv = process.argv.slice(2);
	const runtimeBootstrap = loadRuntimeConfig({
		requestedStrategyId: getStrategyArg(argv),
		envStrategyId: process.env.TRADER_STRATEGY,
	});
	const runtimeSnapshot = createRuntimeSnapshot({
		runtimeConfig: runtimeBootstrap,
	});

	runtimeBootstrap.selection.invalidSources.forEach(({ source, value }) =>
		logger.warn("cli_strategy_invalid", { source, value })
	);

	const runtimeParams = runtimeSnapshot.metadata.runtimeParams;
	const symbol = runtimeParams.symbol;
	const timeframe = runtimeParams.executionTimeframe;
	const exchange = runtimeBootstrap.agenaiConfig.exchange;
	const resolvedStrategyId = runtimeBootstrap.strategyId as StrategyId;
	const defaultStrategyId = runtimeBootstrap.strategyConfig.id as StrategyId;

	logger.info("cli_starting", {
		defaultStrategyId,
		resolvedStrategyId,
		symbol,
		timeframe,
		requestedStrategy: runtimeBootstrap.selection.requestedValue ?? null,
		envStrategy: runtimeBootstrap.selection.envValue ?? null,
		useTestnet: exchange.testnet ?? false,
	});

	await startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: runtimeBootstrap.agenaiConfig.env.executionMode,
			strategyId: resolvedStrategyId,
		},
		{ runtimeSnapshot }
	);
};

const getStrategyArg = (argv: string[]): string | undefined => {
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg.startsWith("--strategy=")) {
			return arg.split("=")[1];
		}
		if (arg === "--strategy" && i + 1 < argv.length) {
			return argv[i + 1];
		}
	}
	return undefined;
};

main().catch((error) => {
	logger.error("cli_unhandled_error", {
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	});
	process.exit(1);
});
