import { HeatmapColorModes, NegativeWordCountMode } from "../defs/types";
import { CalculationType, TargetCount } from "../defs/types";
import { DailyActivity, TimeEntry } from "@/db/types";
import { App } from "obsidian";
import { Language } from "../defs/types";
import { getDB } from "../db/db";
import { Unit } from "../defs/types";
import KeepTheRhythm from "../main";
import { TFile } from "obsidian";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { MarkdownView } from "obsidian";
import { WorkspaceLeaf } from "obsidian";
import { moment as _moment } from "obsidian";
const moment = _moment as unknown as typeof _moment.default;

export function getLeafWithFile(app: App, file: TFile): WorkspaceLeaf | null {
	let result: WorkspaceLeaf | null = null;

	app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
		const view = leaf.view;

		if (view instanceof MarkdownView) {
			const currentFile = view.file;
			if (currentFile && currentFile.path === file.path) {
				result = leaf;
			}
		}
	});

	return result;
}

export const getFileName = (path: string): string => {
	return path.split("/").pop() || path;
};

export const getFileNameWithoutExtension = (path: string): string => {
	const fileName = getFileName(path);
	return fileName.replace(/\.[^/.]+$/, "");
};

export const log = (msg: string) => {
	console.info(
		`%cKEEP THE RHYTHM%c ${msg}`,
		"font-weight: bold; color: purple;",
		"font-weight: normal",
	);
};

export async function getFileContent(file: TFile, plugin: KeepTheRhythm) {
	return await plugin.app.vault.read(file);
}

export async function openFileByPath(app: App, path: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);

	if (file instanceof TFile) {
		await app.workspace.getLeaf(true).openFile(file);
	} else {
		console.warn(
			`[openFileByPath] File not found or not a TFile: "${path}"`,
		);
	}
}

export const getDateForCell = (
	weekIndex: number,
	dayIndex: number,
	totalAmountOfWeeks: number,
): Date => {
	const today = new Date();
	const date = new Date(today);

	const currentDayIndex = getDayIndex(date.getDay());
	date.setDate(date.getDate() - currentDayIndex);

	// Calculate offset from the current week's Monday
	const weekOffset = weekIndex - (totalAmountOfWeeks - 1);
	date.setDate(date.getDate() + weekOffset * 7 + dayIndex);

	return date;
};

export const getDayIndex = (dayIndex: number): number => {
	return dayIndex === 0 ? 6 : dayIndex - 1;
};



export function getRandomInt(min: number, max: number) {
	const minCeiled = Math.ceil(min);
	const maxFloored = Math.floor(max);
	return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled);
}

export function sumBothTimeEntries(activity: DailyActivity): {
	totalWords: number;
	totalChars: number;
} {
	let totalWords = 0;
	let totalChars = 0;

	totalWords += activity.wordCountStart || 0;
	totalChars += activity.charCountStart || 0;

	for (const entry of activity.changes) {
		totalWords += entry.w;
	}
	for (const entry of activity.changes) {
		totalChars += entry.c;
	}

	return { totalWords, totalChars };
}

export function sumTimeEntries(
	dailyActivity: DailyActivity,
	unit: Unit,
	excludeStart?: boolean,
): number {
	let total = 0;

	switch (unit) {
		case Unit.WORD:
			if (!excludeStart) {
				total += dailyActivity?.wordCountStart || 0;
			} else {
				total = 0;
			}
			if (!dailyActivity?.changes) break;

			for (const entry of dailyActivity.changes) {
				total += entry.w;
			}
			break;
		case Unit.CHAR:
			if (!excludeStart) {
				total += dailyActivity?.wordCountStart || 0;
			} else {
				total = 0;
			}
			if (!dailyActivity?.changes) break;

			for (const entry of dailyActivity.changes) {
				total += entry.c;
			}
			break;
	}

	return total;
}

