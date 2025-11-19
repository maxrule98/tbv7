import { loadAgenaiConfig } from "@agenai/core";
import { startTrader } from "@agenai/trader-runtime";

const main = async (): Promise<void> => {
	const config = loadAgenaiConfig();
	const exchange = config.exchange;

	const symbol =
		config.env.defaultSymbol ||
		exchange.defaultSymbol ||
		config.strategy.symbol;
	const timeframe = config.env.defaultTimeframe || config.strategy.timeframe;

	console.info("AgenAI Trader CLI started");

	await startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: config.env.executionMode,
		},
		{ agenaiConfig: config }
	);
};

main().catch((error) => {
	console.error("Trader CLI failed:", error);
	process.exit(1);
});
