export type LogLevel = "debug" | "info" | "warn" | "error";

export interface BaseLogPayload {
	level: LogLevel;
	event: string;
	module: string;
	ts?: string;
	[key: string]: unknown;
}

type Nullable<T> = T | null | undefined;

const NODE_ENV = process.env.NODE_ENV;
const LOG_PRETTY = process.env.LOG_PRETTY === "true";
const LOG_JSON = process.env.LOG_JSON === "true";

const prettyEnabled = LOG_PRETTY || NODE_ENV === "development";
const jsonEnabled = LOG_JSON || !prettyEnabled;

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

export function log(payload: BaseLogPayload): void {
	if (!shouldLog(payload.level, payload.module)) {
		return;
	}
	const ts = payload.ts ?? new Date().toISOString();
	const base: BaseLogPayload = { ts, ...payload };

	if (prettyEnabled) {
		try {
			printPretty(base);
		} catch (error) {
			console.warn(
				`[logger] pretty-print failed: ${
					error instanceof Error ? error.message : "unknown"
				}`
			);
		}
	}

	if (jsonEnabled) {
		try {
			const json = JSON.stringify(sanitize(base));
			console.log(json);
		} catch (err) {
			console.log(
				JSON.stringify({
					ts,
					level: "error",
					event: "logging_error",
					module: "logger",
					error: err instanceof Error ? err.message : "serialization_failed",
				})
			);
		}
	}
}

export function debug(
	event: string,
	moduleName: string,
	data: Record<string, unknown> = {}
): void {
	log({ level: "debug", event, module: moduleName, ...data });
}

export function info(
	event: string,
	moduleName: string,
	data: Record<string, unknown> = {}
): void {
	log({ level: "info", event, module: moduleName, ...data });
}

export function warn(
	event: string,
	moduleName: string,
	data: Record<string, unknown> = {}
): void {
	log({ level: "warn", event, module: moduleName, ...data });
}

export function error(
	event: string,
	moduleName: string,
	data: Record<string, unknown> = {}
): void {
	log({ level: "error", event, module: moduleName, ...data });
}

export interface ModuleLogger {
	log: (level: LogLevel, event: string, data?: Record<string, unknown>) => void;
	debug: (event: string, data?: Record<string, unknown>) => void;
	info: (event: string, data?: Record<string, unknown>) => void;
	warn: (event: string, data?: Record<string, unknown>) => void;
	error: (event: string, data?: Record<string, unknown>) => void;
}

export const createLogger = (moduleName: string): ModuleLogger => ({
	log: (level, event, data) =>
		log({ level, event, module: moduleName, ...(data ?? {}) }),
	debug: (event, data) =>
		log({ level: "debug", event, module: moduleName, ...(data ?? {}) }),
	info: (event, data) =>
		log({ level: "info", event, module: moduleName, ...(data ?? {}) }),
	warn: (event, data) =>
		log({ level: "warn", event, module: moduleName, ...(data ?? {}) }),
	error: (event, data) =>
		log({ level: "error", event, module: moduleName, ...(data ?? {}) }),
});

const sanitize = (payload: BaseLogPayload): BaseLogPayload => {
	const seen = new WeakSet<object>();
	return sanitizeValue(payload, seen) as BaseLogPayload;
};

const sanitizeValue = (value: unknown, seen: WeakSet<object>): unknown => {
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (typeof value === "function") {
		return "[function]";
	}
	if (value instanceof Error) {
		return { name: value.name, message: value.message, stack: value.stack };
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) {
			return "[circular]";
		}
		seen.add(value);
		const arr = value.map((item) => sanitizeValue(item, seen));
		seen.delete(value);
		return arr;
	}
	if (value && typeof value === "object") {
		if (seen.has(value)) {
			return "[circular]";
		}
		seen.add(value);
		const clone: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(
			value as Record<string, unknown>
		)) {
			clone[key] = sanitizeValue(nested, seen);
		}
		seen.delete(value);
		return clone;
	}
	return value;
};

function printPretty(base: BaseLogPayload): void {
	const { level, event, module, ts, ...rest } = base;
	console.log(`[${ts}] [${level.toUpperCase()}] ${module}:${event}`);
	const termWidth =
		typeof process.stdout?.columns === "number" ? process.stdout.columns : 120;
	const isNarrow = termWidth < 120;

	try {
		switch (event) {
			case "strategy_context": {
				printStrategyContext(rest, isNarrow);
				break;
			}
			case "strategy_decision": {
				printStrategyDecision(rest);
				break;
			}
			case "trade_plan": {
				printTradePlan(rest);
				break;
			}
			case "paper_account_snapshot": {
				printPaperAccountSnapshot(rest);
				break;
			}
			default:
				break;
		}
	} catch (error) {
		console.warn(
			`[logger] pretty render error: ${
				error instanceof Error ? error.message : "unknown"
			}`
		);
	}
}

