import { DailyActivity } from "@/db/types";
import { formatDate } from "@/utils/dateUtils";
import KeepTheRhythm from "@/main";
import { App } from "obsidian";

type Listener = (...args: any[]) => void;

export const EVENTS = {
  /****************************************************************************
   * New granular events (use these; legacy REFRESH_* below are deprecated)
   ****************************************************************************/

  /**
   * DB-backed activity data has been mutated and must be persisted to
   * data.json. This is the ONLY event the main JSON-save pipeline listens
   * to; the debounced saveDataToJSON reads the whole DB and snapshots it.
   *
   * Always emit this AFTER the IndexedDB write has resolved (not when only
   * in-memory state changed), so saveDataToJSON sees consistent data.
   */
  DATA_PERSIST_NEEDED: "DATA_PERSIST_NEEDED",

  /**
   * Only TODAY's activity records changed — word deltas, new activity for
   * today's files, today's file deletion (zeroing out the day's delta),
   * or flushChangesToDB for the current activity.  Listeners that only
   * display today's data (Slot's CURRENT_DAY progress, today's Entries
   * list) should re-read from state / DB on this event.
   *
   * Always paired with DATA_PERSIST_NEEDED (the two are emitted together
   * by callers that mutate today's DB rows).
   */
  TODAY_DATA_CHANGED: "TODAY_DATA_CHANGED",

  /**
   * NON-TODAY (historical) records changed — file rename (all rows'
   * filePath updates), file moved out of tracking scope (historical rows
   * deleted), arbitrary-date deleteActivityFromDate, manual entry for a
   * past date, or streak/daysWithCompletedGoal mutations.
   *
   * Also paired with DATA_PERSIST_NEEDED when the DB itself changed.
   */
  HISTORY_DATA_CHANGED: "HISTORY_DATA_CHANGED",

  /**
   * plugin.data.settings was mutated (visibility toggles, slot config,
   * heatmap colors/thresholds, daily writing goal, languages, tracked
   * folders, backup paths, etc.).  Emitted after saveData so listeners
   * can re-read the latest settings object.
   *
   * SidebarView (showSlots/showHeatmap/showEntries + slots/colors config)
   * and Slot components (target goal changes) re-render on this event.
   */
  SETTINGS_CHANGED: "SETTINGS_CHANGED",

  /**
   * The calendar day rolled over (state.today changed its value).
   * Conceptually equivalent to "refresh everything" but semantically
   * precise: any component keyed on state.today must reset its queries.
   * Emitted by setToday() — which is invoked either explicitly from
   * onload/initialization, via checkDayChange() on window focus, or
   * indirectly from updateAndSaveEverything in the settings UI (which
   * also emits SETTINGS_CHANGED separately).
   */
  DAY_CHANGED: "DAY_CHANGED",

  /****************************************************************************
   * Legacy events — deprecated.  Kept for reference and to avoid breaking
   * any code paths not yet migrated in this refactor.  New code MUST use
   * the five events above.
   ****************************************************************************/

  /** @deprecated use DAY_CHANGED / HISTORY_DATA_CHANGED / SETTINGS_CHANGED */
  REFRESH_EVERYTHING: "REFRESH_EVERYTHING",

  /** @deprecated use TODAY_DATA_CHANGED */
  REFRESH_TODAY: "REFRESH_TODAY",
};

export class PluginState {
  /**
   * Allows access of data/functions from plugin class and Obsidian by React components
   * */
  private _plugin: KeepTheRhythm;

  get plugin() {
    return this._plugin;
  }
  setPlugin(plugin: KeepTheRhythm) {
    this._plugin = plugin;
  }

  /****************************************************************************************/

  /** Global string used for the current date
   * FUTURE: add a setting to change date format!
   */
  private _today: string = formatDate(new Date());
  get today() {
    return this._today;
  }

  /**
   * Force state.today to the current wall-clock date and emit DAY_CHANGED.
   * This is the only place that broadcasts a day rollover.  Use
   * checkDayChange() for the idempotent "only update if actually changed"
   * variant; call setToday() directly on plugin boot to ensure listeners
   * fire at least once even if the date didn't change since last run.
   */
  setToday() {
    this._today = formatDate(new Date());
    this.emit(EVENTS.DAY_CHANGED);
  }

  checkDayChange() {
    const today = formatDate(new Date());
    if (today !== this._today) {
      this.setToday();
    }
  }

  /****************************************************************************************/

  public _currentFileActivity: DailyActivity | null;

  public isUpdatingActivity: boolean = false;
  private _reachedGoalToday: boolean = false;

  private _listeners: Array<() => void> = [];
  private _events: Record<string, Listener[]> = {};

  get reachedGoalToday() {
    return this._reachedGoalToday;
  }

  get currentActivity() {
    return this._currentFileActivity;
  }

  setReachedGoalToday(newValue: boolean) {
    this._reachedGoalToday = newValue;
  }

  /**
   * Swaps the current in-memory activity pointer.  Does NOT emit any
   * event — callers are responsible for broadcasting the appropriate
   * *_DATA_CHANGED event (typically TODAY_DATA_CHANGED) afterwards,
   * together with DATA_PERSIST_NEEDED if a DB write also occurred.
   */
  setCurrentActivity(activity: DailyActivity | null) {
    this._currentFileActivity = activity;
  }

  on(event: string, listener: Listener): void {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(listener);
  }
  off(event: string, listener: Listener): void {
    if (!this._events[event]) return;
    this._events[event] = this._events[event].filter((i) => i !== listener);
  }

  emit(event: string, ...args: any[]): void {
    const listeners = this._events[event];

    if (!listeners) return;
    // All seven known events (5 new + 2 legacy) are UI-facing or trigger
    // save pipeline work that benefits from being coalesced per frame.
    const _ = EVENTS; // reference so tree-shakers don't drop the map
    void _;
    requestAnimationFrame(() => {
      for (const listener of listeners) {
        listener(...args);
      }
    });
  }
}

export const state = new PluginState();
