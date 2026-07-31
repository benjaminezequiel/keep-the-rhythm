import { TargetCount } from "@/defs/types";
import { getCurrentCount } from "@/db/queries";
import { useStore } from "./store";
import { TFile, Editor } from "obsidian";
import { getDB } from "../db/db";
import { DailyActivity } from "@/db/types";
import KeepTheRhythm from "../main";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { moment as _moment } from "obsidian";
import { getExistingOrCreateNewEntry, getTotalWords } from "@/utils/utils";
import { isPathTracked } from "./pathFilter";

const moment = _moment as unknown as typeof _moment.default;

// Module-level guard — replaces state.isUpdatingActivity.  Only used
// internally by events.ts to prevent re-entrant activity creation.
let isUpdatingActivity = false;

let dbUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_TIME = 100; // ms

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
    // If a new DB row was created, getExistingOrCreateNewEntry already
    // called requestPersist().  useLiveQuery in Slot/Entries will auto-
    // respond to the DB insert.  If the row already existed, no DB change
    // occurred — but we still swapped currentActivity in the store, so
    // Slot's useStore(s => s.currentActivity) selector fires automatically.
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

  // This only mutates the store's currentActivity (immutable update via
  // accumulateCurrentActivityWords). The DB is NOT updated yet — it's
  // flushed later via flushChangesToDB.  Slot's useStore selector for
  // currentActivity will auto-re-render.  No persist signal is needed
  // until the DB write actually happens.
  store().accumulateCurrentActivityWords(wordsAdded || 0);

  /** Debounces updates to the DB, which only happens when
   *  the user stops editing the page for 200ms. */
  if (dbUpdateTimeout) clearTimeout(dbUpdateTimeout);

  dbUpdateTimeout = setTimeout(async () => {
    await flushChangesToDB(store().currentActivity!);
  }, DEBOUNCE_TIME);
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

  // Same rationale as ensureActivityExists: getExistingOrCreateNewEntry
  // already handled events if a row was created; if the row already
  // existed we still need currentActivity swap to be seen by Slot —
  // which happens automatically via useStore selector.
}

/**
 * @function flushChangesToDB
 * Debounced function that matches the store to the DB entries;
 * DB write is the single source of truth for persistence, so we
 * always emit requestPersist together with the UI refresh here.
 */
async function flushChangesToDB(activity: DailyActivity) {
  if (!activity) return;

  await getDB()
    .dailyActivity.where("[date+filePath]")
    .equals([activity.date, activity.filePath])
    .modify((dailyEntry) => {
      dailyEntry.wordsAdded = activity.wordsAdded;
    });

  // DB write is done → request JSON persist.  useLiveQuery in Slot /
  // Entries will auto-respond to the DB mutation.
  checkStreak();
  store().requestPersist();
}

/**
 * @function cleanDBTimeout
 * Clears timeouts and flushes any in-memory data to the DB.
 * Must be awaited so all pending persist signals (and their debounced
 * save timers) settle before the caller (onunload) invalidates
 * pending saves and clears the DB.
 */
export async function cleanDBTimeout() {
  // Flush any pending editor-change sample so the final deltas land in the
  // activity before we flush it to the DB.
  if (editorChangeTimer) {
    clearTimeout(editorChangeTimer);
    editorChangeTimer = null;
    await runPendingEditorChange();
  }

  if (dbUpdateTimeout) {
    clearTimeout(dbUpdateTimeout);
  }
  await flushChangesToDB(store().currentActivity!);
}

/**
 * @function checkStreak
 */

async function checkStreak() {
  const writtenToday = await getCurrentCount(TargetCount.CURRENT_DAY);

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
 * persist.  useLiveQuery in Slot/Entries auto-responds to the DB mutation.
 */
export async function handleFileDelete(file: TFile) {
  if (!file || file.extension !== "md") {
    return;
  }
  if (!isPathTracked(file.path)) {
    return;
  }
  try {
    await getDB()
      .dailyActivity.where("[date+filePath]")
      .equals([store().today, file.path])
      .modify((dailyEntry) => {
        // Reverse the entire day's delta so the file's contribution
        // to today's stats is zeroed out.
        dailyEntry.wordsAdded = -(dailyEntry.wordCountStart || 0);
      });

    store().requestPersist();
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
 * useLiveQuery in Heatmap/Entries auto-responds to the DB mutation.
 */
export async function handleFileRename(file: TFile, oldPath: string) {
  try {
    // If the new path falls outside the tracking scope, drop any historical
    // activity for the old path instead of carrying it over.
    if (!isPathTracked(file.path)) {
      await getDB().dailyActivity.where("filePath").equals(oldPath).delete();
      store().requestPersist();
      return;
    }

    await getDB()
      .dailyActivity.where("filePath")
      .equals(oldPath)
      .modify((dailyEntry) => {
        dailyEntry.filePath = file.path;
      });

    store().requestPersist();
  } catch (error) {
    console.error(`KTR failed renaming ${file.path} | ${error}`);
  }
}
