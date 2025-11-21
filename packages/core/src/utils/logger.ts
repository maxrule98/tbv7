type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const normalizeLevel = (value?: string): LogLevel => {
	if (!value) {
		return "info";
	}
	const normalized = value.toLowerCase();
	if (normalized in LEVELS) {
		return normalized as LogLevel;
	}
	return "info";
};

const moduleFilter = (() => {
	const raw = process.env.LOG_MODULE;
	if (!raw) {
		return null;
	}
	const entries = raw
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	return entries.length ? new Set(entries) : null;
})();

const minLevel = normalizeLevel(process.env.LOG_LEVEL);

const shouldLog = (level: LogLevel, moduleName: string): boolean => {
	if (LEVELS[level] < LEVELS[minLevel]) {
		return false;
	}
	if (moduleFilter && !moduleFilter.has(moduleName)) {
		return false;
	}
	return true;
};

const serialize = (payload: Record<string, unknown>): string => {
	try {
		return JSON.stringify(payload);
	} catch (error) {
		return JSON.stringify({
			level: "error",
			event: "log_serialization_error",
			ts: new Date().toISOString(),
			module: "logger",
			message:
				error instanceof Error
					? error.message
					: "Failed to serialize log payload",
		});
	}
};

const emit = (
	level: LogLevel,
	moduleName: string,
	event: string,
	payload?: Record<string, unknown>
): void => {
	if (!shouldLog(level, moduleName)) {
		return;
	}
	const {
		level: _ignoredLevel,
		event: _ignoredEvent,
		module: _ignoredModule,
		ts: _ignoredTs,
		...rest
	} = payload ?? {};
	const entry = {
		level,
		event,
		ts: new Date().toISOString(),
		module: moduleName,
		...rest,
	};
	const line = serialize(entry);
	if (level === "error" || level === "warn") {
		console.error(line);
	} else {
		console.log(line);
	}
};

export const log = (
	level: LogLevel,
	event: string,
	payload?: Record<string, unknown>,
	moduleName = "core"
): void => emit(level, moduleName, event, payload);

export const debug = (
	event: string,
	payload?: Record<string, unknown>,
	moduleName = "core"
): void => emit("debug", moduleName, event, payload);

export const info = (
	event: string,
	payload?: Record<string, unknown>,
	moduleName = "core"
): void => emit("info", moduleName, event, payload);

export const warn = (
	event: string,
	payload?: Record<string, unknown>,
	moduleName = "core"
): void => emit("warn", moduleName, event, payload);

export const error = (
	event: string,
	payload?: Record<string, unknown>,
	moduleName = "core"
): void => emit("error", moduleName, event, payload);

export interface ModuleLogger {
	log: (
		level: LogLevel,
		event: string,
		payload?: Record<string, unknown>
	) => void;
	debug: (event: string, payload?: Record<string, unknown>) => void;
	info: (event: string, payload?: Record<string, unknown>) => void;
	warn: (event: string, payload?: Record<string, unknown>) => void;
	error: (event: string, payload?: Record<string, unknown>) => void;
}

export const createLogger = (moduleName: string): ModuleLogger => ({
	log: (level, event, payload) => emit(level, moduleName, event, payload),
	debug: (event, payload) => emit("debug", moduleName, event, payload),
	info: (event, payload) => emit("info", moduleName, event, payload),
	warn: (event, payload) => emit("warn", moduleName, event, payload),
	error: (event, payload) => emit("error", moduleName, event, payload),
});

export type { LogLevel };
