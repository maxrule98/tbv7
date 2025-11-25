import http from "http";
import { StrategyId, createLogger, loadAgenaiConfig } from "@agenai/core";
import { createVwapStrategyBuilder, startTrader } from "@agenai/trader-runtime";

const logger = createLogger("trader-server");

const SUPPORTED_STRATEGY_ID: StrategyId = "vwap_delta_gamma";

const main = async (): Promise<void> => {
	console.info("Starting AgenAI Trader Server...");

	const config = loadAgenaiConfig();
	const exchange = config.exchange;
	const argv = process.argv.slice(2);
	const requestedStrategy =
		getStrategyArg(argv) ?? process.env.TRADER_STRATEGY ?? undefined;
	if (requestedStrategy && requestedStrategy !== SUPPORTED_STRATEGY_ID) {
		logger.warn("server_strategy_override_ignored", {
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

	startTrader(
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
	).catch((error) => {
		console.error("Trader runtime failed:", error);
		process.exit(1);
	});

	const port = Number(process.env.PORT) || 3000;
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok" }));
	});

	server.listen(port, () => {
		console.info(`HTTP health server listening on port ${port}`);
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
	console.error("Fatal error in trader-server:", error);
	process.exit(1);
});
