import {
	StrategyConfig,
	StrategyId,
	VWAPDeltaGammaConfig,
	createLogger,
	getStrategyDefinition,
	loadAgenaiConfig,
	resolveStrategySelection,
} from "@agenai/core";
import {
	StartTraderOptions,
	createVwapStrategyBuilder,
	startTrader,
} from "@agenai/trader-runtime";

const logger = createLogger("trader-cli");

const main = async (): Promise<void> => {
	const config = loadAgenaiConfig();
	const exchange = config.exchange;
	const defaultStrategyId = config.strategy.id as StrategyId;
	const argv = process.argv.slice(2);

	const selection = resolveStrategySelection({
		requestedValue: getStrategyArg(argv),
		envValue: process.env.TRADER_STRATEGY,
		defaultStrategyId,
	});

	selection.invalidSources.forEach(({ source, value }) =>
		logger.warn("cli_strategy_invalid", { source, value })
	);

	let strategyConfig = config.strategy as StrategyConfig;
	let vwapConfig: VWAPDeltaGammaConfig | null = null;
	if (selection.resolvedStrategyId === "vwap_delta_gamma") {
		const definition =
			getStrategyDefinition<VWAPDeltaGammaConfig>("vwap_delta_gamma");
		vwapConfig = definition.loadConfig();
	} else if (strategyConfig.id !== selection.resolvedStrategyId) {
		const definition = getStrategyDefinition<StrategyConfig>(
			selection.resolvedStrategyId
		);
		strategyConfig = definition.loadConfig() as StrategyConfig;
		config.strategy = strategyConfig;
	}

	const symbol =
		config.env.defaultSymbol || exchange.defaultSymbol || strategyConfig.symbol;
	const timeframe =
		selection.resolvedStrategyId === "vwap_delta_gamma"
			? vwapConfig!.timeframes.execution
			: config.env.defaultTimeframe || strategyConfig.timeframe;

	logger.info("cli_started", {
		defaultStrategyId,
		resolvedStrategyId: selection.resolvedStrategyId,
		symbol,
		timeframe,
	});
	logger.info("cli_strategy_selection", {
		requestedStrategy: selection.requestedValue ?? null,
		envStrategy: selection.envValue ?? null,
		defaultStrategyId,
		resolvedStrategyId: selection.resolvedStrategyId,
		isDefault: selection.resolvedStrategyId === defaultStrategyId,
		symbol,
		timeframe,
	});

	const traderOptions: StartTraderOptions = {
		agenaiConfig: config,
	};
	if (selection.resolvedStrategyId === "vwap_delta_gamma" && vwapConfig) {
		traderOptions.strategyBuilder = createVwapStrategyBuilder({
			symbol,
			config: vwapConfig,
		});
	}

	await startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: config.env.executionMode,
			strategyId: selection.resolvedStrategyId,
		},
		traderOptions
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
