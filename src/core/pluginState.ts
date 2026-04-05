import { DailyActivity } from "@/db/types";
import { formatDate } from "@/utils/dateUtils";
import KeepTheRhythm from "@/main";
import { App } from "obsidian";

type Listener = (...args: any[]) => void;

export const EVENTS = {
  /**
   * Queries everything from DB again
   */
  REFRESH_EVERYTHING: "REFRESH_EVERYTHING",

  /**
   * Only refreshes today, meaning data from previous days is not updated;
   * Only triggered when it's clear that only today's data changed.
   */
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

  /**
   * Data from previous days is cached in this Map to make it easier to udpate components without querying previous data.
   * Only updated when @event REFRESH_EVERYTHING happens.
   * This is not making that much sense since I am using live query on the Heatmap, it feels like early optimizing...
   */
  // private _activitiesBeforeToday: Map<string, DailyActivity[]> = new Map<
  // 	string,
  // 	DailyActivity[]
  // >();
  // set cacheDailyActivtiesBeforeToday(data: DailyActivity[]) {
  // 	this._activitiesBeforeToday.clear();

  // 	data.forEach((activity) => {
  // 		const existing =
  // 			this._activitiesBeforeToday.get(activity.date) || [];
  // 		existing.push(activity);
  // 		this._activitiesBeforeToday.set(activity.date, existing);
  // 	});
  // }
  // get cache() {
  // 	return this._activitiesBeforeToday;
  // }

  /****************************************************************************************/

  /** Global string used for the current date
   * FUTURE: add a setting to change date format!
   */
  private _today: string = formatDate(new Date());
  get today() {
    return this._today;
  }
  setToday() {
    this._today = formatDate(new Date());

    /** Everything is updated on day change to ensure components have the current dates and etc. */
    this.emit(EVENTS.REFRESH_EVERYTHING);
  }

  /****************************************************************************************/

  /**
   * Reading the whole vault it's a bit expensive.
   * So there is a debounce to avoid reading it too much too fast.
   * @var _vaultReadTimeout allows the timeout to be properly reset
   * @var _currentVaultCount is used by the WHOLE_VAULT Slot to display this
   * @const _DEBOUNCE_VAULT_READ is the amount of time before reading it again
   */
  private _vaultReadTimeout: typeof setTimeout | null;
  public DEBOUNCE_VAULT_READ: number = 1000;

  private _currentVaultCount: number;
  get currentVaultCount(): number {
    return this._currentVaultCount;
  }
  setCurrentVaultCount(newCount: number) {
    this._currentVaultCount = newCount;
  }
  get vaultReadTimeout() {
    return this._vaultReadTimeout;
  }
  setVaultReadTimeout(timeout: typeof setTimeout | null) {
    this._vaultReadTimeout = timeout;
  }

  /****************************************************************************************/

  public _currentFileActivity: DailyActivity | null;

  public isUpdatingActivity: boolean = false;
  // private _deviceId: string;
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

  setCurrentActivity(activity: DailyActivity | null) {
    this._currentFileActivity = activity;
    // state.emit(EVENTS.REFRESH_EVERYTHING);
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
    if (event === EVENTS.REFRESH_EVERYTHING) {
      requestAnimationFrame(() => {
        for (const listener of listeners) {
          listener(...args);
        }
      });
    } else {
      // For non-UI events, use microtask queue
      Promise.resolve().then(() => {
        for (const listener of listeners) {
          listener(...args);
        }
      });
    }
  }
}

export const state = new PluginState();
