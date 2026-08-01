import { HeatmapColorModes } from "../defs/types";
import { CalculationType, TargetCount } from "../defs/types";
import { App } from "obsidian";
import { Language } from "../defs/types";
import KeepTheRhythm from "../main";
import { TFile } from "obsidian";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { MarkdownView } from "obsidian";
import { WorkspaceLeaf } from "obsidian";

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



// function getRandomArbitrary(min, max) {
// 	return Math.random() * (max - min) + min;
// }

export function getRandomInt(min: number, max: number) {
	const minCeiled = Math.ceil(min);
	const maxFloored = Math.floor(max);
	return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled);
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
	if (dateStrings.length === 0) {
		return { longestStreak: 0, currentStreak: 0 };
	}

	const sortedDates = [...new Set(dateStrings)].sort();

	const fmt = (d: Date) =>
		d.getFullYear() +
		"-" +
		String(d.getMonth() + 1).padStart(2, "0") +
		"-" +
		String(d.getDate()).padStart(2, "0");

	// Longest streak: single O(n) pass through sorted dates
	// Compare calendar days (not raw timestamps) to be DST-safe
	let longestStreak = 1;
	let streak = 1;
	const prevDate = new Date(sortedDates[0] + "T00:00:00");

	for (let i = 1; i < sortedDates.length; i++) {
		prevDate.setDate(prevDate.getDate() + 1);
		if (fmt(prevDate) === sortedDates[i]) {
			streak++;
		} else {
			longestStreak = Math.max(longestStreak, streak);
			streak = 1;
			prevDate.setTime(
				new Date(sortedDates[i] + "T00:00:00").getTime(),
			);
		}
	}
	longestStreak = Math.max(longestStreak, streak);

	// Current streak: count backward from today
	let currentStreak = 0;
	const dateSet = new Set(dateStrings);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	while (dateSet.has(fmt(today))) {
		currentStreak++;
		today.setDate(today.getDate() - 1);
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

