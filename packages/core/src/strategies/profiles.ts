import type { StrategyId } from "./types";
import { getStrategyDefinition } from "./registry";

export const resolveStrategyProfileName = (
	strategyId: StrategyId,
	overrideProfile?: string
): string => {
	if (overrideProfile) {
		return overrideProfile;
	}
	const definition = getStrategyDefinition(strategyId);
	if (!definition.defaultProfile) {
		throw new Error(
			`Strategy ${strategyId} does not define a default profile. Set override explicitly.`
		);
	}
	return definition.defaultProfile;
};
