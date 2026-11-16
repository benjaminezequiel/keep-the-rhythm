import "fake-indexeddb/auto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from "@jest/globals";
import {
	CalculationType,
	DEFAULT_SETTINGS,
	TargetCount,
	Unit,
} from "../src/defs/types";
import {
	compileEvaluator,
	parseQueryToJSEP,
	parseSlotsCodeBlock,
} from "../src/core/codeBlockQuery";
import { state } from "../src/core/pluginState";
import { closeDB, getDB, initDatabase } from "../src/db/db";
import {
	getActivityForDates,
	getCurrentCount,
	getDaysWithCompletedGoal,
} from "../src/db/queries";
import { invalidateAll, takeDelta } from "../src/core/activityTracker";
import type { DailyActivity } from "../src/db/types";
import { TFile } from "obsidian";

jest.mock(
	"obsidian",
	() => ({ moment: jest.requireActual("moment"), TFile: class {} }),
	{
		virtual: true,
	},
);
jest.mock("../src/core/pluginState", () => ({
	state: {
		today: "2026-11-05",
		plugin: {
			data: {},
			app: {
				vault: {
					adapter: { getResourcePath: () => "app://filter-tests" },
					getMarkdownFiles: jest.fn(),
					cachedRead: jest.fn(),
				},
				workspace: { getActiveFile: jest.fn() },
			},
		},
	},
}));

const folder = "Stories/Feed my Necromancer/";
const file = (path: string) =>
	Object.assign(new TFile(), { path, extension: "md" });
const mockVault = jest.mocked(state.plugin.app.vault);
const mockWorkspace = jest.mocked(state.plugin.app.workspace);
const activity = (
	date: string,
	path: string,
	words: number,
): DailyActivity => ({
	date,
	filePath: path,
	wordCountStart: 5000,
	charCountStart: 20000,
	changes: [{ timeKey: "15:00", w: words, c: words * 4 }],
});
const pathFilter = () =>
	compileEvaluator(
		parseSlotsCodeBlock(
			`filePath starts_with "${folder}"\nCURRENT_DAY, WORDS`,
		).filter,
	);

beforeAll(async () => {
	jest.useFakeTimers({
		now: new Date(2026, 10, 5, 16),
		doNotFake: [
			"setTimeout",
			"clearTimeout",
			"setImmediate",
			"clearImmediate",
			"nextTick",
			"queueMicrotask",
		],
	});
	await initDatabase();
});

beforeEach(async () => {
	invalidateAll();
	state.plugin.data = {
		settings: structuredClone(DEFAULT_SETTINGS),
		stats: {
			dailyActivity: [],
			wholeVaultWordCount: 10000,
			wholeVaultCharCount: 40000,
			daysWithCompletedGoal: ["2026-11-03", "2026-11-04", "2026-11-05"],
		},
	};
	mockVault.getMarkdownFiles.mockReturnValue([]);
	mockVault.cachedRead.mockReset();
	mockWorkspace.getActiveFile.mockReturnValue(null);
	await getDB().dailyActivity.clear();
	await getDB().dailyActivity.bulkAdd([
		activity("2026-11-05", `${folder}Chapter.md`, 100),
		activity("2026-11-05", "Journal/Today.md", 900),
		activity("2026-11-04", `${folder}Chapter.md`, 600),
		activity("2026-11-04", "Journal/Yesterday.md", 800),
		activity("2026-11-03", "Journal/Tuesday.md", 900),
		activity("2026-11-01", `${folder}Notes.md`, 50),
		activity("2026-10-31", `${folder}Notes.md`, 30),
		activity("2026-10-01", `${folder}Notes.md`, 20),
		activity("2025-01-01", `${folder}Notes.md`, 200),
	]);
});

afterAll(() => {
	closeDB();
	jest.useRealTimers();
});

