import KeepTheRhythm from "../main";
import { TargetCount, Unit } from "@/defs/types";
import { getActivtityForFile, getCurrentCount } from "@/db/queries";
import { EVENTS, state } from "./pluginState";
import { getDB } from "../db/db";
import { DailyActivity, TimeEntry } from "@/db/types";
import { TFile, Editor, MarkdownView, MarkdownFileInfo, debounce } from "obsidian";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { getCurrentTimeKey } from "@/utils/dateUtils";
import {
	takeDelta,
	resolveActivity,
	checkDayChange,
	forgetFile,
	getTrackedCounts,
} from "./activityTracker";
import { sumTimeEntries } from "@/utils/utils";
import { renameTrackedPath } from "./activityTracker";

// 500 ms: longer than normal between-keystroke/word pauses, so there is no
// refresh while actively typing, yet short enough that stats are already
// updated once you pause.
const DEBOUNCE_TIME = 500; // ms

/**
 * @function handleEditorChange
 * Fires on every input inside a Markdown editor (not on file-open).
 *
 * Each keystroke only copies content into a per-file pending map; the
 * expensive recount + DB write + refresh runs debounced, once per typing
 * pause. flushNow() drains immediately on unload, delete and rename.
 */
export function handleEditorChange(
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo,
	plugin: KeepTheRhythm,
) {
	const file = info.file;
	if (!file || file.extension !== "md") return;

	// Per-keystroke work is only this string copy — no counting, no DB, no render.
	pendingEdits.set(file.path, {
		content: editor.getValue(),
		file,
		plugin,
	});
	drainPendingEdits();
}

type PendingEdit = {
	content: string;
	file: TFile;
	plugin: KeepTheRhythm;
};

const pendingEdits = new Map<string, PendingEdit>();

/** One drain per typing pause, processing every file with pending edits. */
const drainPendingEdits = debounce(drainPendingEditsImpl, DEBOUNCE_TIME, true);

/** Promise of the drain currently executing, so flushNow() can join it. */
let drainPromise: Promise<void> | null = null;

async function drainPendingEditsImpl(): Promise<void> {
	// Join instead of racing: flushNow() callers (delete, rename, unload)
	// must observe the drain's writes before touching the same DB rows.
	if (drainPromise) return drainPromise;

	drainPromise = (async () => {
		// Loop so entries captured mid-drain are flushed by this same run.
		while (pendingEdits.size > 0) {
			const batch = [...pendingEdits.values()];
			pendingEdits.clear();
			for (const edit of batch) {
				await processEdit(edit);
			}
		}
	})().finally(() => {
		drainPromise = null;
	});

	return drainPromise;
}

async function processEdit({
	content,
	file,
	plugin,
}: PendingEdit) {
	checkDayChange();

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

	// Nothing changed → no zero-entry pollution, no DB write, no refresh.
	if (wordsAdded === 0 && charsAdded === 0) return;

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

	await flushChangesToDB(activity);
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

	void checkStreak();
	state.emit(EVENTS.REFRESH_EVERYTHING);
}

export async function flushNow() {
	await drainPendingEdits.run();
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
		void state.plugin.updateCurrentStreak(true);
	} else {
		void state.plugin.updateCurrentStreak(false);
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

		if (!state.plugin.data.settings.ignoreDeletedFiles) {
			const change = { timeKey, w: -words, c: -chars };

			if (existing) {
				await getDB()
					.dailyActivity.where("[date+filePath]")
					.equals([state.today, file.path])
					.modify((row) => {
						row.changes = [...(row.changes ?? []), change];
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
