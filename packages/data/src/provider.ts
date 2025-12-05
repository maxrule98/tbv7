import { loadHistoricalSeries } from "./historical";
import { PollingLiveSubscription } from "./liveSubscription";
import {
	DataProvider,
	DataProviderConfig,
	HistoricalSeriesRequest,
	LiveSubscription,
	LiveSubscriptionOptions,
	TimeframeSeries,
} from "./types";

const MIN_POLL_INTERVAL_MS = 1_000;

export class DefaultDataProvider implements DataProvider {
	private readonly batchSize: number;
	private readonly maxIterations: number;

	constructor(private readonly config: DataProviderConfig) {
		if (!config.client) {
			throw new Error("DataProvider client is required");
		}
		this.batchSize = Math.max(config.defaultBatchSize ?? 500, 1);
		this.maxIterations = Math.max(config.maxIterations ?? 10_000, 1);
	}

	async loadHistoricalSeries(
		options: HistoricalSeriesRequest
	): Promise<TimeframeSeries[]> {
		if (!options.requests.length) {
			throw new Error("Historical request requires at least one timeframe");
		}
		return loadHistoricalSeries(
			this.config.client,
			options,
			this.config.logger,
			this.batchSize,
			this.maxIterations
		);
	}

	createLiveSubscription(options: LiveSubscriptionOptions): LiveSubscription {
		if (!options.timeframes.length) {
			throw new Error("Live subscription requires at least one timeframe");
		}
		const pollInterval = Math.max(
			options.pollIntervalMs ?? 10_000,
			MIN_POLL_INTERVAL_MS
		);
		return new PollingLiveSubscription({
			...options,
			pollIntervalMs: pollInterval,
			client: this.config.client,
			logger: this.config.logger,
		});
	}
}