describe("dashboard query parsing", () => {
	it("rejects the reported mixed block instead of falling back to the whole vault", () => {
		expect(() =>
			parseQueryToJSEP(`filePath starts_with "Stories/Feed my Necromancer"

CURRENT_WEEK, WORDS
CURRENT_DAY, WORDS
CURRENT_MONTH, WORDS, AVG
CURRENT_YEAR
WEEKS 26`),
		).toThrow("CURRENT_WEEK belongs in a ktr-slots block");
	});

	it.each(["", "OPTIONS\n"])(
		"keeps a valid filter with optional OPTIONS header %p",
		(header) => {
			const query = parseQueryToJSEP(
				`filePath starts_with "${folder}"\n${header}WEEKS 26\nUNIT WORDS`,
			);
			expect(query.options.numberOfWeeks).toBe(26);
			expect(query.options.unit).toBe(Unit.WORD);
			const matches = compileEvaluator(query.filter);
			expect(matches({ filePath: `${folder}Chapter.md` })).toBe(true);
			expect(matches({ filePath: "Journal/Today.md" })).toBe(false);
		},
	);

	it.each([
		'filePath starts_with "unterminated',
		'filePath starts_with "Stories/"\nfilePath contains "Chapter"',
		'filePath.startsWith("Stories/")',
		'filePath + "Stories/"',
		'filePth starts_with "Stories/"',
	])("rejects malformed or unsupported filters: %s", (source) => {
		expect(() => parseQueryToJSEP(source)).toThrow("Invalid filter");
		expect(() => parseSlotsCodeBlock(`${source}\nCURRENT_DAY`)).toThrow(
			"Invalid filter",
		);
	});

	it("supports multiline logical conditions without changing quoted AND/OR", () => {
		const query = parseQueryToJSEP(`(filePath starts_with "Stories/AND OR/")
OR (filePath starts_with "Journal/")
AND !(filePath contains "Draft")
WEEKS 26`);
		const matches = compileEvaluator(query.filter);
		expect(matches({ filePath: "Stories/AND OR/Chapter.md" })).toBe(true);
		expect(matches({ filePath: "Journal/Today.md" })).toBe(true);
		expect(matches({ filePath: "Journal/Draft.md" })).toBe(false);
		expect(matches({ filePath: "Other/Chapter.md" })).toBe(false);
	});

	it("parses filtered slots, blank lines, and documented plural units", () => {
		state.plugin.data.settings.preferredUnit = Unit.CHAR;
		const query = parseSlotsCodeBlock(`filePath starts_with "${folder}"

CURRENT_DAY, WORDS
  
LAST_MONTH, CHARS, AVG`);
		expect(query.slots).toEqual([
			{
				index: 0,
				option: TargetCount.CURRENT_DAY,
				unit: Unit.WORD,
				calc: CalculationType.TOTAL,
			},
			{
				index: 1,
				option: TargetCount.LAST_MONTH,
				unit: Unit.CHAR,
				calc: CalculationType.AVG,
			},
		]);
		expect(pathFilter()({ filePath: `${folder}Chapter.md` })).toBe(true);
		expect(pathFilter()({ filePath: "Other.md" })).toBe(false);
	});

	it("preserves unfiltered blocks and singular units", () => {
		const query = parseSlotsCodeBlock(
			"CURRENT_DAY, WORD\nCURRENT_MONTH, CHAR, AVG\nWHOLE_VAULT",
		);
		expect(query.filter).toBeUndefined();
		expect(query.slots.map((slot) => slot.unit)).toEqual([
			Unit.WORD,
			Unit.CHAR,
			Unit.WORD,
		]);
		expect(parseQueryToJSEP("WEEKS 26").filter).toBeUndefined();
	});

	it("limits slot filters to file paths, which are also available for existing-file totals", () => {
		expect(() =>
			parseSlotsCodeBlock('date == "2026-11-05"\nWHOLE_VAULT'),
		).toThrow("Allowed fields: filePath");
	});
});

