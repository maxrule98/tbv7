const UNIT_TO_MS: Record<string, number> = {
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
};

export const timeframeToMs = (timeframe: string): number => {
	const match = timeframe.match(/^(\d+)([smhdw])$/i);
	if (!match) {
		throw new Error(`Unsupported timeframe format: ${timeframe}`);
	}
	const value = Number(match[1]);
	const unit = match[2]?.toLowerCase();
	const factor = UNIT_TO_MS[unit];
	if (!factor) {
		throw new Error(`Unsupported timeframe unit: ${timeframe}`);
	}
	return value * factor;
};
