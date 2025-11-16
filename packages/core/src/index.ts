/**
 * Core package centralizes shared contracts and configuration helpers.
 * Everything else in the monorepo should depend on these primitives.
 */
export interface CoreRuntimeConfig {
  envFile?: string;
  configDir?: string;
}

export interface CoreContainer {
  config: CoreRuntimeConfig;
}

export const createCoreContainer = (config: CoreRuntimeConfig = {}): CoreContainer => ({
  config
});
