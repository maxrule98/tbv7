import {
	StrategyConfig,
	StrategyId,
	assertStrategyRuntimeParams,
	createLogger,
	getStrategyDefinition,
	loadAgenaiConfig,
	resolveStrategySelection,
} from "@agenai/core";
import { startTrader } from "@agenai/trader-runtime";

const logger = createLogger("trader-cli");

const main = async (): Promise<void> => {
	const config = loadAgenaiConfig();
	const exchange = config.exchange;
	const argv = process.argv.slice(2);
	const defaultStrategyId = config.strategy.id as StrategyId;

	const selection = resolveStrategySelection({
		requestedValue: getStrategyArg(argv),
		envValue: process.env.TRADER_STRATEGY,
		defaultStrategyId,
	});

	selection.invalidSources.forEach(({ source, value }) =>
		logger.warn("cli_strategy_invalid", { source, value })
	);

	let strategyConfig = config.strategy as StrategyConfig;
	if (selection.resolvedStrategyId !== strategyConfig.id) {
		const definition = getStrategyDefinition<StrategyConfig>(
			selection.resolvedStrategyId
		);
		strategyConfig = definition.loadConfig();
		config.strategy = strategyConfig;
	}
	const runtimeParams = assertStrategyRuntimeParams(strategyConfig);
	const symbol = runtimeParams.symbol;
	const timeframe = runtimeParams.executionTimeframe;

	logger.info("cli_starting", {
		defaultStrategyId,
		resolvedStrategyId: selection.resolvedStrategyId,
		symbol,
		timeframe,
		requestedStrategy: selection.requestedValue ?? null,
		envStrategy: selection.envValue ?? null,
		useTestnet: exchange.testnet ?? false,
	});

	await startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: config.env.executionMode,
			strategyId: selection.resolvedStrategyId,
		},
		{ agenaiConfig: config }
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
