import { useStore } from "./store";
import {
	TFile,
	Editor,
	WorkspaceLeaf,
	MarkdownView,
	type MarkdownFileInfo,
} from "obsidian";
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

let editorChangeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingEditor: Editor | null = null;
type FileChangeInfo = MarkdownView | MarkdownFileInfo;
let pendingInfo: FileChangeInfo | null = null;

// Convenience accessor — avoids importing useStore directly in every function.
const store = () => useStore.getState();

function getEditorChangeDelayMs(): number {
	let delay = Math.max(store().settings.editorChangeSampleDelay ?? 2, 0.5);
	return delay * 1000;
}

// A file is "live" — already set up this session — iff today's row AND
// its baseline exist.  Unlike a pointer to the "current file", this is
// derived directly from the data, so the guard naturally re-fires after a
// midnight rollover (new `today` key has no rows yet) or an external sync
// that deleted the row / baseline. No separate pointer to invalidate.
function isFileLive(file: TFile): boolean {
	const cur = store();
	const day = cur.days[cur.today];
	if (!day || !(file.path in day)) return false;
	return cur.todayBaselines[file.path] !== undefined;
}

// This handles file switches and midnight rollovers.
async function ensureActivityExists(file: TFile, liveContent?: string) {
	if (isUpdatingActivity) return;
	if (isFileLive(file)) return;

	isUpdatingActivity = true;
	try {
		await flushPendingEditorChange();
		await getExistingOrCreateNewEntry(file, store().today, liveContent);
	} finally {
		isUpdatingActivity = false;
	}
}

/**
 * @function handleFileOpen
 * Fires on file-open / focus switch (active-leaf-change).  Captures today's
 * baseline from the *live editor content* — not the vault — so the first
 * keystrokes are anchored against a value that can't race a stale disk
 * cache.  Also creates today's 0-word row, so the first keystroke then
 * short-circuits via isFileLive and skips the disk read on the typing path.
 * Guarded by isFileLive → runs at most once per file per day.
 */
export async function handleFileOpen(leaf: WorkspaceLeaf | null) {
	// Drain any debounced sample from the *previously* focused leaf before
	// doing anything with the new one. A focus switch is the natural flush
	// boundary (cheap O(1) when no sample is pending) — without it, the last
	// characters typed in an already-live file would stay unsampled after
	// switching to another live file, and if never re-touched they'd be
	// permanently under-counted.
	await flushPendingEditorChange();

	if (!leaf || !(leaf.view instanceof MarkdownView)) return;
	const file = leaf.view.file;
	if (!file || file.extension !== "md") return;
	if (!isPathTracked(file.path)) return;

	// O(1) guards: files that are already live — and in-flight creations —
	// skip the whole read, so plain focus switches on tracked files cost
	// nothing (no `getValue()` document stringification).
	if (isFileLive(file) || isUpdatingActivity) return;

	// Freeze the content at the exact focus instant, before the first await.
	// Reading it inside ensureActivityExists would happen after flushing the
	// previous file's pending debounce, letting keystrokes made meanwhile
	// leak into the baseline and silently swallow those first words.
	const liveContent = leaf.view.editor?.getValue();
	await ensureActivityExists(file, liveContent);
}

/**
 * @function handleEditorChange
 * Fires everytime the user makes an input inside a Markdown editor;
 * Is not fired when focused file changes (file-open)
 */
export async function handleEditorChange(
	editor: Editor,
	info: FileChangeInfo,
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
	const delayMs = getEditorChangeDelayMs();
	editorChangeTimer = setTimeout(() => {
		editorChangeTimer = null;
		void runPendingEditorChange();
	}, delayMs);
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

	const filePath = info.file?.path;
	if (!filePath) return;

	try {
		const cur = store();

		// The pending sample belongs to the file it was captured from
		// (info.file), not to whatever is "current" now — this stays correct
		// even if the user switched files since the debounce was armed.
		// Today's row for this file.  It lives in two maps:
		// days[today] (running total) and todayBaselines (starting count the
		// delta is measured against).
		const day = cur.days[cur.today];
		if (!day || !(filePath in day)) return;
		const baseline = cur.todayBaselines[filePath];
		if (baseline === undefined) return;

		const newWordCount = getLanguageBasedWordCount(
			editor.getValue(),
			cur.settings?.enabledLanguages,
		);

		// Clamp to ≥ 0: undo/shrink below the baseline means this session
		// contributed nothing new, never a negative "added".
		cur.upsertAdded(cur.today, filePath, Math.max(0, newWordCount - baseline));
	} catch (error) {
		// The user may have closed the tab (and disposed its editor) since
		// this sample was armed; swallowing the failure keeps one dead
		// editor from tearing down subsequent scheduling.
		console.error(`KTR failed sampling ${filePath} | ${error}`);
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
		// previous days is preserved.
		store().deleteActivity(store().today, file.path);

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
