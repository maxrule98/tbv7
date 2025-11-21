import { STRATEGY_IDS, isStrategyId, StrategyId } from "./ids";
export interface StrategyConfigLoaderOptions {
    configDir?: string;
    profile?: string;
    configPath?: string;
}
export type StrategyConstructor = new (...args: any[]) => unknown;
export interface StrategyDefinition<TConfig = unknown, TCtor extends StrategyConstructor = StrategyConstructor> {
    id: StrategyId;
    className: string;
    loadConfig: (options?: StrategyConfigLoaderOptions) => TConfig;
    resolveStrategyClass: () => Promise<TCtor>;
    defaultProfile?: string;
    configPath?: string;
}
export declare const getStrategyDefinition: <TConfig = unknown>(id: StrategyId) => StrategyDefinition<TConfig>;
export declare const listStrategyDefinitions: () => StrategyDefinition[];
export declare const validateStrategyId: (value: string) => StrategyId | null;
export { STRATEGY_IDS, isStrategyId, StrategyId };
