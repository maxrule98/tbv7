import { StrategyId, createLogger } from "@agenai/core";
import {
	createRuntimeSnapshot,
	loadRuntimeConfig,
	startTrader,
} from "@agenai/runtime";
import {
	createExchangeAdapter,
	createExecutionProvider,
	createMarketDataProvider,
} from "@agenai/app-di";

const logger = createLogger("trader-cli");

const main = async (): Promise<void> => {
	const argv = process.argv.slice(2);
	const args = parseCliArgs(argv);
	const runtimeBootstrap = loadRuntimeConfig({
		requestedStrategyId: getStringArg(args, "strategy"),
		envStrategyId: process.env.TRADER_STRATEGY,
		signalVenue: getStringArg(args, "signalVenue"),
		executionVenue: getStringArg(args, "executionVenue"),
		signalTimeframes: getListArg(args, "signalTimeframes"),
		executionTimeframe: getStringArg(args, "executionTimeframe"),
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
		signalVenue: runtimeBootstrap.venues.signalVenue,
		executionVenue: runtimeBootstrap.venues.executionVenue,
		signalTimeframes: runtimeBootstrap.venues.signalTimeframes,
		executionTimeframe: runtimeBootstrap.venues.executionTimeframe,
	});

	const exchangeAdapter = createExchangeAdapter(runtimeSnapshot);
	const marketDataProvider = createMarketDataProvider(
		runtimeSnapshot,
		exchangeAdapter,
		10_000
	);
	const executionProvider = createExecutionProvider(
		runtimeSnapshot,
		exchangeAdapter
	);

	await startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: runtimeBootstrap.agenaiConfig.env.executionMode,
			strategyId: resolvedStrategyId,
		},
		{ runtimeSnapshot, marketDataProvider, executionProvider }
	);
};

type ArgValue = string | boolean;

const parseCliArgs = (argv: string[]): Record<string, ArgValue> => {
	const args: Record<string, ArgValue> = {};
	const positionals: string[] = [];
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) {
			positionals.push(token);
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
	if (positionals[0] && args.start === undefined) {
		args.start = positionals[0];
	}
	if (positionals[1] && args.end === undefined) {
		args.end = positionals[1];
	}
	return args;
};

const getStringArg = (
	args: Record<string, ArgValue>,
	key: string
): string | undefined => {
	const value = args[key];
	return typeof value === "string" && value.length ? value : undefined;
};

const getListArg = (
	args: Record<string, ArgValue>,
	key: string
): string[] | undefined => {
	const raw = getStringArg(args, key);
	if (!raw) {
		return undefined;
	}
	const frames = raw
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	return frames.length ? frames : undefined;
};

main().catch((error) => {
	logger.error("cli_unhandled_error", {
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	});
	process.exit(1);
});
