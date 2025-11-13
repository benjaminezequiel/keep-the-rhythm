import { Unit } from "@/defs/types";
import { TargetCount } from "@/defs/types";
import { deleteActivityById, getCurrentCount } from "@/db/queries";
import { EVENTS, state } from "./pluginState";
import { TFile, Editor } from "obsidian";
import { getDB } from "../db/db";
import { DailyActivity, TimeEntry } from "@/db/types";
import KeepTheRhythm from "../main";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { formatDate } from "@/utils/dateUtils";
import { floorMomentToFive } from "@/utils/dateUtils";
import { moment as _moment } from "obsidian";
import { emit } from "process";
import { sumBothTimeEntries } from "@/utils/utils";

const moment = _moment as unknown as typeof _moment.default;

let dbUpdateTimeout: NodeJS.Timeout | null = null;
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

	if (!file || file.extension !== "md") {
		return;
	}

	/** Exclude file from updating today's wordcount */
	var exclude = false;
	await state.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (frontmatter['ktrExclude']) {
			exclude = true;
		}
	});
	if (exclude) {
		return;
	}

	let activity = state.currentActivity;

	/**
	 * Handle mismatches between state and current opened file
	 * Only happens if the user is editing stuff really really fast, some of those inputs might be ignored at the start.
	 * But I think it's okay, there might just be a slight mismatch because of wordCountStart if the file wasn't seen today
	 * */
	if (!activity || activity?.filePath !== info.file.path) {
		// If handleFileOpen is not running (some weird focusing states), make it run and update the activity
		if (!state.isUpdatingActivity) {
			await handleFileOpen(info.file);
			activity = state.currentActivity;
		} else {
			return;
		}
	}

	if (!activity) return;

	/** Calculate CHAR and WORD deltas based on state  */
	const currentContent = editor.getValue();

	const newWordCount = getLanguageBasedWordCount(
		currentContent,
		plugin.data.settings.enabledLanguages,
	);
	const newCharCount = currentContent.length;

	/**
	 * Calculates delta word count based on
	 * @var wordCountStart: amount of words the file started at the first time it was opened
	 * @var prevWordsAdded: amount of words written today (added across changes[])
	 * @var newWordCount: current amount of words in the file
	 */
	const { totalWords, totalChars } = sumBothTimeEntries(activity);

	const wordsAdded = newWordCount - totalWords;
	const charsAdded = newCharCount - totalChars;

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
	const changes: TimeEntry[] = state.currentActivity?.changes || [];
	const currentTimeKey = floorMomentToFive(moment()).format("HH:mm");

	/**
	 * Check if there is already a time key (HH:mm) for a change, create one if there isn't
	 * Time keys are added in blocks of 5 minutes and snap to the nearest time
	 */

	const existingEntry = changes.find(
		(entry) => entry.timeKey === currentTimeKey,
	);

	if (!existingEntry) {
		// No entry yet for this timeKey, so push a new one
		changes.push({
			timeKey: currentTimeKey,
			w: wordsAdded || 0,
			c: charsAdded || 0,
		});
	} else {
		// Entry exists, so update the word and char count
		existingEntry.w += wordsAdded;
		existingEntry.c += charsAdded;
	}

	// WORKING ON UPDATING JUST TODAY!!!
	state.emit(EVENTS.REFRESH_EVERYTHING);

	/** Debounces updates to the DB, which only happens when
	 *  the user stops editing the page for 200ms. */
	if (dbUpdateTimeout) clearTimeout(dbUpdateTimeout);

	dbUpdateTimeout = setTimeout(async () => {
		await flushChangesToDB(state.currentActivity!);
	}, DEBOUNCE_TIME);
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
	state.isUpdatingActivity = true;
	/** Simple check if the day has passed to update everything if it did.*/
	const today = formatDate(new Date());
	if (today !== state.today) {
		state.setToday();
	}

	/** Return if the file "opened" is the same that was seen last time. */
	if (file.path == state.currentActivity?.filePath) {
		return;
	}

	let entry = await getDB()
		.dailyActivity.where("[date+filePath]")
		.equals([state.today, file.path])
		.first();

	/** File was not yet seen today, create an entry for it */
	if (!entry) {
		const content = await state.plugin.app.vault.read(file);
		const currentWordCount = getLanguageBasedWordCount(
			content,
			state.plugin.data.settings.enabledLanguages,
		);

		entry = {
			date: state.today,
			filePath: file.path,
			wordCountStart: currentWordCount,
			charCountStart: content.length,
			changes: [],
		};

		await getDB().dailyActivity.add(entry);
	}

	if (entry) {
		/** Remove entry from DB if file should be excluded, otherwise update DB */
		var exclude = false;
		await state.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (frontmatter['ktrExclude']) {
				exclude = true;
			}
		});
		if (exclude) {
			deleteActivityById(entry.id);
		} else {
			state.setCurrentActivity(entry);
		}
		
	}
	state.isUpdatingActivity = false;

	state.emit(EVENTS.REFRESH_EVERYTHING);
}