describe("filtered database queries", () => {
	it.each(["starts_with", "STARTS_WITH"])(
		"filters heatmap activity by path and displayed dates with %s",
		async (operator) => {
			const query = parseQueryToJSEP(
				`filePath ${operator} "/${folder}"\nWEEKS 26`,
			);
			const rows = await getActivityForDates(
				["2026-11-05", "2026-11-04"],
				compileEvaluator(query.filter),
			);
			expect(rows.map((row) => [row.date, row.filePath])).toEqual([
				["2026-11-04", `${folder}Chapter.md`],
				["2026-11-05", `${folder}Chapter.md`],
			]);
		},
	);

	it("applies compound heatmap filters and returns no data for unmatched paths", async () => {
		const query = parseQueryToJSEP(
			`(filePath starts_with "${folder}") AND (date == "2026-11-05")`,
		);
		expect(
			await getActivityForDates(
				["2026-11-05", "2026-11-04"],
				compileEvaluator(query.filter),
			),
		).toHaveLength(1);
		const missing = parseQueryToJSEP('filePath starts_with "Missing/"');
		expect(
			await getActivityForDates(
				["2026-11-05"],
				compileEvaluator(missing.filter),
			),
		).toEqual([]);
		expect(await getActivityForDates(["2026-11-05"])).toHaveLength(2);
	});

	it.each([
		[TargetCount.CURRENT_DAY, 100],
		[TargetCount.CURRENT_WEEK, 700],
		[TargetCount.CURRENT_MONTH, 750],
		[TargetCount.CURRENT_YEAR, 800],
		[TargetCount.LAST_DAY, 100],
		[TargetCount.LAST_WEEK, 780],
		[TargetCount.LAST_MONTH, 780],
		[TargetCount.LAST_YEAR, 800],
	])("scopes %s activity to the story folder", async (target, expected) => {
		expect(
			await getCurrentCount(
				Unit.WORD,
				target,
				CalculationType.TOTAL,
				pathFilter(),
			),
		).toBe(expected);
		expect(
			await getCurrentCount(
				Unit.CHAR,
				target,
				CalculationType.TOTAL,
				pathFilter(),
			),
		).toBe(expected * 4);
	});

	it("calculates averages from filtered activity and leaves unfiltered totals unchanged", async () => {
		expect(
			await getCurrentCount(
				Unit.WORD,
				TargetCount.CURRENT_MONTH,
				CalculationType.AVG,
				pathFilter(),
			),
		).toBe(150);
		expect(
			await getCurrentCount(
				Unit.WORD,
				TargetCount.LAST_MONTH,
				CalculationType.AVG,
				pathFilter(),
			),
		).toBe(26);
		expect(await getCurrentCount(Unit.WORD, TargetCount.CURRENT_DAY)).toBe(
			1000,
		);
		expect(
			await getCurrentCount(
				Unit.WORD,
				TargetCount.CURRENT_DAY,
				CalculationType.TOTAL,
				() => false,
			),
		).toBe(0);
	});

	it("includes only matching changes inside the rolling 24-hour window", async () => {
		await getDB().dailyActivity.add({
			...activity("2026-11-04", `${folder}Later.md`, 40),
			changes: [{ timeKey: "17:00", w: 40, c: 160 }],
		});
		expect(
			await getCurrentCount(
				Unit.WORD,
				TargetCount.LAST_DAY,
				CalculationType.TOTAL,
				pathFilter(),
			),
		).toBe(140);
	});

	it("scopes streaks and weekly goal indicators without changing the global cache", async () => {
		expect(await getDaysWithCompletedGoal(pathFilter())).toEqual([
			"2026-11-04",
		]);
		expect(
			await getCurrentCount(
				Unit.WORD,
				TargetCount.CURRENT_STREAK,
				CalculationType.TOTAL,
				pathFilter(),
			),
		).toBe(1);
		expect(
			await getCurrentCount(Unit.WORD, TargetCount.CURRENT_STREAK),
		).toBe(3);
	});

	it("counts matching files for WHOLE_VAULT without contaminating the global cache", async () => {
		const files = [
			file(`${folder}Chapter.md`),
			file(`${folder}Notes.md`),
			file("Other.md"),
		];
		mockVault.getMarkdownFiles.mockReturnValue(files);
		mockVault.cachedRead.mockResolvedValue("one two three");
		takeDelta(files[0], 5, 25);
		expect(
			await getCurrentCount(
				Unit.WORD,
				TargetCount.WHOLE_VAULT,
				CalculationType.TOTAL,
				pathFilter(),
			),
		).toBe(8);
		expect(
			await getCurrentCount(
				Unit.CHAR,
				TargetCount.WHOLE_VAULT,
				CalculationType.TOTAL,
				pathFilter(),
			),
		).toBe(38);
		expect(
			mockVault.cachedRead.mock.calls.map(([readFile]) => readFile),
		).not.toContain(files[2]);
		expect(await getCurrentCount(Unit.WORD, TargetCount.WHOLE_VAULT)).toBe(
			10000,
		);
		expect(await getCurrentCount(Unit.CHAR, TargetCount.WHOLE_VAULT)).toBe(
			40000,
		);
	});

	it("returns zero for a current file outside the filter", async () => {
		mockWorkspace.getActiveFile.mockReturnValue(file("Other.md"));
		expect(
			await getCurrentCount(
				Unit.WORD,
				TargetCount.CURRENT_FILE,
				CalculationType.TOTAL,
				pathFilter(),
			),
		).toBe(0);
		expect(mockVault.cachedRead.mock.calls).toHaveLength(0);
		const chapter = file(`${folder}Chapter.md`);
		mockWorkspace.getActiveFile.mockReturnValue(chapter);
		takeDelta(chapter, 12, 48);
		expect(
			await getCurrentCount(
				Unit.WORD,
				TargetCount.CURRENT_FILE,
				CalculationType.TOTAL,
				pathFilter(),
			),
		).toBe(12);
	});
});
