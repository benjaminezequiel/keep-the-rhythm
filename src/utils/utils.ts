import { HeatmapColorModes } from "../defs/types";
import { CalculationType, TargetCount } from "../defs/types";
import { App } from "obsidian";
import { TFile } from "obsidian";
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

// Module-level cache keyed on the input array reference.  The streak
// only changes when daysWithCompletedGoal itself changes (checkPreviousStreak,
// updateStreak, hydrate), not on every keystroke — so a reference-keyed
// cache lets Slot components re-render without re-running this O(n log n)
// computation.  Without this, every typed word in a .md file would
// re-sort and re-walk the full completed-days array for any
// CURRENT_STREAK slot.
let _streakCache: {
	input: string[] | null;
	result: { longestStreak: number; currentStreak: number };
} = { input: null, result: { longestStreak: 0, currentStreak: 0 } };

export function getDateStreaks(dateStrings: string[]) {
	if (_streakCache.input === dateStrings) return _streakCache.result;

	if (dateStrings.length === 0) {
		_streakCache = {
			input: dateStrings,
			result: { longestStreak: 0, currentStreak: 0 },
		};
		return _streakCache.result;
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

	const result = { longestStreak, currentStreak };
	_streakCache = { input: dateStrings, result };
	return result;
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

