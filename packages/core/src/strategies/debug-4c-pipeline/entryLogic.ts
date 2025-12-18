import { Candle, PositionSide, TradeIntent } from "../../types";

interface SequenceState {
	step: number;
	lastTimestamp?: number;
	completed: boolean;
}

const SEQUENCE: TradeIntent["intent"][] = [
	"OPEN_LONG",
	"CLOSE_LONG",
	"OPEN_SHORT",
	"CLOSE_SHORT",
];

export class Debug4cPipelineSequencer {
	private readonly stateBySymbol = new Map<string, SequenceState>();

	nextIntent(latest: Candle, _position: PositionSide): TradeIntent {
		const state = this.getState(latest.symbol);
		if (state.lastTimestamp === latest.timestamp) {
			return this.noAction(latest, "await_closed_bar");
		}
		state.lastTimestamp = latest.timestamp;
		if (state.completed) {
			return this.noAction(latest, "sequence_complete");
		}

		const target = SEQUENCE[state.step];
		if (!target) {
			state.completed = true;
			return this.noAction(latest, "sequence_complete");
		}

		const intent: TradeIntent = {
			symbol: latest.symbol,
			intent: target,
			reason: `debug_step_${state.step + 1}`,
			timestamp: latest.timestamp,
			metadata: {
				sequenceStep: state.step + 1,
				timeframe: latest.timeframe,
			},
		};

		state.step += 1;
		if (state.step >= SEQUENCE.length) {
			state.completed = true;
		}

		return intent;
	}

	private getState(symbol: string): SequenceState {
		const existing = this.stateBySymbol.get(symbol);
		if (existing) {
			return existing;
		}
		const created: SequenceState = {
			step: 0,
			completed: false,
		};
		this.stateBySymbol.set(symbol, created);
		return created;
	}

	private noAction(candle: Candle, reason: string): TradeIntent {
		return {
			symbol: candle.symbol,
			intent: "NO_ACTION",
			reason,
			timestamp: candle.timestamp,
			metadata: {
				sequenceStep: this.stateBySymbol.get(candle.symbol)?.step ?? 0,
				sequenceComplete:
					this.stateBySymbol.get(candle.symbol)?.completed ?? false,
			},
		};
	}
}
