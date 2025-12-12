import http from "http";
import { createLogger } from "@agenai/core";
import {
	createRuntimeSnapshot,
	loadRuntimeConfig,
	startTrader,
} from "@agenai/runtime";

const logger = createLogger("trader-server");

const main = async (): Promise<void> => {
	logger.info("server_start", {
		env: process.env.NODE_ENV ?? "development",
		pid: process.pid,
	});

	const argv = process.argv.slice(2);
	const runtimeBootstrap = loadRuntimeConfig({
		requestedStrategyId: getStrategyArg(argv),
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

	startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: runtimeBootstrap.agenaiConfig.env.executionMode,
			strategyId: runtimeBootstrap.strategyId,
		},
		{ runtimeSnapshot }
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
