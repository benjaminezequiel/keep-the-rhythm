import KeepTheRhythm from "../main";
import { TargetCount, Unit } from "@/defs/types";
import { getActivtityForFile, getCurrentCount } from "@/db/queries";
import { EVENTS, state } from "./pluginState";
import { getDB } from "../db/db";
import { DailyActivity, TimeEntry } from "@/db/types";
import { TFile, Editor, moment as _moment } from "obsidian";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { getCurrentTimeKey } from "@/utils/dateUtils";
import {
	takeDelta,
	resolveActivity,
	checkDayChange,
	forgetFile,
	getTrackedCounts,
} from "./activityTracker";
import { sumTimeEntries, upsertChange } from "@/utils/utils";
import { renameTrackedPath } from "./activityTracker";

let dbUpdateTimeout: number | null = null;
let pendingActivity: DailyActivity | null = null;
const DEBOUNCE_TIME = 100; // ms

/**
 * @function handleEditorChange
 * Fires everytime the user makes an input inside a Markdown editor;
 * Is not fired when focused file changes (file-open)
 */
export async function handleEditorChange(
	editor: Editor,
	info: any,
	plugin: KeepTheRhythm,
) {
	const file = info.file;
	if (!file || file.extension !== "md") return;

	checkDayChange();

	const content = editor.getValue();
	const counts = {
		words: getLanguageBasedWordCount(
			content,
			plugin.data.settings.enabledLanguages,
			plugin.data.settings,
		),
		chars: content.length,
	};

	const activity = await resolveActivity(file, counts);
	state.setCurrentActivity(activity);

	const { wordsAdded, charsAdded } = takeDelta(
		file,
		counts.words,
		counts.chars,
	);

	// const wordsAdded = newWordCount - totalWords;
	// const charsAdded = newCharCount - totalChars;

	if (state.plugin.data.stats && (wordsAdded !== 0 || charsAdded !== 0)) {
		if (state.plugin.data.stats.wholeVaultWordCount !== undefined) {
			state.plugin.data.stats.wholeVaultWordCount += wordsAdded;
		}
		if (state.plugin.data.stats.wholeVaultCharCount !== undefined) {
			state.plugin.data.stats.wholeVaultCharCount += charsAdded;
		}
	}

	/**
	 * @const lastTimeKey Get's last key saved for this DailyActivity
	 * @const currentTimeKey Rounds current time to multiples of 5 so data is saved in consistent blocks
	 * Uses floors so it always rounds down (since you can write words in the future rsrs)
	 */
	if (!activity.changes) activity.changes = [];
	const currentTimeKey = getCurrentTimeKey();
	const existing = activity.changes.find((e) => e.timeKey === currentTimeKey);

	if (existing) {
		existing.w += wordsAdded;
		existing.c += charsAdded;
	} else {
		activity.changes.push({
			timeKey: currentTimeKey,
			w: wordsAdded,
			c: charsAdded,
		});
	}

	// WORKING ON UPDATING JUST TODAY!!!
	state.emit(EVENTS.REFRESH_EVERYTHING);
	scheduleFlush(activity);
}

/**
 * @function handleFileOpen
 * - Updates the state to match the current opened file
 * - Creates an activity for the opened file if it doens't exist
 * - Checks if the day passed to update data (maybe should be somewhere else)
 */

export async function handleFileOpen(file: TFile) {
	if (!file || file.extension !== "md") {
		return;
	}
	checkDayChange();

	const activity = await resolveActivity(file);
	state.setCurrentActivity(activity);
	state.emit(EVENTS.REFRESH_EVERYTHING);
}

/**
 * @function flushChangesToDB
 * Debounced function that matches the state to the DB entries;
 */
