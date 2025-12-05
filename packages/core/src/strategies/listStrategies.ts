import { listStrategyDefinitions } from "./registry";

interface CliOptions {
	json: boolean;
}

const parseArgs = (): CliOptions => {
	const args = new Set(process.argv.slice(2));
	return {
		json: args.has("--json"),
	};
};

const formatTable = (rows: { id: string; name: string }[]): string => {
	if (!rows.length) {
		return "(no strategies registered)";
	}
	const idWidth = Math.max(
		"Strategy ID".length,
		...rows.map((row) => row.id.length)
	);
	const nameWidth = Math.max(
		"Name".length,
		...rows.map((row) => row.name.length)
	);
	const header = `${pad("Strategy ID", idWidth)} | ${pad("Name", nameWidth)}`;
	const divider = `${"-".repeat(idWidth)}-+-${"-".repeat(nameWidth)}`;
	const body = rows
		.map((row) => `${pad(row.id, idWidth)} | ${pad(row.name, nameWidth)}`)
		.join("\n");
	return `${header}\n${divider}\n${body}`;
};

const pad = (value: string, width: number): string => {
	return value.padEnd(width, " ");
};

const main = (): void => {
	const options = parseArgs();
	const definitions = listStrategyDefinitions();
	const summary = definitions.map((entry) => ({
		id: entry.id,
		name: entry.manifest.name,
	}));

	if (options.json) {
		console.log(JSON.stringify(summary, null, 2));
		return;
	}

	console.log("Registered strategies:\n");
	console.log(formatTable(summary));
	console.log("\nUse --json to export machine-readable output.");
};

main();
