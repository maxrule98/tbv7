const slashPattern = /[/:]/g;

const ensureSlashSymbol = (symbol: string): string => {
	if (symbol.includes("/")) {
		return symbol;
	}
	if (symbol.includes("_")) {
		const [base, quote] = symbol.split("_");
		if (quote) {
			return `${base}/${quote}`;
		}
	}
	if (symbol.endsWith("USDT")) {
		return `${symbol.slice(0, -4)}/USDT`;
	}
	return symbol;
};

const collapseSymbol = (symbol: string): string => {
	return symbol.replace(slashPattern, "").toUpperCase();
};

export const normalizeSymbolForVenue = (
	venue: string,
	symbol: string
): string => {
	const trimmed = symbol.trim();
	if (!trimmed) {
		return symbol;
	}
	switch (venue.toLowerCase()) {
		case "binance":
			return collapseSymbol(trimmed);
		case "mexc":
			return ensureSlashSymbol(trimmed).toUpperCase();
		default:
			return trimmed;
	}
};

export const toCanonicalSymbol = (symbol: string): string => {
	const trimmed = symbol.trim();
	if (!trimmed) {
		return symbol;
	}
	return ensureSlashSymbol(trimmed).toUpperCase();
};
