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

const classifySign = (value: number | null): DeltaGammaResult["deltaSign"] => {
	if (value === null || value === 0) {
		return "neutral";
	}
	return value > 0 ? "positive" : "negative";
};

export const computeDeltaGamma = (
	currentPrice: number | null,
	vwap: number | null,
	prevDelta: number | null = null
): DeltaGammaResult => {
	if (currentPrice === null || vwap === null) {
		return {
			delta: null,
			deltaMagnitude: null,
			deltaSign: "neutral",
			gamma: null,
			gammaMagnitude: null,
			gammaSign: "neutral",
			gammaFlipped: false,
			gammaFlipDirection: null,
		};
	}

	const delta = currentPrice - vwap;
	const gamma = prevDelta === null ? null : delta - prevDelta;
	const deltaSign = classifySign(delta);
	const gammaSign = classifySign(gamma);
	const deltaMagnitude = Math.abs(delta);
	const gammaMagnitude = gamma === null ? null : Math.abs(gamma);
	const prevDeltaSign = classifySign(prevDelta);
	const gammaFlipped =
		prevDelta !== null &&
		delta !== null &&
		prevDeltaSign !== deltaSign &&
		deltaSign !== "neutral" &&
		prevDeltaSign !== "neutral";
	const gammaFlipDirection = gammaFlipped
		? deltaSign === "positive"
			? "bullish"
			: "bearish"
		: null;

	return {
		delta,
		deltaMagnitude,
		deltaSign,
		gamma,
		gammaMagnitude,
		gammaSign,
		gammaFlipped,
		gammaFlipDirection,
	};
};
