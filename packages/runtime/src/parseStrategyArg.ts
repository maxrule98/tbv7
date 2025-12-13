import type { StrategyId } from "@agenai/core";
import { getRegisteredStrategyIds, isRegisteredStrategyId } from "@agenai/core";

/**
 * Parse the --strategy (or --strategyId) CLI flag from process.argv.
 *
 * Canonical flag: --strategy=<id> or --strategy <id>
 * Aliases: --strategyId=<id> or --strategyId <id>
 *
 * Throws if:
 * - Flag is provided but value is invalid/unregistered
 * - No flag is provided at all
 *
 * @param argv - process.argv slice (typically process.argv.slice(2))
 * @returns The validated StrategyId
 * @throws Error if missing or invalid
 */
export const parseStrategyArg = (argv: string[]): StrategyId => {
	let value: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		// --strategy=<value>
		if (arg.startsWith("--strategy=")) {
			value = arg.split("=", 2)[1];
			break;
		}

		// --strategy <value>
		if (arg === "--strategy" && i + 1 < argv.length) {
			value = argv[i + 1];
			break;
		}

		// --strategyId=<value> (alias)
		if (arg.startsWith("--strategyId=")) {
			value = arg.split("=", 2)[1];
			break;
		}

		// --strategyId <value> (alias)
		if (arg === "--strategyId" && i + 1 < argv.length) {
			value = argv[i + 1];
			break;
		}

		// --strategyProfile is NOT an alias for strategy id, but we should detect it
		// and provide a helpful error if someone tries to use it that way
	}

	if (!value) {
		const availableIds = getRegisteredStrategyIds();
		throw new Error(
			`Missing required --strategy flag.\n\nUsage:\n  --strategy=<id>\n\nAvailable strategy ids:\n${availableIds.map((id) => `  - ${id}`).join("\n")}`
		);
	}

	// Normalize: trim and lowercase
	const normalized = value.trim().toLowerCase();

	if (!isRegisteredStrategyId(normalized)) {
		const availableIds = getRegisteredStrategyIds();
		throw new Error(
			`Invalid strategy id: "${value}"\n\nAvailable strategy ids:\n${availableIds.map((id) => `  - ${id}`).join("\n")}`
		);
	}

	return normalized as StrategyId;
};