const printStrategyContext = (
	rest: Record<string, unknown>,
	isNarrow: boolean
): void => {
	const {
		symbol,
		timeframe,
		price,
		vwap,
		bias,
		regime,
		macdForecast,
		setups,
		exits,
		setupChecks,
	} = rest as StrategyContextPrettyPayload;

	const summaryRow = {
		symbol,
		timeframe,
		price,
		vwapDaily: vwap?.daily,
		vwap50: vwap?.rolling50,
		vwap200: vwap?.rolling200,
		trend: bias?.trend,
		macro: bias?.macro,
		regime: regime?.trend,
		volRegime: regime?.volatility,
		macdForecast,
		trendLong: setups?.trendLong,
		trendShort: setups?.trendShort,
		meanRevLong: setups?.meanRevLong,
		meanRevShort: setups?.meanRevShort,
		breakoutLong: setups?.breakoutLong,
		breakoutShort: setups?.breakoutShort,
		exitLong: exits?.long,
		exitShort: exits?.short,
	};

	if (!isNarrow) {
		console.table([summaryRow]);
	} else {
		const fmtNumber = (value: unknown): string =>
			typeof value === "number" ? value.toFixed(2) : "n/a";
		const fmtValue = (value: unknown): string =>
			value === undefined || value === null ? "-" : String(value);
		console.log("Strategy summary (compact):");
		console.log(
			[
				`${fmtValue(summaryRow.symbol)} ${fmtValue(summaryRow.timeframe)}`,
				`price=${fmtValue(summaryRow.price)}`,
				`vwap=${fmtNumber(summaryRow.vwapDaily)}`,
				`trend=${fmtValue(summaryRow.trend)}/${fmtValue(summaryRow.macro)}`,
				`regime=${fmtValue(summaryRow.regime)}`,
				`macd=${fmtNumber(summaryRow.macdForecast)}`,
				`setups: TL=${fmtValue(summaryRow.trendLong)} TS=${fmtValue(
					summaryRow.trendShort
				)} MR=${fmtValue(summaryRow.meanRevLong)}/${fmtValue(
					summaryRow.meanRevShort
				)} BR=${fmtValue(summaryRow.breakoutLong)}/${fmtValue(
					summaryRow.breakoutShort
				)}`,
			].join(" | ")
		);
	}

	const tl = setupChecks?.trendLong ?? {};
	const ts = setupChecks?.trendShort ?? {};
	const allKeys = Array.from(
		new Set([...Object.keys(tl), ...Object.keys(ts)])
	).sort();
	const rows = allKeys.map((key) => ({
		condition: key,
		long: (tl as Record<string, unknown>)[key],
		short: (ts as Record<string, unknown>)[key],
	}));
	if (rows.length > 0) {
		console.log("Trend conditions (long vs short):");
		if (!isNarrow) {
			console.table(rows);
		} else {
			const fmt = (value: unknown): string => {
				if (value === true) {
					return "✔";
				}
				if (value === false) {
					return "✘";
				}
				return value === undefined || value === null ? "-" : String(value);
			};
			for (const row of rows) {
				const label = String(row.condition ?? "");
				console.log(
					`${label.padEnd(22)}  L=${fmt(row.long)}  S=${fmt(row.short)}`
				);
			}
		}
	}
};

const printStrategyDecision = (rest: Record<string, unknown>): void => {
	const { symbol, timeframe, timestamp, intent, reason, close } =
		rest as StrategyDecisionPrettyPayload;
	console.table([
		{
			symbol,
			timeframe,
			timestamp,
			close,
			intent,
			reason,
		},
	]);
};

const printTradePlan = (rest: Record<string, unknown>): void => {
	const { symbol, side, intent, quantity, stopLossPrice, takeProfitPrice } =
		rest as TradePlanPrettyPayload;
	console.table([
		{
			symbol,
			side,
			intent,
			quantity,
			stopLoss: stopLossPrice,
			takeProfit: takeProfitPrice,
		},
	]);
};

const printPaperAccountSnapshot = (rest: Record<string, unknown>): void => {
	const { snapshot } = rest as PaperAccountSnapshotPrettyPayload;
	if (!snapshot) {
		return;
	}
	const {
		startingBalance,
		balance,
		equity,
		totalRealizedPnl,
		maxEquity,
		maxDrawdown,
		trades,
	} = snapshot;
	console.table([
		{
			startingBalance,
			balance,
			equity,
			totalRealizedPnl,
			maxEquity,
			maxDrawdown,
			tradesTotal: trades?.total,
			tradesWins: trades?.wins,
			tradesLosses: trades?.losses,
			tradesBreakeven: trades?.breakeven,
		},
	]);
};

interface StrategyContextPrettyPayload {
	symbol?: string;
	timeframe?: string;
	price?: number;
	vwap?: {
		daily?: Nullable<number>;
		rolling50?: Nullable<number>;
		rolling200?: Nullable<number>;
	};
	bias?: {
		trend?: Nullable<string>;
		macro?: Nullable<string>;
	};
	regime?: {
		trend?: Nullable<string>;
		volatility?: Nullable<string>;
	};
	macdForecast?: Nullable<number>;
	setups?: {
		trendLong?: Nullable<string | boolean | number>;
		trendShort?: Nullable<string | boolean | number>;
		meanRevLong?: Nullable<string | boolean | number>;
		meanRevShort?: Nullable<string | boolean | number>;
		breakoutLong?: Nullable<string | boolean | number>;
		breakoutShort?: Nullable<string | boolean | number>;
	};
	exits?: {
		long?: Nullable<string>;
		short?: Nullable<string>;
	};
	setupChecks?: {
		trendLong?: Record<string, unknown>;
		trendShort?: Record<string, unknown>;
	};
}

interface StrategyDecisionPrettyPayload {
	symbol?: string;
	timeframe?: string;
	timestamp?: string;
	intent?: string;
	reason?: string;
	close?: number;
}

interface TradePlanPrettyPayload {
	symbol?: string;
	side?: string;
	intent?: string;
	quantity?: number;
	stopLossPrice?: number;
	takeProfitPrice?: number;
}

interface PaperAccountSnapshotPrettyPayload {
	snapshot?: {
		startingBalance?: number;
		balance?: number;
		equity?: number;
		totalRealizedPnl?: number;
		maxEquity?: number;
		maxDrawdown?: number;
		trades?: {
			total?: number;
			wins?: number;
			losses?: number;
			breakeven?: number;
		};
	};
}