export function sumTimeEntriesWithMode(
	dailyActivity: DailyActivity,
	unit: Unit,
	mode: NegativeWordCountMode = NegativeWordCountMode.NET,
	excludeStart?: boolean,
): number {
	let totalNet = 0;
	let totalAdded = 0;
	let totalDeleted = 0;

	// Add start counts (legacy/net)
	const startCount = (unit === Unit.WORD ? dailyActivity?.wordCountStart : dailyActivity?.charCountStart) || 0;
	if (!excludeStart) {
		totalNet += startCount;
		totalAdded += startCount; // Assume start count is all "added" historically
	}

	if (dailyActivity?.changes) {
		for (const entry of dailyActivity.changes) {
			const w = entry.w || 0;
			const c = entry.c || 0;
			const wa = entry.wa ?? (w > 0 ? w : 0); // Fallback for old entries
			const wd = entry.wd ?? (w < 0 ? -w : 0); // Fallback for old entries
			const ca = entry.ca ?? (c > 0 ? c : 0);
			const cd = entry.cd ?? (c < 0 ? -c : 0);

			if (unit === Unit.WORD) {
				totalNet += w;
				totalAdded += wa;
				totalDeleted += wd;
			} else {
				totalNet += c;
				totalAdded += ca;
				totalDeleted += cd;
			}
		}
	}

	if (mode === NegativeWordCountMode.GROSS) {
		return totalAdded;
	} else {
		return totalNet;
	}
}

export function sumAddedDeleted(dailyActivity: DailyActivity) {
	let wa = 0;
	let wd = 0;
	let ca = 0;
	let cd = 0;

	if (dailyActivity?.changes) {
		for (const entry of dailyActivity.changes) {
			wa += entry.wa || 0;
			wd += entry.wd || 0;
			ca += entry.ca || 0;
			cd += entry.cd || 0;
		}
	}
	return { wa, wd, ca, cd };
}

async function resetDatabase() {
	await getDB().delete();
	location.reload(); // Force page reload to reinitialize DB
}

export interface PathCondition {
	path: string;
	isInclusion: boolean;
}

export function parsePathFilters(query: string): PathCondition[] {
	const conditions: PathCondition[] = [];

	const regex = /PATH\s+((?:does\s+not\s+include)|includes)\s+"([^"]+)"/gi;
	let match;
	while ((match = regex.exec(query)) !== null) {
		const isInclusion = match[1].toLowerCase() !== "does not include";
		conditions.push({
			path: match[2],
			isInclusion,
		});
	}
	return conditions;
}

export function parseToggles(query: string) {
	const toggles = {
		showHeatmap: true,
		showOverview: true,
		showEntries: true,
	};

	const hideHeatmap = query.match(/HIDE\s+HEATMAP/i);
	const hideOverview = query.match(/HIDE\s+OVERVIEW/i);
	const hideEntries = query.match(/HIDE\s+ENTRIES/i);

	if (hideHeatmap) toggles.showHeatmap = false;
	if (hideOverview) toggles.showOverview = false;
	if (hideEntries) toggles.showEntries = false;

	return toggles;
}

export async function getFileWordAndCharCount(
	fileContent: string,
	enabledLanguages: Language[],
) {
	const wordCount = getLanguageBasedWordCount(fileContent, enabledLanguages);
	const charCount = fileContent.length;
	return [wordCount, charCount];
}

export function isValidTargetCount(value: string): value is TargetCount {
	return Object.values(TargetCount).includes(value as TargetCount);
}

export function isValidUnit(value: string): value is Unit {
	return Object.values(Unit).includes(value as Unit);
}

export function isValidCalculationType(
	value: string,
): value is CalculationType {
	return Object.values(CalculationType).includes(value as CalculationType);
}

export function isValidColoringMode(value: string): value is HeatmapColorModes {
	return Object.values(HeatmapColorModes).includes(
		value as HeatmapColorModes,
	);
}

export function getDateStreaks(dateStrings: string[]) {
	const dateSet = new Set(dateStrings);
	const sortedDates = [...dateSet].sort(); // YYYY-MM-DD format sorts lexicographically

	let longestStreak = 0;
	let currentStreak = 0;

	for (let i = 0; i < sortedDates.length; i++) {
		const startDate = moment(sortedDates[i]);
		const prevDay = startDate
			.clone()
			.subtract(1, "day")
			.format("YYYY-MM-DD");
		if (!dateSet.has(prevDay)) {
			let streak = 1;
			let nextDate = startDate.clone().add(1, "day");
			while (dateSet.has(nextDate.format("YYYY-MM-DD"))) {
				streak++;
				nextDate.add(1, "day");
			}
			longestStreak = Math.max(longestStreak, streak);
		}
	}

	let today = moment().startOf("day");
	while (dateSet.has(today.format("YYYY-MM-DD"))) {
		currentStreak++;
		today.subtract(1, "day");
	}

	return { longestStreak, currentStreak };
}

export function debounce<T extends (...args: any[]) => void>(
	func: T,
	delay: number,
): T {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return function (this: any, ...args: Parameters<T>) {
		if (timeoutId) clearTimeout(timeoutId);
		timeoutId = setTimeout(() => func.apply(this, args), delay);
	} as T;
}
