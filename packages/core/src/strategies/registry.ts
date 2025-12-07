import fs from "node:fs";
import path from "node:path";
import {
	MultiTimeframeCache,
	MultiTimeframeCacheOptions,
} from "../data/multiTimeframeCache";
import type { StrategyId } from "./types";

export type StrategyManifestSummary = {
	strategyId: StrategyId;
	name: string;
};

export interface StrategyRegistryEntry<
	TConfig = unknown,
	TDeps = unknown,
	TStrategy = unknown,
	TManifest extends StrategyManifestSummary = StrategyManifestSummary,
> {
	id: StrategyId;
	manifest: TManifest;
	defaultProfile: string;
	loadConfig: (configPath?: string) => TConfig;
	createStrategy: (config: TConfig, deps: TDeps) => TStrategy;
	dependencies?: StrategyDependencyMetadata<TConfig, TDeps>;
}

export interface StrategyDependencyMetadata<TConfig, TDeps> {
	createCache?: (
		fetcher: MultiTimeframeCacheOptions["fetcher"],
		symbol: string,
		timeframes: string[],
		maxAgeMs: number
	) => MultiTimeframeCache;
	warmup?: (config: TConfig, deps?: TDeps) => Promise<void> | void;
	buildBacktestDeps?: (
		config: TConfig,
		options: { cache: MultiTimeframeCache }
	) => TDeps;
}

type AnyStrategyEntry = StrategyRegistryEntry<any, any, any>;

const MODULE_EXTENSIONS = [".js", ".cjs", ".mjs", ".ts", ".tsx"];
const STRATEGY_SOURCE_DIR = __dirname;
const IGNORED_DIRECTORIES = new Set(["__tests__"]);
let tsRuntimeReady = false;

const registryEntries = discoverStrategyEntries();
const registryMap = new Map<StrategyId, AnyStrategyEntry>();

for (const entry of registryEntries) {
	if (registryMap.has(entry.id)) {
		throw new Error(
			`Duplicate strategy id detected: ${entry.id}. Strategy ids must be unique.`
		);
	}
	registryMap.set(entry.id, entry);
}

export const strategyRegistry: AnyStrategyEntry[] = registryEntries;

export const getStrategyDefinition = <
	TConfig = unknown,
	TDeps = unknown,
	TStrategy = unknown,
>(
	id: StrategyId
): StrategyRegistryEntry<TConfig, TDeps, TStrategy> => {
	const definition = registryMap.get(id);
	if (!definition) {
		throw new Error(`Unknown strategy id: ${id}`);
	}
	return definition as StrategyRegistryEntry<TConfig, TDeps, TStrategy>;
};

export const listStrategyDefinitions = (): AnyStrategyEntry[] => {
	return [...registryEntries];
};

export const getRegisteredStrategyIds = (): StrategyId[] => {
	return registryEntries.map((entry) => entry.id);
};

export const isRegisteredStrategyId = (value: unknown): value is StrategyId => {
	return typeof value === "string" && registryMap.has(value as StrategyId);
};

export const validateStrategyId = (value: string): StrategyId | null => {
	return isRegisteredStrategyId(value) ? (value as StrategyId) : null;
};

function discoverStrategyEntries(): AnyStrategyEntry[] {
	const dirents = fs.readdirSync(STRATEGY_SOURCE_DIR, {
		withFileTypes: true,
	});
	const entries: AnyStrategyEntry[] = [];

	for (const dirent of dirents) {
		if (!dirent.isDirectory()) {
			continue;
		}
		if (IGNORED_DIRECTORIES.has(dirent.name) || dirent.name.startsWith(".")) {
			continue;
		}
		const modulePath = resolveStrategyModulePath(dirent.name);
		if (!modulePath) {
			throw new Error(
				`Strategy directory ${dirent.name} is missing an index module. ` +
					`Expected one of: ${MODULE_EXTENSIONS.map(
						(ext) => `index${ext}`
					).join(", ")}.`
			);
		}
		const entry = loadStrategyModule(modulePath);
		if (!entry) {
			throw new Error(
				`Strategy module at ${modulePath} does not export a registry entry. ` +
					"Ensure it exports a default StrategyRegistryEntry."
			);
		}
		entries.push(entry);
	}

	entries.sort((a, b) => a.id.localeCompare(b.id));
	return entries;
}

function resolveStrategyModulePath(dirName: string): string | null {
	const basePath = path.join(STRATEGY_SOURCE_DIR, dirName, "index");
	for (const ext of MODULE_EXTENSIONS) {
		const candidate = `${basePath}${ext}`;
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function loadStrategyModule(modulePath: string): AnyStrategyEntry | null {
	ensureTsRuntimeSupport(modulePath);
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const requiredModule = require(modulePath) as Record<string, unknown>;
	const candidates: unknown[] = [];
	if (requiredModule.default) {
		candidates.push(requiredModule.default as unknown);
	}
	candidates.push(...Object.values(requiredModule));
	return candidates.find(isStrategyRegistryEntry) ?? null;
}

function ensureTsRuntimeSupport(modulePath: string): void {
	if (tsRuntimeReady) {
		return;
	}
	if (!modulePath.endsWith(".ts") && !modulePath.endsWith(".tsx")) {
		return;
	}
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const tsNode = require("ts-node");
		if (typeof tsNode.register === "function") {
			tsNode.register({ transpileOnly: true });
			tsRuntimeReady = true;
		}
	} catch (error) {
		throw new Error(
			`Attempted to load TypeScript strategy module at ${modulePath}, but ts-node is not available. ` +
				"Install ts-node (dev dependency) or build the workspace before running."
		);
	}
}

function isStrategyRegistryEntry(value: unknown): value is AnyStrategyEntry {
	if (!value || typeof value !== "object") {
		return false;
	}
	const entry = value as Partial<AnyStrategyEntry>;
	return (
		typeof entry.id === "string" &&
		typeof entry.createStrategy === "function" &&
		typeof entry.loadConfig === "function" &&
		typeof entry.manifest === "object" &&
		entry.manifest !== null
	);
}
