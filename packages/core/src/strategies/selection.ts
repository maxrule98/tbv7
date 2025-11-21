import { StrategyId, isStrategyId } from "./ids";

export interface StrategySelectionInput {
	requestedValue?: string;
	envValue?: string;
	defaultStrategyId: StrategyId;
}

export interface StrategySelectionResult {
	requestedValue?: string;
	envValue?: string;
	requestedId?: StrategyId | null;
	envId?: StrategyId | null;
	resolvedStrategyId: StrategyId;
	invalidSources: { source: "cli" | "env"; value: string }[];
}

export const normalizeStrategyInput = (value?: string): string | undefined => {
	if (!value) {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	return trimmed.toLowerCase();
};

const coerceStrategyId = (value?: string): StrategyId | null => {
	if (!value) {
		return null;
	}
	return isStrategyId(value) ? value : null;
};

export const resolveStrategySelection = (
	input: StrategySelectionInput
): StrategySelectionResult => {
	const requestedValue = normalizeStrategyInput(input.requestedValue);
	const envValue = normalizeStrategyInput(input.envValue);
	const invalidSources: { source: "cli" | "env"; value: string }[] = [];

	const requestedId = coerceStrategyId(requestedValue ?? undefined);
	if (requestedValue && !requestedId) {
		invalidSources.push({ source: "cli", value: requestedValue });
	}

	const envId = coerceStrategyId(envValue ?? undefined);
	if (envValue && !envId) {
		invalidSources.push({ source: "env", value: envValue });
	}

	const resolvedStrategyId = requestedId ?? envId ?? input.defaultStrategyId;

	return {
		requestedValue,
		envValue,
		requestedId,
		envId,
		resolvedStrategyId,
		invalidSources,
	};
};
