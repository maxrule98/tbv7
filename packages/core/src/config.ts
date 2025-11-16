import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { BinanceExchangeConfig, RiskConfig, StrategyConfig } from "./types";
import { loadEnvFiles } from "./env";

const PROJECT_ROOT = resolveProjectRoot();
const CONFIG_ROOT = process.env.CONFIG_ROOT
	? path.resolve(process.env.CONFIG_ROOT)
	: path.join(PROJECT_ROOT, "config");

loadEnvFiles(PROJECT_ROOT);

function resolveProjectRoot(): string {
	if (process.env.PROJECT_ROOT) {
		return path.resolve(process.env.PROJECT_ROOT);
	}

	let current = process.cwd();
	const { root } = path.parse(current);

	while (!existsSync(path.join(current, "pnpm-workspace.yaml"))) {
		const parent = path.dirname(current);
		if (parent === current || current === root) {
			return process.cwd();
		}
		current = parent;
	}

	return current;
}

export async function loadJsonConfig<T>(relativePath: string): Promise<T> {
	const filePath = path.join(CONFIG_ROOT, relativePath);
	const raw = await fs.readFile(filePath, "utf8");
	const interpolated = raw.replace(
		/\$\{(\w+)\}/g,
		(_, key) => process.env[key] || ""
	);
	return JSON.parse(interpolated) as T;
}

export const Config = {
	async strategy(name: string): Promise<StrategyConfig> {
		return loadJsonConfig<StrategyConfig>(
			path.join("strategies", `${name}.json`)
		);
	},
	async risk(name = "default"): Promise<RiskConfig> {
		return loadJsonConfig<RiskConfig>(path.join("risk", `${name}.json`));
	},
	async exchange(name = "binance"): Promise<BinanceExchangeConfig> {
		return loadJsonConfig<BinanceExchangeConfig>(
			path.join("exchange", `${name}.json`)
		);
	},
};

export { CONFIG_ROOT, PROJECT_ROOT };
