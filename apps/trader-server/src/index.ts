import http from "http";
import {
	StrategyConfig,
	StrategyId,
	createLogger,
	getStrategyDefinition,
	loadAgenaiConfig,
	resolveStrategySelection,
} from "@agenai/core";
import { startTrader } from "@agenai/trader-runtime";

const logger = createLogger("trader-server");

const main = async (): Promise<void> => {
	logger.info("server_start", {
		env: process.env.NODE_ENV ?? "development",
		pid: process.pid,
	});

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
		logger.warn("server_strategy_invalid", { source, value })
	);

	let strategyConfig = config.strategy as StrategyConfig;
	if (selection.resolvedStrategyId !== strategyConfig.id) {
		const definition = getStrategyDefinition<StrategyConfig>(
			selection.resolvedStrategyId
		);
		strategyConfig = definition.loadConfig();
		config.strategy = strategyConfig;
	}
	const symbol =
		config.env.defaultSymbol ||
		exchange.defaultSymbol ||
		strategyConfig.symbol ||
		"BTC/USDT";
	const timeframe =
		config.env.defaultTimeframe || strategyConfig.timeframes.execution;

	startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: config.env.executionMode,
			strategyId: selection.resolvedStrategyId,
		},
		{ agenaiConfig: config }
	).catch((error) => {
		logger.error("runtime_failed", {
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		process.exit(1);
	});

	const port = Number(process.env.PORT) || 3000;
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok" }));
	});

	server.listen(port, () => {
		logger.info("health_server_listening", { port });
	});
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
	logger.error("server_fatal", {
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	});
	process.exit(1);
});
