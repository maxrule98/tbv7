import { StrategyId, createLogger, loadAgenaiConfig } from "@agenai/core";
import { createVwapStrategyBuilder, startTrader } from "@agenai/trader-runtime";

const logger = createLogger("trader-cli");

const SUPPORTED_STRATEGY_ID: StrategyId = "vwap_delta_gamma";

const main = async (): Promise<void> => {
	const config = loadAgenaiConfig();
	const exchange = config.exchange;
	const argv = process.argv.slice(2);

	const requestedStrategy =
		getStrategyArg(argv) ?? process.env.TRADER_STRATEGY ?? undefined;
	if (requestedStrategy && requestedStrategy !== SUPPORTED_STRATEGY_ID) {
		logger.warn("cli_strategy_override_ignored", {
			requestedStrategy,
			supportedStrategy: SUPPORTED_STRATEGY_ID,
		});
	}

	const strategyConfig = config.strategy;
	const symbol =
		config.env.defaultSymbol ||
		exchange.defaultSymbol ||
		strategyConfig.symbol ||
		"BTC/USDT";
	const timeframe =
		config.env.defaultTimeframe || strategyConfig.timeframes.execution;

	logger.info("cli_starting", {
		resolvedStrategyId: SUPPORTED_STRATEGY_ID,
		symbol,
		timeframe,
		requestedStrategy: requestedStrategy ?? null,
		useTestnet: exchange.testnet ?? false,
	});

	await startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: config.env.executionMode,
			strategyId: SUPPORTED_STRATEGY_ID,
		},
		{
			agenaiConfig: config,
			strategyBuilder: createVwapStrategyBuilder({
				symbol,
				config: strategyConfig,
			}),
		}
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
