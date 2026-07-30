import { TargetCount } from "@/defs/types";
import { getCurrentCount } from "@/db/queries";
import { EVENTS, state } from "./pluginState";
import { TFile, Editor } from "obsidian";
import { getDB } from "../db/db";
import { DailyActivity } from "@/db/types";
import KeepTheRhythm from "../main";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { moment as _moment } from "obsidian";
import { getExistingOrCreateNewEntry, getTotalWords } from "@/utils/utils";
import { isPathTracked } from "./pathFilter";

const moment = _moment as unknown as typeof _moment.default;

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

async function ensureActivityExists(file: TFile) {
  if (!file || file.extension !== "md") return;
  if (!isPathTracked(file.path)) return;
  if (state.isUpdatingActivity) return;
  if (
    file.path == state.currentActivity?.filePath &&
    state.currentActivity?.date === state.today
  ) return;

  state.isUpdatingActivity = true;
  try {
    const entry = await getExistingOrCreateNewEntry(file, state.today);
    if (entry) state.setCurrentActivity(entry);
    state.emit(EVENTS.REFRESH_TODAY);
  } finally {
    state.isUpdatingActivity = false;
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
  if (
    !state.currentActivity ||
    state.currentActivity.filePath !== file.path ||
    state.currentActivity.date !== state.today
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
  let activity = state.currentActivity;

  /**
   * Handle mismatches between state and current opened file
   * Only happens if the user is editing stuff really really fast, some of those inputs might be ignored at the start.
   * But I think it's okay, there might just be a slight mismatch because of wordCountStart if the file wasn't seen today
   * */
  if (
    !activity ||
    activity?.filePath !== info.file.path ||
    activity?.date !== state.today
  ) {
    // Re-sync the activity when it's missing, points at a different file, or
    // is stale after a midnight rollover (Obsidian left open across days).
    // If handleFileOpen is not running (some weird focusing states), make it run and update the activity
    if (!state.isUpdatingActivity) {
      await handleFileOpen(info.file);
      activity = state.currentActivity;
    } else {
      return;
    }
  }

  if (!activity) return;

  /** Calculate WORD deltas based on state  */
  const currentContent = editor.getValue();

  const newWordCount = getLanguageBasedWordCount(
    currentContent,
    plugin.data.settings.enabledLanguages,
  );

  const totalWords = getTotalWords(activity);

  const wordsAdded = newWordCount - totalWords;

  activity.wordsAdded = (activity.wordsAdded || 0) + (wordsAdded || 0);

  state.emit(EVENTS.REFRESH_TODAY);

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
  state.isUpdatingActivity = true;

  /** Return if the file "opened" is the same that was seen last time
   *  AND its activity still belongs to the current day. After a midnight
   *  rollover we must fall through to rebuild today's entry. */
  if (
    file.path == state.currentActivity?.filePath &&
    state.currentActivity?.date === state.today
  ) {
    state.isUpdatingActivity = false;
    return;
  }

  const entry = await getExistingOrCreateNewEntry(file, state.today);
  if (entry) state.setCurrentActivity(entry);
  state.isUpdatingActivity = false;

  state.emit(EVENTS.REFRESH_TODAY);
}

/**
 * @function flushChangesToDB
 * Debounced function that matches the state to the DB entries;
 */
async function flushChangesToDB(activity: DailyActivity) {
  // TODO: use this globally, making all updates on info real time by using stores but flushing them to the DB ocasionally.
  // probably here is a good moment to update the STREAK data?

  /** Simple check if the day has passed to update everything if it did.*/
  //   const today = formatDate(new Date());
  //   if (today !== state.today) {
  //     state.setToday();
  //   }

  if (!activity) return;

  await getDB()
    .dailyActivity.where("[date+filePath]")
    .equals([activity.date, activity.filePath])
    .modify((dailyEntry) => {
      dailyEntry.wordsAdded = activity.wordsAdded;
    });

  checkStreak();
  state.emit(EVENTS.REFRESH_TODAY);
}

/**
 * @function cleanDBTimeout
 * Clears timeouts and flushes any in-memory data to the DB.
 * Must be awaited so all REFRESH_EVERYTHING / REFRESH_TODAY emissions
 * (and their debounced save timers) settle before the caller (onunload)
 * invalidates pending saves and clears the DB.
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
  await flushChangesToDB(state.currentActivity!);
}

/**
 * @function checkStreak
 */

async function checkStreak() {
  const writtenToday = await getCurrentCount(TargetCount.CURRENT_DAY);

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
  if (!file || file.extension !== "md") {
    return;
  }
  if (!isPathTracked(file.path)) {
    return;
  }
  try {
    await getDB()
      .dailyActivity.where("[date+filePath]")
      .equals([state.today, file.path])
      .modify((dailyEntry) => {
        // Reverse the entire day's delta so the file's contribution
        // to today's stats is zeroed out.
        dailyEntry.wordsAdded = -(dailyEntry.wordCountStart || 0);
      });

    state.emit(EVENTS.REFRESH_TODAY);
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
    // If the new path falls outside the tracking scope, drop any historical
    // activity for the old path instead of carrying it over.
    if (!isPathTracked(file.path)) {
      await getDB().dailyActivity.where("filePath").equals(oldPath).delete();
      state.emit(EVENTS.REFRESH_EVERYTHING);
      return;
    }

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
