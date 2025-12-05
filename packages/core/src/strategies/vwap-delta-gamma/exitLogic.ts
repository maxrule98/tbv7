import { PositionSide } from "../../types";
import {
	StrategyContextSnapshot,
	pickLongExitReason,
	pickShortExitReason,
} from "./entryLogic";

export const resolveExitReason = (
	ctx: StrategyContextSnapshot,
	position: PositionSide
): string | null => {
	if (position === "LONG") {
		return pickLongExitReason(ctx.exits.long);
	}
	if (position === "SHORT") {
		return pickShortExitReason(ctx.exits.short);
	}
	return null;
};
