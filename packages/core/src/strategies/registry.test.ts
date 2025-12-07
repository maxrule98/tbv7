import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadStrategyEntriesFrom, validateUniqueStrategyIds } from "./registry";

const uniqueFixtureDir = path.join(
	__dirname,
	"..",
	"__tests__",
	"registry-fixtures",
	"unique"
);
const duplicateFixtureDir = path.join(
	__dirname,
	"..",
	"__tests__",
	"registry-fixtures",
	"duplicate"
);

describe("strategy registry discovery", () => {
	it("discovers all strategies from the override directory", () => {
		const entries = loadStrategyEntriesFrom(uniqueFixtureDir);
		expect(entries.map((entry) => entry.id)).toEqual(
			expect.arrayContaining(["fixture_alpha", "fixture_beta"])
		);
	});

	it("throws when duplicate strategy ids are found", () => {
		const entries = loadStrategyEntriesFrom(duplicateFixtureDir);
		expect(() => validateUniqueStrategyIds(entries)).toThrow(
			/Duplicate strategy id/
		);
	});
});
