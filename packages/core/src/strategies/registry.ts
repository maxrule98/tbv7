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
const STRATEGY_SOURCE_DIR =
	process.env.AGENAI_STRATEGY_REGISTRY_DIR ?? __dirname;
const IGNORED_DIRECTORIES = new Set(["__tests__"]);
let tsRuntimeReady = false;

let registryEntriesCache: AnyStrategyEntry[] | null = null;
let registryMapCache: Map<StrategyId, AnyStrategyEntry> | null = null;

const registryProxyHandler: ProxyHandler<AnyStrategyEntry[]> = {
	get(_target, prop) {
		const entries = getRegistryEntries();
		const value = Reflect.get(entries, prop);
		return typeof value === "function" ? value.bind(entries) : value;
	},
	has(_target, prop) {
		return Reflect.has(getRegistryEntries(), prop);
	},
	ownKeys() {
		return Reflect.ownKeys(getRegistryEntries());
	},
	getOwnPropertyDescriptor(_target, prop) {
		const descriptor = Object.getOwnPropertyDescriptor(
			getRegistryEntries(),
			prop
		);
		if (descriptor) {
			descriptor.configurable = true;
		}
		return descriptor;
	},
	getPrototypeOf() {
		return Reflect.getPrototypeOf(getRegistryEntries());
	},
	set() {
		throw new Error("strategyRegistry is read-only.");
	},
	defineProperty() {
		throw new Error("strategyRegistry is read-only.");
	},
	deleteProperty() {
		throw new Error("strategyRegistry is read-only.");
	},
};

export const strategyRegistry: AnyStrategyEntry[] = new Proxy(
	[] as AnyStrategyEntry[],
	registryProxyHandler
);

export const getStrategyDefinition = <
	TConfig = unknown,
	TDeps = unknown,
	TStrategy = unknown,
>(
	id: StrategyId
): StrategyRegistryEntry<TConfig, TDeps, TStrategy> => {
	const definition = getRegistryMap().get(id);
	if (!definition) {
		throw new Error(`Unknown strategy id: ${id}`);
	}
	return definition as StrategyRegistryEntry<TConfig, TDeps, TStrategy>;
};

export const listStrategyDefinitions = (): AnyStrategyEntry[] => {
	return [...getRegistryEntries()];
};

export const getRegisteredStrategyIds = (): StrategyId[] => {
	return getRegistryEntries().map((entry) => entry.id);
};

export const isRegisteredStrategyId = (value: unknown): value is StrategyId => {
	return typeof value === "string" && getRegistryMap().has(value as StrategyId);
};

export const validateStrategyId = (value: string): StrategyId | null => {
	return isRegisteredStrategyId(value) ? (value as StrategyId) : null;
};

export function validateUniqueStrategyIds(
	entries: StrategyRegistryEntry[]
): void {
	const seen = new Set<StrategyId>();
	for (const entry of entries) {
		if (seen.has(entry.id)) {
			throw new Error(
				`Duplicate strategy id detected: ${entry.id}. Strategy ids must be unique.`
			);
		}
		seen.add(entry.id);
	}
}

export function loadStrategyEntriesFrom(sourceDir: string): AnyStrategyEntry[] {
	const dirents = fs.readdirSync(sourceDir, {
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
		const modulePath = resolveStrategyModulePath(sourceDir, dirent.name);
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

function resolveStrategyModulePath(
	sourceDir: string,
	dirName: string
): string | null {
	const basePath = path.join(sourceDir, dirName, "index");
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

function ensureRegistryLoaded(): void {
	if (registryEntriesCache && registryMapCache) {
		return;
	}
	const entries = loadStrategyEntriesFrom(STRATEGY_SOURCE_DIR);
	validateUniqueStrategyIds(entries);
	registryEntriesCache = entries;
	registryMapCache = new Map();
	for (const entry of entries) {
		registryMapCache.set(entry.id, entry);
	}
}

function getRegistryEntries(): AnyStrategyEntry[] {
	ensureRegistryLoaded();
	return registryEntriesCache!;
}

function getRegistryMap(): Map<StrategyId, AnyStrategyEntry> {
	ensureRegistryLoaded();
	return registryMapCache!;
}
