export interface DeltaGammaResult {
    delta: number | null;
    deltaMagnitude: number | null;
    deltaSign: "positive" | "negative" | "neutral";
    gamma: number | null;
    gammaMagnitude: number | null;
    gammaSign: "positive" | "negative" | "neutral";
    gammaFlipped: boolean;
    gammaFlipDirection: "bullish" | "bearish" | null;
}
export declare const computeDeltaGamma: (currentPrice: number | null, vwap: number | null, prevDelta?: number | null) => DeltaGammaResult;
