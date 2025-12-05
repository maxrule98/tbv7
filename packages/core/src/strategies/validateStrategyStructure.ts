import fs from "node:fs";
import path from "node:path";
import { StrategyId } from "./ids";
import { StrategyRegistryEntry, listStrategyDefinitions } from "./registry";

const REQUIRED_FILES = [
	"config.ts",
	"entryLogic.ts",
	"exitLogic.ts",
	"index.ts",
	"metrics.ts",
];

export interface StrategyStructureCheck {
	id: StrategyId;
	folderName: string;
	directoryExists: boolean;
	missingFiles: string[];
	manifestMatchesId: boolean;
	ok: boolean;
}

export interface StrategyStructureSummary {
	ok: boolean;
	results: StrategyStructureCheck[];
}

export const validateStrategyStructure = (): StrategyStructureSummary => {
	const entries = listStrategyDefinitions();
	const results = entries.map(validateEntry);
	return {
		ok: results.every((result) => result.ok),
		results,
	};
};

const validateEntry = (
	entry: StrategyRegistryEntry
): StrategyStructureCheck => {
	const folderName = entry.id.replace(/_/g, "-");
	const strategyDir = path.join(__dirname, folderName);
	const directoryExists = fs.existsSync(strategyDir);
	const missingFiles = directoryExists
		? REQUIRED_FILES.filter(
				(file) => !fs.existsSync(path.join(strategyDir, file))
		  )
		: [...REQUIRED_FILES];
	const manifestMatchesId = entry.manifest.strategyId === entry.id;
	const ok = directoryExists && missingFiles.length === 0 && manifestMatchesId;
	return {
		id: entry.id,
		folderName,
		directoryExists,
		missingFiles,
		manifestMatchesId,
		ok,
	};
};

if (require.main === module) {
	const summary = validateStrategyStructure();
	if (!summary.ok) {
		summary.results.forEach((result) => {
			if (result.ok) {
				return;
			}
			console.error("strategy_structure_invalid", {
				id: result.id,
				folderName: result.folderName,
				directoryExists: result.directoryExists,
				missingFiles: result.missingFiles,
				manifestMatchesId: result.manifestMatchesId,
			});
		});
		process.exit(1);
	}
	console.log("strategy_structure_valid");
}
