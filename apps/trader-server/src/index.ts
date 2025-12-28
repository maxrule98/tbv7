import http from "http";
import { createLogger } from "@agenai/core";
import {
	createRuntimeSnapshot,
	loadRuntimeConfig,
	parseStrategyArg,
	startTrader,
} from "@agenai/runtime";
import {
	createExchangeAdapter,
	createExecutionProvider,
	createMarketDataProvider,
} from "@agenai/app-di";

const logger = createLogger("trader-server");

const main = async (): Promise<void> => {
	logger.info("server_start", {
		env: process.env.NODE_ENV ?? "development",
		pid: process.pid,
	});

	// Parse and validate --strategy (required)
	const argv = process.argv.slice(2);
	const strategyId = parseStrategyArg(argv);

	const runtimeBootstrap = loadRuntimeConfig({
		requestedStrategyId: strategyId,
		envStrategyId: process.env.TRADER_STRATEGY,
	});
	const runtimeSnapshot = createRuntimeSnapshot({
		runtimeConfig: runtimeBootstrap,
	});

	runtimeBootstrap.selection.invalidSources.forEach(({ source, value }) =>
		logger.warn("server_strategy_invalid", { source, value })
	);

	const runtimeParams = runtimeSnapshot.metadata.runtimeParams;
	const symbol = runtimeParams.symbol;
	const timeframe = runtimeParams.executionTimeframe;
	const exchange = runtimeBootstrap.agenaiConfig.exchange;
	const pollInterval = 10_000;

	const exchangeAdapter = createExchangeAdapter(runtimeSnapshot);
	const marketDataProvider = createMarketDataProvider(
		runtimeSnapshot,
		exchangeAdapter,
		pollInterval
	);
	const executionProvider = createExecutionProvider(
		runtimeSnapshot,
		exchangeAdapter
	);

	startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: runtimeBootstrap.agenaiConfig.env.executionMode,
			strategyId: runtimeBootstrap.strategyId,
		},
		{ runtimeSnapshot, marketDataProvider, executionProvider }
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

main().catch((error) => {
	logger.error("server_fatal", {
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	});
	process.exit(1);
});
