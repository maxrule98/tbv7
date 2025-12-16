export type ArgValue = string | boolean;

export const parseCliArgs = (argv: string[]): Record<string, ArgValue> => {
	const args: Record<string, ArgValue> = {};
	const positionals: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}
		const eqIdx = token.indexOf("=");
		if (eqIdx !== -1) {
			const key = token.slice(2, eqIdx);
			const value = token.slice(eqIdx + 1);
			args[key] = value;
			continue;
		}
		const key = token.slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith("--")) {
			args[key] = next;
			i += 1;
		} else {
			args[key] = true;
		}
	}
	if (positionals[0] && args.start === undefined) {
		args.start = positionals[0];
	}
	if (positionals[1] && args.end === undefined) {
		args.end = positionals[1];
	}
	return args;
};
