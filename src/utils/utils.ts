import { state } from "@/core/pluginState";
import { HeatmapColorModes } from "../defs/types";
import { CalculationType, TargetCount } from "../defs/types";
import { DailyActivity } from "@/db/types";
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
import { Vault } from "obsidian";

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
	baseDate?: Date, // <-- optional new parameter
): Date => {
	let date: Date;

	if (baseDate) {
		// Start from the provided base date (e.g., January 1st)
		date = new Date(baseDate);
		date.setDate(date.getDate() + weekIndex * 7 + dayIndex);
	} else {
		// Original behavior: calculate relative to today
		const today = new Date();
		date = new Date(today);

		const currentDayIndex = getDayIndex(date.getDay()); // Monday=0 etc
		date.setDate(date.getDate() - currentDayIndex);

		// Offset from the current week's Monday
		const weekOffset = weekIndex - (totalAmountOfWeeks - 1);
		date.setDate(date.getDate() + weekOffset * 7 + dayIndex);
	}

	return date;
};

export const getDayIndex = (dayIndex: number): number => {
	return dayIndex === 0 ? 6 : dayIndex - 1;
};

// function getRandomArbitrary(min, max) {
// 	return Math.random() * (max - min) + min;
// }

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
				total += dailyActivity?.charCountStart || 0;
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
	const wordCount = getLanguageBasedWordCount(
		fileContent,
		enabledLanguages,
		state.plugin.data.settings,
	);
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
			const nextDate = startDate.clone().add(1, "day");
			while (dateSet.has(nextDate.format("YYYY-MM-DD"))) {
				streak++;
				nextDate.add(1, "day");
			}
			longestStreak = Math.max(longestStreak, streak);
		}
	}

	const cursor = moment().startOf("day");
	if (!dateSet.has(cursor.format("YYYY-MM-DD"))) {
		// don't consider today, as the streak is not broken until the day ends
		cursor.subtract(1, "day");
	}
	while (dateSet.has(cursor.format("YYYY-MM-DD"))) {
		currentStreak++;
		cursor.subtract(1, "day");
	}

	return { longestStreak, currentStreak };
}

export function debounce<T extends (...args: unknown[]) => void>(
	func: T,
	delay: number,
): T {
	let timeoutId: number | null = null;

	return function (this: unknown, ...args: Parameters<T>) {
		if (timeoutId) window.clearTimeout(timeoutId);
		timeoutId = window.setTimeout(() => {
			func.apply(this, args);
		}, delay);
	} as unknown as T;
}

export async function getExistingActivity(file: TFile, date: string) {
	const existingActivity: DailyActivity | undefined = await getDB()
		.dailyActivity.where("[date+filePath]")
		.equals([date, file.path])
		.first();

	return existingActivity ? existingActivity : false;
}

export async function createActivityObject(file: TFile, date: string) {
	const content = await state.plugin.app.vault.read(file);

	return {
		date,
		filePath: file.path,
		wordCountStart: getLanguageBasedWordCount(
			content,
			state.plugin.data.settings.enabledLanguages,
			state.plugin.data.settings,
		),
		charCountStart: content.length,
		changes: [],
	};
}

export async function getExistingOrCreateNewEntry(
	file: TFile,
	date: string,
): Promise<DailyActivity> {
	const existing = await getExistingActivity(file, date);
	if (existing) return existing;

	const newActivity = await createActivityObject(file, date);

	try {
		const id = await getDB().dailyActivity.add(newActivity);
		return { ...newActivity, id: id };
	} catch (err) {
		// something inserted while still reading the file
		const raced = await getExistingActivity(file, date);
		if (raced) return raced;
		throw err;
	}
}

export function hashString(value: string): string {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash << 5) - hash + value.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

export function getVaultKey(vault: Vault): string {
	return (vault.adapter as unknown as { getResourcePath(p: string): string })
		.getResourcePath("")
		.split("?")[0];
}
