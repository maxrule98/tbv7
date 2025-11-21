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
    const file = readJsonFile(strategyPath);
    const strategyId = file.id === "momentum_v3" ? "momentum_v3" : "macd_ar4_v2";
    return strategyId === "momentum_v3"
        ? normalizeMomentumV3Config(file)
        : normalizeMacdAr4Config(file);
};
exports.loadStrategyConfig = loadStrategyConfig;
const normalizeMacdAr4Config = (file) => {
    const indicatorFile = file.indicators ?? {};
    const thresholdFile = file.thresholds ?? {};
    const indicators = {
        emaFast: indicatorFile.emaFast ?? 12,
        emaSlow: indicatorFile.emaSlow ?? 26,
        signal: indicatorFile.signal ?? 9,
        pullbackFast: indicatorFile.pullbackFast ?? 9,
        pullbackSlow: indicatorFile.pullbackSlow ?? 21,
        atrPeriod: indicatorFile.atrPeriod ?? 14,
        rsiPeriod: indicatorFile.rsiPeriod ?? 14,
        arWindow: indicatorFile.arWindow ?? 20,
    };
    const thresholds = {
        minForecast: thresholdFile.minForecast ?? 0,
        minAtr: thresholdFile.minAtr ?? 8,
        maxAtr: thresholdFile.maxAtr ?? 80,
        rsiLongLower: thresholdFile.rsiLongLower ?? 40,
        rsiLongUpper: thresholdFile.rsiLongUpper ?? 70,
        rsiShortLower: thresholdFile.rsiShortLower ?? 30,
        rsiShortUpper: thresholdFile.rsiShortUpper ?? 60,
        htfHistogramDeadband: thresholdFile.htfHistogramDeadband ?? 0.0005,
    };
    return {
        id: "macd_ar4_v2",
        symbol: file.symbol,
        timeframe: file.timeframe,
        mode: file.mode ?? "long-only",
        higherTimeframe: file.higherTimeframe ?? "15m",
        htfCacheMs: file.htfCacheMs ?? 60000,
        indicators,
        thresholds,
    };
};
const normalizeMomentumV3Config = (file) => {
    const htfFile = file.htf ?? {};
    const atrFile = file.atr ?? {};
    const volumeFile = file.volume ?? {};
    const breakoutFile = file.breakout ?? {};
    const rsiFile = file.rsi ?? {};
    return {
        id: "momentum_v3",
        symbol: file.symbol,
        timeframe: file.timeframe,
        mode: file.mode ?? "long-only",
        htfCacheMs: file.htfCacheMs ?? 60000,
        htf: {
            timeframe: htfFile.timeframe ?? "15m",
            macdFast: htfFile.macdFast ?? 12,
            macdSlow: htfFile.macdSlow ?? 26,
            macdSignal: htfFile.macdSignal ?? 9,
            deadband: htfFile.deadband ?? 0,
        },
        atr: {
            period: atrFile.period ?? 14,
            emaPeriod: atrFile.emaPeriod ?? 20,
        },
        volume: {
            smaPeriod: volumeFile.smaPeriod ?? 20,
            spikeMultiplier: volumeFile.spikeMultiplier ?? 1.2,
        },
        breakout: {
            lookback: breakoutFile.lookback ?? 20,
        },
        rsi: {
            period: rsiFile.period ?? 14,
            longMin: rsiFile.longMin ?? 45,
            longMax: rsiFile.longMax ?? 70,
            shortMin: rsiFile.shortMin ?? 20,
            shortMax: rsiFile.shortMax ?? 55,
        },
    };
};
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
