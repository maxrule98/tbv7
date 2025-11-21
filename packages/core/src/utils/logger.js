"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = exports.error = exports.warn = exports.info = exports.debug = exports.log = void 0;
const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
const normalizeLevel = (value) => {
    if (!value) {
        return "info";
    }
    const normalized = value.toLowerCase();
    if (normalized in LEVELS) {
        return normalized;
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
const shouldLog = (level, moduleName) => {
    if (LEVELS[level] < LEVELS[minLevel]) {
        return false;
    }
    if (moduleFilter && !moduleFilter.has(moduleName)) {
        return false;
    }
    return true;
};
const serialize = (payload) => {
    try {
        return JSON.stringify(payload);
    }
    catch (error) {
        return JSON.stringify({
            level: "error",
            event: "log_serialization_error",
            ts: new Date().toISOString(),
            module: "logger",
            message: error instanceof Error
                ? error.message
                : "Failed to serialize log payload",
        });
    }
};
const emit = (level, moduleName, event, payload) => {
    if (!shouldLog(level, moduleName)) {
        return;
    }
    const { level: _ignoredLevel, event: _ignoredEvent, module: _ignoredModule, ts: _ignoredTs, ...rest } = payload ?? {};
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
    }
    else {
        console.log(line);
    }
};
const log = (level, event, payload, moduleName = "core") => emit(level, moduleName, event, payload);
exports.log = log;
const debug = (event, payload, moduleName = "core") => emit("debug", moduleName, event, payload);
exports.debug = debug;
const info = (event, payload, moduleName = "core") => emit("info", moduleName, event, payload);
exports.info = info;
const warn = (event, payload, moduleName = "core") => emit("warn", moduleName, event, payload);
exports.warn = warn;
const error = (event, payload, moduleName = "core") => emit("error", moduleName, event, payload);
exports.error = error;
const createLogger = (moduleName) => ({
    log: (level, event, payload) => emit(level, moduleName, event, payload),
    debug: (event, payload) => emit("debug", moduleName, event, payload),
    info: (event, payload) => emit("info", moduleName, event, payload),
    warn: (event, payload) => emit("warn", moduleName, event, payload),
    error: (event, payload) => emit("error", moduleName, event, payload),
});
exports.createLogger = createLogger;
