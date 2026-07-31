import { TargetCount } from "@/defs/types";
import { getCurrentCount } from "@/core/dataQueries";
import { useStore } from "./store";
import { TFile, Editor } from "obsidian";
import KeepTheRhythm from "../main";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { getExistingOrCreateNewEntry, getTotalWords } from "@/utils/utils";
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
let pendingPlugin: KeepTheRhythm | null = null;

// Convenience accessor — avoids importing useStore directly in every function.
const store = () => useStore.getState();

async function ensureActivityExists(file: TFile) {
  if (!file || file.extension !== "md") return;
  if (!isPathTracked(file.path)) return;
  if (isUpdatingActivity) return;
  if (
		file.path == store().currentActivity?.filePath &&
		store().currentActivity?.date === store().today
	) return;

	isUpdatingActivity = true;
	try {
		const entry = await getExistingOrCreateNewEntry(file, store().today);
		if (entry) store().setCurrentActivity(entry);
		// getExistingOrCreateNewEntry handled persist if a row was created;
		// setCurrentActivity re-derives from the array (or no-ops if the row
		// already exists).  Either way, Slot's useStore(s => s.currentActivity)
		// selector fires automatically.
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
	plugin: KeepTheRhythm,
) {
	const file = info.file;

	if (!file || file.extension !== "md") {
		return;
	}

	// Respect the global tracking-scope filter: ignore edits to files outside
	// the configured folders so they don't pollute daily stats or streaks.
	if (!isPathTracked(file.path)) {
		return;
	}

	// Eagerly create the activity entry if it doesn't exist, so that
	// wordCountStart is captured from disk before auto-save can write
	// the current edits. This ensures the debounced delta calculation
	// in processEditorChange has a correct baseline.
	const currentActivity = store().currentActivity;
	const today = store().today;
	if (
		!currentActivity ||
		currentActivity.filePath !== file.path ||
		currentActivity.date !== today
	) {
		ensureActivityExists(file);
	}

	// Stash the latest references and re-schedule the sample. Repeated
	// keystrokes within the delay window keep cancelling the timer, so only
	// the most recent editor state is sampled.
	pendingEditor = editor;
	pendingInfo = info;
	pendingPlugin = plugin;

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

async function runPendingEditorChange(): Promise<void> {
	const editor = pendingEditor;
	const info = pendingInfo;
	const plugin = pendingPlugin;
	pendingEditor = null;
	pendingInfo = null;
	pendingPlugin = null;
	if (!editor || !info || !plugin) return;
	await processEditorChange(editor, info, plugin);
}

/**
 * @function processEditorChange
 * Reads the current editor content, computes word/char deltas against the
 * activity's running totals, and accumulates them. Called from the debounce
 * timer (via handleEditorChange) or synchronously flushed on file switch /
 * unload.
 */
async function processEditorChange(
	editor: Editor,
	info: any,
	plugin: KeepTheRhythm,
) {
	let activity = store().currentActivity;

	/**
	 * Handle mismatches between store and current opened file
	 * Only happens if the user is editing stuff really really fast, some of those inputs might be ignored at the start.
	 * But I think it's okay, there might just be a slight mismatch because of wordCountStart if the file wasn't seen today
	 * */
	if (
		!activity ||
		activity?.filePath !== info.file.path ||
		activity?.date !== store().today
	) {
		// Re-sync the activity when it's missing, points at a different file, or
		// is stale after a midnight rollover (Obsidian left open across days).
		// If handleFileOpen is not running (some weird focusing states), make it run and update the activity
		if (!isUpdatingActivity) {
			await handleFileOpen(info.file);
			activity = store().currentActivity;
		} else {
			return;
		}
	}

	if (!activity) return;

	/** Calculate WORD deltas based on store  */
	const currentContent = editor.getValue();

	const newWordCount = getLanguageBasedWordCount(
		currentContent,
		plugin.data.settings.enabledLanguages,
	);

	const totalWords = getTotalWords(activity);

	const wordsAdded = newWordCount - totalWords;

	// accumulateCurrentActivityWords delegates to modifyActivity which
	// mutates the in-memory store and calls requestPersist.  The store's
	// rAF coalescing + the 1s debounce in setupPersistenceScheduling
	// absorb keystroke storms into a single JSON save.
	store().accumulateCurrentActivityWords(wordsAdded || 0);
}

/**
 * @function handleFileOpen
 * - Updates the store to match the current opened file
 * - Creates an activity for the opened file if it doens't exist
 * - Checks if the day passed to update data (maybe should be somewhere else)
 */

export async function handleFileOpen(file: TFile) {
	// Flush any pending sample for the previous file before switching
	// context, otherwise its deltas could be recorded against the new file.
	await flushPendingEditorChange();

	if (!file || file.extension !== "md") {
		return;
	}
	// Don't create activity entries for files outside the tracking scope.
	if (!isPathTracked(file.path)) {
		return;
	}
	isUpdatingActivity = true;

	/** Return if the file "opened" is the same that was seen last time
	 *  AND its activity still belongs to the current day. After a midnight
	 *  rollover we must fall through to rebuild today's entry. */
	if (
		file.path == store().currentActivity?.filePath &&
		store().currentActivity?.date === store().today
	) {
		isUpdatingActivity = false;
		return;
	}

	const entry = await getExistingOrCreateNewEntry(file, store().today);
	if (entry) store().setCurrentActivity(entry);
	isUpdatingActivity = false;
}

/**
 * @function cleanDBTimeout
 * Clears timeouts and flushes any in-memory pending state.
 * Must be awaited so the in-memory store is fully settled before
 * the caller (onunload) reads from it for the final JSON save.
 */
export async function cleanDBTimeout() {
	// Flush any pending editor-change sample so the final deltas land in
	// the activity before we let the unload handler snapshot the store.
	if (editorChangeTimer) {
		clearTimeout(editorChangeTimer);
		editorChangeTimer = null;
		await runPendingEditorChange();
	}

	// accumulateCurrentActivityWords already mutates the store
	// synchronously, so there is no debounced DB write to flush.  Kept as
	// an explicit no-op step in case a future debounced in-memory write
	// is reintroduced.
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
 * Zeroes out today's contribution from the deleted file, then requests
 * persist.  Store selectors in Slot/Entries auto-respond to the mutation.
 */
export function handleFileDelete(file: TFile) {
	if (!file || file.extension !== "md") {
		return;
	}
	if (!isPathTracked(file.path)) {
		return;
	}
	try {
		store().modifyActivity(store().today, file.path, (row) => {
			// Reverse the entire day's delta so the file's contribution
			// to today's stats is zeroed out.
			row.wordsAdded = -(row.wordCountStart || 0);
		});
		// modifyActivity already calls requestPersist.

		// Re-check streak in case the delete drops today's total below the goal.
		checkStreak();
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
 * Update all references to this file to match new filepath.
 * Store selectors in Heatmap/Entries auto-respond to the mutation.
 */
export function handleFileRename(file: TFile, oldPath: string) {
  try {
    // If the new path falls outside the tracking scope, drop any historical
		// activity for the old path instead of carrying it over.
		if (!isPathTracked(file.path)) {
			store().deleteByFilePath(oldPath);
			return;
		}

		store().renameFilePath(oldPath, file.path);
	} catch (error) {
		console.error(`KTR failed renaming ${file.path} | ${error}`);
	}
}
