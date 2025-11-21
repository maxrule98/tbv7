"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStrategyId = exports.STRATEGY_IDS = exports.validateStrategyId = exports.listStrategyDefinitions = exports.getStrategyDefinition = void 0;
const config_1 = require("../config");
const VWAPDeltaGammaStrategy_1 = require("./vwap-delta-gamma/VWAPDeltaGammaStrategy");
const ids_1 = require("./ids");
Object.defineProperty(exports, "STRATEGY_IDS", { enumerable: true, get: function () { return ids_1.STRATEGY_IDS; } });
Object.defineProperty(exports, "isStrategyId", { enumerable: true, get: function () { return ids_1.isStrategyId; } });
const ensureStrategyId = (expected, actual, profile) => {
    if (expected !== actual) {
        throw new Error(`Strategy profile ${profile ?? "default"} resolved to ${actual}, expected ${expected}`);
    }
};
const STRATEGY_ENGINE_MODULE_ID = "@agenai/strategy-engine";
const loadStrategyEngineModule = async () => {
    const moduleId = STRATEGY_ENGINE_MODULE_ID;
    const mod = await Promise.resolve().then(() => __importStar(require(moduleId)));
    if (!mod.MacdAr4Strategy || !mod.MomentumV3Strategy) {
        throw new Error("Failed to load @agenai/strategy-engine exports");
    }
    return mod;
};
const strategyRegistry = {
    macd_ar4_v2: {
        id: "macd_ar4_v2",
        className: "MacdAr4Strategy",
        defaultProfile: "macd_ar4",
        loadConfig: ({ configDir, profile } = {}) => {
            const config = (0, config_1.loadStrategyConfig)(configDir, profile ?? "macd_ar4");
            ensureStrategyId("macd_ar4_v2", config.id, profile);
            return config;
        },
        resolveStrategyClass: async () => (await loadStrategyEngineModule()).MacdAr4Strategy,
    },
    momentum_v3: {
        id: "momentum_v3",
        className: "MomentumV3Strategy",
        defaultProfile: "momentum_v3",
        loadConfig: ({ configDir, profile } = {}) => {
            const config = (0, config_1.loadStrategyConfig)(configDir, profile ?? "momentum_v3");
            ensureStrategyId("momentum_v3", config.id, profile);
            return config;
        },
        resolveStrategyClass: async () => (await loadStrategyEngineModule()).MomentumV3Strategy,
    },
    vwap_delta_gamma: {
        id: "vwap_delta_gamma",
        className: "VWAPDeltaGammaStrategy",
        configPath: "configs/strategies/vwap-delta-gamma.json",
        loadConfig: ({ configPath } = {}) => (0, VWAPDeltaGammaStrategy_1.loadVWAPDeltaGammaConfig)(configPath),
        resolveStrategyClass: async () => VWAPDeltaGammaStrategy_1.VWAPDeltaGammaStrategy,
    },
};
const getStrategyDefinition = (id) => {
    const definition = strategyRegistry[id];
    if (!definition) {
        throw new Error(`Unknown strategy id: ${id}`);
    }
    return definition;
};
exports.getStrategyDefinition = getStrategyDefinition;
const listStrategyDefinitions = () => {
    return ids_1.STRATEGY_IDS.map((id) => strategyRegistry[id]);
};
exports.listStrategyDefinitions = listStrategyDefinitions;
const validateStrategyId = (value) => {
    if ((0, ids_1.isStrategyId)(value)) {
        return value;
    }
    return null;
};
exports.validateStrategyId = validateStrategyId;
