import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = /@agenai\/exchange-(binance|mexc)/;
const TARGETS = [
	{ name: "runtime", dir: path.join(__dirname, "../../../runtime/src") },
	{
		name: "execution-engine",
		dir: path.join(__dirname, "../../../execution-engine/src"),
	},
	{ name: "data", dir: path.join(__dirname, "../../../data/src") },
];
const PACKAGE_JSONS = [
	path.join(__dirname, "../../../runtime/package.json"),
	path.join(__dirname, "../../../execution-engine/package.json"),
	path.join(__dirname, "../../../data/package.json"),
];

const shouldScan = (file: string): boolean => {
	const base = path.basename(file);
	if (base.startsWith(".")) return false;
	if (base.endsWith(".test.ts")) return true;
	return base.endsWith(".ts");
};

const walkFiles = (root: string): string[] => {
	const results: string[] = [];
	const stack = [root];
	while (stack.length) {
		const current = stack.pop()!;
		const stat = fs.statSync(current);
		if (stat.isDirectory()) {
			for (const entry of fs.readdirSync(current)) {
				if (entry === "node_modules" || entry === "dist") continue;
				stack.push(path.join(current, entry));
			}
			continue;
		}
		if (shouldScan(current)) {
			results.push(current);
		}
	}
	return results;
};

describe("exchange import boundaries", () => {
	it("runtime/execution-engine/data do not import exchange packages", () => {
		const offenders: string[] = [];
		for (const target of TARGETS) {
			for (const file of walkFiles(target.dir)) {
				const content = fs.readFileSync(file, "utf8");
				if (FORBIDDEN.test(content)) {
					offenders.push(`${target.name}:${path.relative(target.dir, file)}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("runtime/execution-engine/data package.json have no exchange deps", () => {
		const offenders: string[] = [];
		for (const pkgPath of PACKAGE_JSONS) {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
			const deps = {
				...(pkg.dependencies ?? {}),
				...(pkg.devDependencies ?? {}),
			};
			for (const dep of Object.keys(deps)) {
				if (FORBIDDEN.test(dep)) {
					offenders.push(path.basename(pkgPath));
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