async function flushChangesToDB(activity: DailyActivity) {
	// TODO: use this globally, making all updates on info real time by using stores but flushing them to the DB ocasionally.
	// probably here is a good moment to update the STREAK data?

	if (!activity?.filePath) return;

	await getDB()
		.dailyActivity.where("[date+filePath]")
		.equals([activity.date, activity.filePath])
		.modify((dailyEntry) => {
			const existingChanges: TimeEntry[] = dailyEntry.changes || [];
			const currentChanges: TimeEntry[] = activity.changes;

			// Convert existing changes to a map
			const mergedMap: Record<string, TimeEntry> = {};
			for (const entry of existingChanges) {
				mergedMap[entry.timeKey] = { ...entry };
			}

			for (const entry of currentChanges) {
				if (mergedMap[entry.timeKey]) {
					mergedMap[entry.timeKey].w = entry.w;
					mergedMap[entry.timeKey].c = entry.c;
				} else {
					mergedMap[entry.timeKey] = { ...entry };
				}
			}

			// Convert map back to array and sort by timeKey
			dailyEntry.changes = Object.values(mergedMap).sort((a, b) =>
				a.timeKey.localeCompare(b.timeKey),
			);
		});

	checkStreak();
	state.emit(EVENTS.REFRESH_EVERYTHING);
}

function scheduleFlush(activity: DailyActivity) {
	pendingActivity = activity;
	if (dbUpdateTimeout) window.clearTimeout(dbUpdateTimeout);
	dbUpdateTimeout = window.setTimeout(() => flushNow(), DEBOUNCE_TIME);
}

export async function flushNow() {
	if (dbUpdateTimeout) {
		window.clearTimeout(dbUpdateTimeout);
		dbUpdateTimeout = null;
	}
	const activity = pendingActivity;
	pendingActivity = null;
	if (activity) await flushChangesToDB(activity);
}

/**
 * @function checkStreak
 */

async function checkStreak() {
	const writtenToday = await getCurrentCount(
		Unit.WORD,
		TargetCount.CURRENT_DAY,
	);

	const goal = state.plugin.data?.settings?.dailyWritingGoal || 500;

	if (writtenToday >= goal) {
		state.plugin.updateCurrentStreak(true);
	} else {
		state.plugin.updateCurrentStreak(false);
	}
}

/**
s * Should probably just get the fileWordCount and consider it as delta in it's dailyActivity?
 */
export async function handleFileDelete(file: TFile) {
	if (!file || file.extension !== "md") {
		return;
	}

	try {
		await flushNow();

		const counts = getTrackedCounts(file.path); // before forgetting
		const existing = await getActivtityForFile(state.today, file.path);
		const timeKey = getCurrentTimeKey();

		const words =
			counts?.words ??
			(existing ? sumTimeEntries(existing, Unit.WORD, false) : 0);
		const chars =
			counts?.chars ??
			(existing ? sumTimeEntries(existing, Unit.CHAR, false) : 0);

		const change = { timeKey, w: -words, c: -chars };

		if (existing) {
			await getDB()
				.dailyActivity.where("[date+filePath]")
				.equals([state.today, file.path])
				.modify((row) => {
					row.changes = upsertChange(row.changes ?? [], change);
				});
		} else if (words !== 0 || chars !== 0) {
			await getDB().dailyActivity.add({
				date: state.today,
				filePath: file.path,
				wordCountStart: 0,
				charCountStart: 0,
				changes: [change],
			});
		}

		forgetFile(file.path);
		if (state.currentActivity?.filePath === file.path)
			state.setCurrentActivity(null);
		state.emit(EVENTS.REFRESH_EVERYTHING);
	} catch (error) {
		console.error(`KTR failed deleting ${file.path} | ${error}`);
	}
}

/**
 * @function handleFileRename
 * Update all references to this file to match new filepath
 */
export async function handleFileRename(file: TFile, oldPath: string) {
	try {
		await flushNow();
		await getDB()
			.dailyActivity.where("filePath")
			.equals(oldPath)
			.modify((dailyEntry) => {
				dailyEntry.filePath = file.path;
			});

		renameTrackedPath(oldPath, file.path);

		state.emit(EVENTS.REFRESH_EVERYTHING);
	} catch (error) {
		console.error(`KTR failed renaming ${file.path} | ${error}`);
	}
}
