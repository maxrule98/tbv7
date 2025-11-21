type LogLevel = "debug" | "info" | "warn" | "error";
export declare const log: (level: LogLevel, event: string, payload?: Record<string, unknown>, moduleName?: string) => void;
export declare const debug: (event: string, payload?: Record<string, unknown>, moduleName?: string) => void;
export declare const info: (event: string, payload?: Record<string, unknown>, moduleName?: string) => void;
export declare const warn: (event: string, payload?: Record<string, unknown>, moduleName?: string) => void;
export declare const error: (event: string, payload?: Record<string, unknown>, moduleName?: string) => void;
export interface ModuleLogger {
    log: (level: LogLevel, event: string, payload?: Record<string, unknown>) => void;
    debug: (event: string, payload?: Record<string, unknown>) => void;
    info: (event: string, payload?: Record<string, unknown>) => void;
    warn: (event: string, payload?: Record<string, unknown>) => void;
    error: (event: string, payload?: Record<string, unknown>) => void;
}
export declare const createLogger: (moduleName: string) => ModuleLogger;
export type { LogLevel };
