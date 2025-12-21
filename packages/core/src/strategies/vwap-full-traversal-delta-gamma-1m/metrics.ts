import { createLogger } from "../../..";

const logger = createLogger("vwap-full-traversal-metrics");

export class VWAPFullTraversalMetrics {
	emitDiagnostics(data: {
		timestamp: number;
		vwap: number;
		sd: number;
		upper: number;
		lower: number;
		delta: number | null;
		gamma: number | null;
		touchedUpper: boolean;
		touchedLower: boolean;
		price: number;
	}): void {
		logger.info("strategy_diagnostics", {
			strategy: "vwap_full_traversal",
			timestamp: new Date(data.timestamp).toISOString(),
			vwap: data.vwap.toFixed(2),
			sd: data.sd.toFixed(2),
			upper: data.upper.toFixed(2),
			lower: data.lower.toFixed(2),
			price: data.price.toFixed(2),
			delta: data.delta?.toFixed(4) ?? null,
			gamma: data.gamma?.toFixed(4) ?? null,
			touchedUpper: data.touchedUpper,
			touchedLower: data.touchedLower,
		});
	}
}
