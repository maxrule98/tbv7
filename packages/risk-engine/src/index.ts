/**
 * Risk engine handles leverage limits, sizing, and execution guardrails.
 */
export interface RiskParameters {
  maxLeverage: number;
  riskPerTradePct: number;
  maxPositions: number;
}

export interface RiskAssessment {
  shouldTrade: boolean;
  reason?: string;
}

export const createRiskEngine = (params: RiskParameters) => ({
  evaluate: (): RiskAssessment => ({
    shouldTrade: false,
    reason: `Risk checks pending for maxLeverage=${params.maxLeverage}`
  })
});
