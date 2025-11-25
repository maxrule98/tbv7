export const STRATEGY_IDS = ["vwap_delta_gamma"] as const;

export type StrategyId = (typeof STRATEGY_IDS)[number];

export const isStrategyId = (value: unknown): value is StrategyId => {
	return (
		typeof value === "string" &&
		(STRATEGY_IDS as readonly string[]).includes(value)
	);
};
