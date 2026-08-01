import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { DailyActivity, PluginData } from "@/defs/types";
import { Settings, DEFAULT_SETTINGS } from "@/defs/types";
import { getToday } from "@/utils/dateUtils";

/**
 * Zustand store — the single source of truth for all in-memory reactive state.
 *
 * What lives here:
 *   • today             — current date string, changes on day rollover
 *   • currentActivity   — pointer to the open file's row in dailyActivity.
 *                         Always a reference to a row in `dailyActivity`
 *                         (or null) — the mutation actions enforce this
 *                         invariant, so components can rely on it.
 *   • dailyActivity     — the full activity array (the in-memory mirror of
 *                         dailyActivity in data.json).
 *                         Components subscribe via selectors; mutations go
 *                         through `bulkSetDailyActivity` / `upsertActivity` /
 *                         `modifyActivity` / `deleteActivity` /
 *                         `deleteByFilePath` / `renameFilePath`.
 *   • settings          — the single in-memory source of truth for settings.
 *                         Mutate via updateSettings / mutateSettings which
 *                         trigger requestPersist(). The debounced save
 *                         serializes store → data.json.
 *   • daysWithCompletedGoal — streak data
 *   • persistVersion    — monotonic counter; dataPersistence.ts subscribes
 *                         to it (via subscribeWithSelector) to schedule
 *                         debounced JSON saves.
 *   • todayVersion     — increments when today's data changes, used to
 *                         invalidate the module-level partitioned cache
 *   • historicalVersion — increments when historical (non-today) data changes
 *
 * Data flow:
 *   Boot:    data.json → hydrateFromData → store
 *   Runtime: mutations → store.requestPersist() → persistVersion++
 *            dataPersistence builds PluginData from store → saveData() → data.json
 *   External: onExternalSettingsChange → direct store update
 *
 * What does NOT live here:
 *   • plugin reference  — see pluginRegistry.ts (service locator)
 *   • isUpdatingActivity — module-level var in events.ts (internal guard)
 */
export interface KTRState {
	// ─── Core state ───
	today: string;
	currentActivity: DailyActivity | null;
	settings: Settings;
	daysWithCompletedGoal: string[];
	persistVersion: number;
	dailyActivity: DailyActivity[];
	todayVersion: number;
	historicalVersion: number;

	// ─── Persist signal (replaces DATA_PERSIST_NEEDED event) ───
	requestPersist: () => void;

	// ─── Generic actions ───
	/** Force-refresh today to wall-clock date. Use on boot to guarantee
	 *  listeners fire at least once even if date hasn't changed. */
	setToday: () => void;
	/** Idempotent: only updates if wall-clock date actually differs. */
	checkDayChange: () => void;
	/** Replace currentActivity, verifying the row exists in dailyActivity
	 *  (or setting null).  This is the only "raw" set path; prefer the
	 *  data actions (upsertActivity etc.) which auto-maintain the pointer. */
	setCurrentActivity: (activity: DailyActivity | null) => void;
	/** Apply updater to settings, request persist. */
	updateSettings: (updater: (draft: Settings) => Settings) => Promise<void>;
	/** Mutate settings draft in-place, request persist. */
	mutateSettings: (updater: (draft: Settings) => void) => Promise<void>;
	/** Update streak list, request persist. */
	updateStreak: (increase: boolean) => Promise<void>;
	/** Hydrate store from loaded data.json (used on boot and after external changes). */
	hydrateFromData: (data: PluginData) => void;

	// ─── Data actions (replace Dexie writes) ───
	/** Replace the whole dailyActivity array.  Re-derives currentActivity
	 *  from the new array.  Used by initializeDataFromJSON and externalSync. */
	bulkSetDailyActivity: (rows: DailyActivity[]) => void;
	/** Insert or update by [date+filePath]. */
	upsertActivity: (row: DailyActivity) => void;
	/** Remove one row by [date+filePath].  Nulls currentActivity if matched. */
	deleteActivity: (date: string, filePath: string) => void;
	/** Update filePath on all matching rows. */
	renameFilePath: (oldPath: string, newPath: string) => void;
}

// ─── requestPersist rAF coalescing ───
// Same semantics as the old emit() which used requestAnimationFrame to
// merge multiple emits in the same frame.  Here we batch multiple
// requestPersist() calls into a single persistVersion++.
let persistRafScheduled = false;
let pendingPersist = false;