/**
 * @function flushChangesToDB
 * Debounced function that matches the state to the DB entries;
 */
async function flushChangesToDB(activity: DailyActivity) {
	// TODO: use this globally, making all updates on info real time by using stores but flushing them to the DB ocasionally.
	// probably here is a good moment to update the STREAK data?

	if (!activity) return;

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

/**
 * @function cleanDBTimeout
 * Clears timeouts and flushed any data on memory to the DB
 */
export function cleanDBTimeout() {
	if (dbUpdateTimeout) {
		clearTimeout(dbUpdateTimeout);
	}
	flushChangesToDB(state.currentActivity!);
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
 * @function handleFileDelete
 * Should probably just get the fileWordCount and consider it as delta in it's dailyActivity?
 */
export async function handleFileDelete(file: TFile) {
	// Add this check at the beginning
	if (!file || file.extension !== "md") {
		return;
	}
	//FUTURE: correct file delta is only calculated if the user opens the file first
	// if he doesnt there is no daily activity to get the current file count and it will not consider that into the calculations
	try {
		await getDB()
			.dailyActivity.where("[date+filePath]")
			.equals([state.today, file.path])
			.modify((dailyEntry) => {
				let wordSum = 0;
				let charSum = 0;

				const currentTimeKey =
					floorMomentToFive(moment()).format("HH:mm");

				/** If no changed was made to the file
				 *  Then the delta is just the word count when it was opened
				 */

				if (!dailyEntry.changes || dailyEntry.changes?.length == 0) {
					dailyEntry.changes.push({
						timeKey: currentTimeKey,
						w: -dailyEntry.wordCountStart,
						c: -dailyEntry.charCountStart,
					});
					return;
				}

				/** If there where changes made,
				 *  We need to sum those changes
				 *  The last change is only included if it's timekey isn't the current one
				 */
				// Get the last change (if any)
				const lastEntry =
					dailyEntry.changes[dailyEntry.changes.length - 1];
				const lastTimeKey = lastEntry?.timeKey;

				for (let i = 0; i < dailyEntry.changes.length - 1; i++) {
					wordSum += dailyEntry.changes[i].w;
					charSum += dailyEntry.changes[i].c;
				}

				// If lastTimeKey is not the same as current, include it
				if (lastEntry && lastTimeKey !== currentTimeKey) {
					wordSum += lastEntry.w;
					charSum += lastEntry.c;
				}

				const newEntry: TimeEntry = {
					timeKey: currentTimeKey,
					w: -(wordSum + dailyEntry.wordCountStart),
					c: -(charSum + dailyEntry.charCountStart),
				};

				// Find and update the existing entry if it exists
				const existingIndex = dailyEntry.changes.findIndex(
					(e) => e.timeKey === currentTimeKey,
				);

				if (existingIndex !== -1) {
					dailyEntry.changes[existingIndex] = newEntry;
				} else {
					dailyEntry.changes.push(newEntry);
				}
			});

		state.emit(EVENTS.REFRESH_EVERYTHING);
	} catch (error) {
		console.error(`KTR failed deleting ${file.path} | ${error}`);
	}
}

/**
 * @function handleFileCreate
 * - Add file to FileStats table?
 */
export function handleFileCreate(file: TFile) {}

/**
 * @function handleFileRename
 * Update all references to this file to match new filepath
 */
export async function handleFileRename(file: TFile, oldPath: string) {
	try {
		await getDB()
			.dailyActivity.where("filePath")
			.equals(oldPath)
			.modify((dailyEntry) => {
				dailyEntry.filePath = file.path;
			});

		state.emit(EVENTS.REFRESH_EVERYTHING);
	} catch (error) {
		console.error(`KTR failed renaming ${file.path} | ${error}`);
	}
}
