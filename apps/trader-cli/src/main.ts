import {
	Candle,
	MultiTimeframeCache,
	PositionSide,
	TradeIntent,
	VWAPDeltaGammaStrategy,
	createVWAPDeltaGammaCache,
	loadAgenaiConfig,
	loadVWAPDeltaGammaConfig,
} from "@agenai/core";
import {
	StartTraderOptions,
	TraderStrategy,
	startTrader,
} from "@agenai/trader-runtime";

const main = async (): Promise<void> => {
	const config = loadAgenaiConfig();
	const exchange = config.exchange;
	const strategyChoice = getStrategyArg(process.argv.slice(2));
	const useVwapStrategy = strategyChoice?.toLowerCase() === "vwapdeltagamma";
	const vwapConfig = useVwapStrategy ? loadVWAPDeltaGammaConfig() : null;

	const symbol =
		config.env.defaultSymbol ||
		exchange.defaultSymbol ||
		config.strategy.symbol;
	const timeframe = useVwapStrategy
		? vwapConfig!.timeframes.execution
		: config.env.defaultTimeframe || config.strategy.timeframe;

	console.info("AgenAI Trader CLI started");
	console.info(
		JSON.stringify({
			event: "cli_strategy_selection",
			requestedStrategy: strategyChoice ?? "default",
			usingVWAPDeltaGamma: useVwapStrategy,
			defaultStrategyId: config.strategy.id,
			symbol,
			timeframe,
		})
	);

	const traderOptions: StartTraderOptions = { agenaiConfig: config };
	if (useVwapStrategy && vwapConfig) {
		const uniqueTimeframes = Array.from(
			new Set([
				vwapConfig.timeframes.execution,
				vwapConfig.timeframes.trend,
				vwapConfig.timeframes.bias,
				vwapConfig.timeframes.macro,
			])
		);
		traderOptions.strategyBuilder = async (client) => {
			const cache = createVWAPDeltaGammaCache(
				(symbolArg, timeframeArg, limit) =>
					client.fetchOHLCV(symbolArg, timeframeArg, limit),
				symbol,
				uniqueTimeframes,
				vwapConfig.cacheTTLms
			);
			await cache.refreshAll();
			const strategy = new VWAPDeltaGammaStrategy(vwapConfig, { cache });
			console.info(
				JSON.stringify({
					event: "vwap_strategy_initialized",
					symbol,
					cacheTimeframes: uniqueTimeframes,
					cacheTtlMs: vwapConfig.cacheTTLms,
					strategyClass: strategy.constructor.name,
				})
			);
			return new VwapStrategyAdapter(strategy, cache);
		};
	}

	await startTrader(
		{
			symbol,
			timeframe,
			useTestnet: exchange.testnet ?? false,
			executionMode: config.env.executionMode,
		},
		traderOptions
	);
};

class VwapStrategyAdapter implements TraderStrategy {
	constructor(
		private readonly strategy: VWAPDeltaGammaStrategy,
		private readonly cache: MultiTimeframeCache
	) {}

	async decide(
		_candles: Candle[],
		position: PositionSide
	): Promise<TradeIntent> {
		await this.cache.refreshAll();
		return this.strategy.decide(position);
	}
}

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
	console.error("Trader CLI failed:", error);
	process.exit(1);
});
