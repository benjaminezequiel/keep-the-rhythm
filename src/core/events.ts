import { TargetCount } from "@/defs/types";
import { getCurrentCount } from "@/core/dataQueries";
import { useStore } from "./store";
import { TFile, Editor } from "obsidian";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { getExistingOrCreateNewEntry } from "@/core/dataQueries";
import { isPathTracked } from "./pathFilter";

// Module-level guard — replaces state.isUpdatingActivity.  Only used
// internally by events.ts to prevent re-entrant activity creation.
let isUpdatingActivity = false;

/**
 * Debounce window for sampling the editor content. Instead of running a
 * full-document word count on every keystroke, we wait until the user
 * stops typing for this long before reading the editor and computing
 * deltas. The final numbers stay accurate because `changes` are cumulative
 * deltas; only the live sidebar slot may lag by a couple of seconds.
 *
 * No maxWait is applied: continuous typing simply keeps deferring the
 * sample until the next natural pause. Pending samples are flushed on
 * file switch and on unload so no deltas are lost.
 */
const EDITOR_CHANGE_SAMPLE_DELAY = 2000; // ms

let editorChangeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingEditor: Editor | null = null;
let pendingInfo: any = null;

// Convenience accessor — avoids importing useStore directly in every function.
const store = () => useStore.getState();

// This handles file switches and midnight rollovers.
async function ensureActivityExists(file: TFile) {
  if (isUpdatingActivity) return;
  if (
		file.path == store().currentActivity?.filePath &&
		store().currentActivity?.date === store().today
	) return;

	isUpdatingActivity = true;
	try {
		await flushPendingEditorChange();
		
		const entry = await getExistingOrCreateNewEntry(file, store().today);
		store().setCurrentActivity(entry);
	} finally {
		isUpdatingActivity = false;
	}
}

/**
 * @function handleEditorChange
 * Fires everytime the user makes an input inside a Markdown editor;
 * Is not fired when focused file changes (file-open)
 */
export async function handleEditorChange(
	editor: Editor,
	info: any,
) {
	const file = info.file;
	if (!file || file.extension !== "md") {
		return;
	}
	if (!isPathTracked(file.path)) {
		return;
	}

	await ensureActivityExists(file);

	// Stash the latest references and re-schedule the sample. Repeated
	// keystrokes within the delay window keep cancelling the timer, so only
	// the most recent editor state is sampled.
	pendingEditor = editor;
	pendingInfo = info;

	if (editorChangeTimer) clearTimeout(editorChangeTimer);
	editorChangeTimer = setTimeout(() => {
		editorChangeTimer = null;
		void runPendingEditorChange();
	}, EDITOR_CHANGE_SAMPLE_DELAY);
}

/**
 * Immediately processes any pending debounced editor-change sample.
 * Awaits completion so callers (file-open, unload) can be sure the previous
 * file's deltas have been recorded before switching context.
 */
export async function flushPendingEditorChange(): Promise<void> {
	if (!editorChangeTimer) return;
	clearTimeout(editorChangeTimer);
	editorChangeTimer = null;
	await runPendingEditorChange();
}

/**
 * Reads the current editor content, computes word/char deltas against the
 * activity's running totals, and accumulates them. Called from the debounce
 * timer (via handleEditorChange) or synchronously flushed on file switch /
 * unload.
 */
async function runPendingEditorChange(): Promise<void> {
	const editor = pendingEditor;
	const info = pendingInfo;
	pendingEditor = null;
	pendingInfo = null;
	if (!editor || !info) return;

	const activity = store().currentActivity;
	if (!activity) return;

	const newWordCount = getLanguageBasedWordCount(
		editor.getValue(),
		store().settings?.enabledLanguages,
	);

	activity.wordsAdded = newWordCount - activity.wordCountStart;

	store().upsertActivity(activity);
}

/**
 * @function checkStreak
 */
function checkStreak() {
	const writtenToday = getCurrentCount(TargetCount.CURRENT_DAY);

	const goal = store().settings?.dailyWritingGoal || 500;

	if (writtenToday >= goal) {
		store().updateStreak(true);
	} else {
		store().updateStreak(false);
	}
}

/**
 * @function handleFileDelete
 * Removes today's activity record for the deleted file (if any), preserving
 * historical data from other days.  Re-checks the streak in case today's
 * total drops below the goal.
 */
export function handleFileDelete(file: TFile) {
	if (!file || file.extension !== "md") {
		return;
	}
	if (!isPathTracked(file.path)) {
		return;
	}
	try {
		// Only remove today's record for this file — historical data from
		// previous days is preserved.  deleteActivity also nulls
		// currentActivity if it matched and calls requestPersist.
		store().deleteActivity(store().today, file.path);

		// Re-check streak in case the delete drops today's total below the goal.
		checkStreak();
	} catch (error) {
		console.error(`KTR failed deleting ${file.path} | ${error}`);
	}
}

/**
 * @function handleFileRename
 * Update all references to this file to match new filepath.
 * Store selectors in Heatmap/Entries auto-respond to the mutation.
 */
export function handleFileRename(file: TFile, oldPath: string) {
	// Skip non-markdown files — we only track .md activity.
	if (!file || file.extension !== "md") {
		return;
	}

	try {
		// Always update the path so historical data follows the file,
		// even if the file moves in/out of the tracking scope.
		// Query-time filtering via isPathTracked ensures out-of-scope files
		// don't contribute to stats.
		store().renameFilePath(oldPath, file.path);
	} catch (error) {
		console.error(`KTR failed renaming ${file.path} | ${error}`);
	}
}
