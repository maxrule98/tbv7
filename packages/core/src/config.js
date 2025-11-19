"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAgenaiConfig = exports.loadAccountConfig = exports.loadRiskConfig = exports.loadStrategyConfig = exports.loadExchangeConfig = exports.loadEnvConfig = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
let envLoaded = false;
let loadedEnvPath;
let cachedWorkspaceRoot;
const WORKSPACE_SENTINELS = ["pnpm-workspace.yaml", ".git"];
const findWorkspaceRoot = () => {
    if (cachedWorkspaceRoot) {
        return cachedWorkspaceRoot;
    }
    let current = process.cwd();
    while (!WORKSPACE_SENTINELS.some((file) => node_fs_1.default.existsSync(node_path_1.default.join(current, file)))) {
        const parent = node_path_1.default.dirname(current);
        if (parent === current) {
            cachedWorkspaceRoot = current;
            return current;
        }
        current = parent;
    }
    cachedWorkspaceRoot = current;
    return current;
};
const getDefaultEnvPath = () => node_path_1.default.join(findWorkspaceRoot(), ".env");
const getDefaultConfigDir = () => node_path_1.default.join(findWorkspaceRoot(), "config");
const getEnvVar = (key, fallback) => {
    const value = process.env[key];
    if (value !== undefined && value !== "") {
        return value;
    }
    if (fallback !== undefined) {
        return fallback;
    }
    throw new Error(`Missing required environment variable: ${key}`);
};
const toBoolean = (value, fallback = false) => {
    if (value === undefined) {
        return fallback;
    }
    return value.toLowerCase() === "true";
};
const normalizeExecutionMode = (value) => {
    return value?.toLowerCase() === "live" ? "live" : "paper";
};
const readJsonFile = (filePath) => {
    const contents = node_fs_1.default.readFileSync(filePath, "utf-8");
    return JSON.parse(contents);
};
const loadEnvConfig = (envPath = getDefaultEnvPath()) => {
    if (!envLoaded || loadedEnvPath !== envPath) {
        dotenv_1.default.config({ path: envPath });
        envLoaded = true;
        loadedEnvPath = envPath;
    }
    return {
        exchangeId: getEnvVar("EXCHANGE_ID", "mexc"),
        executionMode: normalizeExecutionMode(getEnvVar("EXECUTION_MODE", "paper")),
        binanceApiKey: getEnvVar("BINANCE_API_KEY", ""),
        binanceApiSecret: getEnvVar("BINANCE_API_SECRET", ""),
        binanceUseTestnet: toBoolean(getEnvVar("BINANCE_USE_TESTNET", "false"), false),
        mexcApiKey: getEnvVar("MEXC_API_KEY", ""),
        mexcApiSecret: getEnvVar("MEXC_API_SECRET", ""),
        defaultSymbol: getEnvVar("DEFAULT_SYMBOL", "BTC/USDT"),
        defaultTimeframe: getEnvVar("DEFAULT_TIMEFRAME", "1m"),
    };
};
exports.loadEnvConfig = loadEnvConfig;
const loadExchangeConfig = (env, configDir = getDefaultConfigDir(), exchangeProfile) => {
    const profile = exchangeProfile ?? env.exchangeId ?? "mexc";
    const exchangePath = node_path_1.default.join(configDir, "exchange", `${profile}.json`);
    const exchangeFile = readJsonFile(exchangePath);
    const isBinance = profile.startsWith("binance");
    const credentials = isBinance
        ? { apiKey: env.binanceApiKey, apiSecret: env.binanceApiSecret }
        : { apiKey: env.mexcApiKey, apiSecret: env.mexcApiSecret };
    return {
        ...exchangeFile,
        id: profile,
        testnet: isBinance ? env.binanceUseTestnet : exchangeFile.testnet,
        defaultSymbol: env.defaultSymbol || exchangeFile.defaultSymbol,
        credentials,
    };
};
exports.loadExchangeConfig = loadExchangeConfig;
const loadStrategyConfig = (configDir = getDefaultConfigDir(), strategyProfile = "macd_ar4") => {
    const strategyPath = node_path_1.default.join(configDir, "strategies", `${strategyProfile}.json`);
    return readJsonFile(strategyPath);
};
exports.loadStrategyConfig = loadStrategyConfig;
const loadRiskConfig = (configDir = getDefaultConfigDir(), riskProfile = "default") => {
    const riskPath = node_path_1.default.join(configDir, "risk", `${riskProfile}.json`);
    const file = readJsonFile(riskPath);
    const riskPerTradePercent = file.riskPerTradePercent ??
        (file.riskPerTradePct !== undefined ? file.riskPerTradePct / 100 : 0.01);
    return {
        maxLeverage: file.maxLeverage,
        riskPerTradePercent,
        maxPositions: file.maxPositions,
        slPct: file.slPct,
        tpPct: file.tpPct,
        minPositionSize: file.minPositionSize ?? 0.001,
        maxPositionSize: file.maxPositionSize ?? 1,
        trailingActivationPct: file.trailingActivationPct ?? 0.005,
        trailingTrailPct: file.trailingTrailPct ?? 0.003,
    };
};
exports.loadRiskConfig = loadRiskConfig;
const loadAccountConfig = (configDir = getDefaultConfigDir(), accountProfile = "paper") => {
    const accountPath = node_path_1.default.join(configDir, "account", `${accountProfile}.json`);
    return readJsonFile(accountPath);
};
exports.loadAccountConfig = loadAccountConfig;
const loadAgenaiConfig = (options = {}) => {
    const workspaceRoot = findWorkspaceRoot();
    const envPath = options.envPath ?? node_path_1.default.join(workspaceRoot, ".env");
    const configDir = options.configDir ?? node_path_1.default.join(workspaceRoot, "config");
    const env = (0, exports.loadEnvConfig)(envPath);
    return {
        env,
        exchange: (0, exports.loadExchangeConfig)(env, configDir, options.exchangeProfile),
        strategy: (0, exports.loadStrategyConfig)(configDir, options.strategyProfile),
        risk: (0, exports.loadRiskConfig)(configDir, options.riskProfile),
    };
};
exports.loadAgenaiConfig = loadAgenaiConfig;