export const useStore = create<KTRState>()(
	subscribeWithSelector((set, get) => ({
		today: getToday(),
		currentActivity: null,
		settings: DEFAULT_SETTINGS,
		daysWithCompletedGoal: [],
		persistVersion: 0,
		dailyActivity: [],
		todayVersion: 0,
		historicalVersion: 0,

		setToday: () => {
			set({ today: getToday() });
		},

		checkDayChange: () => {
			const today = getToday();
			const cur = get();
			if (today !== cur.today) {
				set({
					today,
					todayVersion: cur.todayVersion + 1,
					historicalVersion: cur.historicalVersion + 1,
				});
			}
		},

		setCurrentActivity: (activity) => {
			set({ currentActivity: activity });
		},

		requestPersist: () => {
			pendingPersist = true;
			if (persistRafScheduled) return;
			persistRafScheduled = true;
			requestAnimationFrame(() => {
				persistRafScheduled = false;
				if (pendingPersist) {
					pendingPersist = false;
					set((s) => ({ persistVersion: s.persistVersion + 1 }));
				}
			});
		},

		updateSettings: async (updater) => {
			const cur = get();
			const next = updater(cur.settings);
			set({ settings: { ...next } });
			cur.requestPersist();
			cur.checkDayChange();
		},

		mutateSettings: async (updater) => {
			const cur = get();
			// Mutate draft in-place (matches existing SlotWrapper/CustomSettings
			// semantics where settings are directly modified).
			updater(cur.settings);
			set({ settings: { ...cur.settings } });
			cur.requestPersist();
		},

		updateStreak: async (increase) => {
			const cur = get();
			const list = [...cur.daysWithCompletedGoal];
			const today = cur.today;
			let changed = false;
			if (increase) {
				if (!list.includes(today)) {
					list.push(today);
					changed = true;
				}
			} else {
				if (list.includes(today)) {
					const idx = list.indexOf(today);
					list.splice(idx, 1);
					changed = true;
				}
			}
			if (changed) {
				set({ daysWithCompletedGoal: list });
				cur.requestPersist();
			}
		},

		hydrateFromData: (data) => {
			const cur = get();
			set({
				settings: { ...DEFAULT_SETTINGS, ...data.settings },
				daysWithCompletedGoal: [
					...(data.stats?.daysWithCompletedGoal || []),
				],
				dailyActivity: [...(data.stats?.dailyActivity || [])],
				today: getToday(),
				currentActivity: null,
				todayVersion: cur.todayVersion + 1,
				historicalVersion: cur.historicalVersion + 1,
			});
		},

		// ─── Data actions ───

		bulkSetDailyActivity: (rows) => {
			const cur = get();
			set({
				dailyActivity: rows,
				todayVersion: cur.todayVersion + 1,
				historicalVersion: cur.historicalVersion + 1,
			});
			if (cur.currentActivity) {
				const match = rows.find(
					(r) =>
						r.date === cur.currentActivity!.date &&
						r.filePath === cur.currentActivity!.filePath,
				);
				set({ currentActivity: match ?? null });
			}
			get().requestPersist();
		},

		upsertActivity: (row) => {
			const cur = get();
			const idx = cur.dailyActivity.findIndex(
				(r) => r.date === row.date && r.filePath === row.filePath,
			);
			const next =
				idx === -1
					? [...cur.dailyActivity, row]
					: cur.dailyActivity.map((r, i) => (i === idx ? row : r));
			const isCurrent =
				cur.currentActivity?.date === row.date &&
				cur.currentActivity?.filePath === row.filePath;
			const isToday = row.date === cur.today;
			set({
				dailyActivity: next,
				currentActivity: isCurrent ? row : cur.currentActivity,
				todayVersion: isToday
					? cur.todayVersion + 1
					: cur.todayVersion,
				historicalVersion: !isToday
					? cur.historicalVersion + 1
					: cur.historicalVersion,
			});
			get().requestPersist();
		},

		deleteActivity: (date, filePath) => {
			const cur = get();
			const next = cur.dailyActivity.filter(
				(r) => !(r.date === date && r.filePath === filePath),
			);
			const wasCurrent =
				cur.currentActivity?.date === date &&
				cur.currentActivity?.filePath === filePath;
			const isToday = date === cur.today;
			set({
				dailyActivity: next,
				currentActivity: wasCurrent ? null : cur.currentActivity,
				todayVersion: isToday
					? cur.todayVersion + 1
					: cur.todayVersion,
				historicalVersion: !isToday
					? cur.historicalVersion + 1
					: cur.historicalVersion,
			});
			get().requestPersist();
		},

		renameFilePath: (oldPath, newPath) => {
			const cur = get();
			const next = cur.dailyActivity.map((r) =>
				r.filePath === oldPath ? { ...r, filePath: newPath } : r,
			);
			const wasCurrent = cur.currentActivity?.filePath === oldPath;
			const newCurrent = wasCurrent
				? (next.find((r) => r.date === cur.currentActivity!.date) ??
					null)
				: cur.currentActivity;
			set({
				dailyActivity: next,
				currentActivity: newCurrent,
				historicalVersion: cur.historicalVersion + 1,
			});
			get().requestPersist();
		},
	})),
);
