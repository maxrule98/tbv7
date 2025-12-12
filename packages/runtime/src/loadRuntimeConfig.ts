import {
	AccountConfig,
	AgenaiConfig,
	ConfigLoadOptions,
	StrategyConfig,
	StrategyId,
	StrategyRuntimeParams,
	StrategySelectionResult,
	assertStrategyRuntimeParams,
	getStrategyDefinition,
	loadAccountConfig,
	loadAgenaiConfig,
	resolveStrategySelection,
} from "@agenai/core";

export interface RuntimeProfileMetadata {
	account?: string;
	strategy?: string;
	risk?: string;
	exchange?: string;
}

export interface LoadRuntimeConfigOptions extends ConfigLoadOptions {
	accountProfile?: string;
	requestedStrategyId?: string;
	envStrategyId?: string;
	agenaiConfig?: AgenaiConfig;
	accountConfig?: AccountConfig;
}

export interface LoadedRuntimeConfig {
	agenaiConfig: AgenaiConfig;
	accountConfig: AccountConfig;
	strategyConfig: StrategyConfig;
	strategyId: StrategyId;
	runtimeParams: StrategyRuntimeParams;
	selection: StrategySelectionResult;
	profiles: RuntimeProfileMetadata;
}

export const loadRuntimeConfig = (
	options: LoadRuntimeConfigOptions = {}
): LoadedRuntimeConfig => {
	const agenaiConfig =
		options.agenaiConfig ??
		loadAgenaiConfig({
			envPath: options.envPath,
			configDir: options.configDir,
			strategyDir: options.strategyDir,
			exchangeProfile: options.exchangeProfile,
			strategyProfile: options.strategyProfile,
			riskProfile: options.riskProfile,
		});

	const accountProfile = options.accountProfile ?? "paper";
	const accountConfig =
		options.accountConfig ??
		loadAccountConfig(options.configDir, accountProfile);

	const selection = resolveStrategySelection({
		requestedValue: options.requestedStrategyId,
		envValue: options.envStrategyId ?? process.env.TRADER_STRATEGY,
		defaultStrategyId: agenaiConfig.strategy.id as StrategyId,
	});

	let strategyConfig = agenaiConfig.strategy as StrategyConfig;
	if (selection.resolvedStrategyId !== strategyConfig.id) {
		const definition = getStrategyDefinition<StrategyConfig>(
			selection.resolvedStrategyId
		);
		strategyConfig = definition.loadConfig();
		agenaiConfig.strategy = strategyConfig;
	}

	const runtimeParams = assertStrategyRuntimeParams(strategyConfig);

	return {
		agenaiConfig,
		accountConfig,
		strategyConfig,
		strategyId: selection.resolvedStrategyId,
		runtimeParams,
		selection,
		profiles: {
			account: accountProfile,
			strategy: options.strategyProfile,
			risk: options.riskProfile,
			exchange: options.exchangeProfile,
		},
	};
};
