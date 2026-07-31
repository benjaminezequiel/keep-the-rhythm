import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { DailyActivity } from "@/defs/types";
import { Settings, DEFAULT_SETTINGS } from "@/defs/types";
import { getToday } from "@/utils/dateUtils";
import { getPlugin } from "./pluginRegistry";

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
 *                         `plugin.data.stats.dailyActivity` in data.json).
 *                         Components subscribe via selectors; mutations go
 *                         through `bulkSetDailyActivity` / `upsertActivity` /
 *                         `modifyActivity` / `deleteActivity` /
 *                         `deleteByFilePath` / `renameFilePath`.
 *   • settings          — immutable snapshot of plugin.data.settings; updated
 *                         via updateSettings / mutateSettings actions which
 *                         also persist to plugin.data + saveData()
 *   • daysWithCompletedGoal — streak data from plugin.data.stats
 *   • persistVersion    — monotonic counter; main.ts subscribes to it
 *                         (via subscribeWithSelector) to schedule debounced
 *                         JSON saves, replacing the old DATA_PERSIST_NEEDED
 *                         event.
 *
 * What does NOT live here:
 *   • plugin reference  — see pluginRegistry.ts (service locator)
 *   • isUpdatingActivity — module-level var in events.ts (internal guard)
 */
interface KTRState {
	// ─── Core state ───
	today: string;
	currentActivity: DailyActivity | null;
	settings: Settings;
	daysWithCompletedGoal: string[];
	persistVersion: number;
	dailyActivity: DailyActivity[];

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
	/** Add delta to currentActivity.wordsAdded via modifyActivity. */
	accumulateCurrentActivityWords: (delta: number) => void;
	/** Apply updater to settings, persist, and sync store. */
	updateSettings: (updater: (draft: Settings) => Settings) => Promise<void>;
	/** Mutate settings draft in-place, persist, and sync store. */
	mutateSettings: (updater: (draft: Settings) => void) => Promise<void>;
	/** Update streak list, persist, and sync store. */
	updateStreak: (increase: boolean) => Promise<void>;
	/** Sync store from plugin.data (used on boot and after external changes). */
	hydrateFromPluginData: () => void;

	// ─── Data actions (replace Dexie writes) ───
	/** Replace the whole dailyActivity array.  Re-derives currentActivity
	 *  from the new array.  Used by initializeDataFromJSON and externalSync. */
	bulkSetDailyActivity: (rows: DailyActivity[]) => void;
	/** Insert or update by [date+filePath]. */
	upsertActivity: (row: DailyActivity) => void;
	/** Functional update by key.  No-op if the row doesn't exist. */
	modifyActivity: (
		date: string,
		filePath: string,
		mutator: (row: DailyActivity) => void,
	) => void;
	/** Remove one row by [date+filePath].  Nulls currentActivity if matched. */
	deleteActivity: (date: string, filePath: string) => void;
	/** Remove all rows for a path.  Nulls currentActivity if matched. */
	deleteByFilePath: (filePath: string) => void;
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

		setToday: () => {
			set({ today: getToday() });
		},

		checkDayChange: () => {
			const today = getToday();
			if (today !== get().today) {
				set({ today });
			}
		},

		setCurrentActivity: (activity) => {
			if (activity === null) {
				set({ currentActivity: null });
				return;
			}
			// Enforce invariant: currentActivity must be a reference to a
			// row currently in dailyActivity[].  If the caller passes a
			// stale object, look up the live row instead.  Falls back to
			// null if no match (row was deleted concurrently).
			const match = get().dailyActivity.find(
				(r) =>
					r.date === activity.date &&
					r.filePath === activity.filePath,
			);
			set({ currentActivity: match ?? null });
		},

		accumulateCurrentActivityWords: (delta) => {
			const cur = get();
			if (!cur.currentActivity) return;
			cur.modifyActivity(
				cur.currentActivity.date,
				cur.currentActivity.filePath,
				(row) => {
					row.wordsAdded = (row.wordsAdded || 0) + (delta || 0);
				},
			);
			// modifyActivity already calls requestPersist; no need to repeat.
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
			const plugin = getPlugin();
			const next = updater(plugin.data.settings);
			plugin.data.settings = next;
			await plugin.saveData(plugin.data);
			// Shallow-copy top level so reference changes for selectors.
			set({ settings: { ...next } });
			get().checkDayChange();
		},

		mutateSettings: async (updater) => {
			const plugin = getPlugin();
			// Mutate draft in-place (matches existing SlotWrapper/CustomSettings
			// semantics where settings are directly modified).
			updater(plugin.data.settings);
			await plugin.saveData(plugin.data);
			set({ settings: { ...plugin.data.settings } });
		},

		updateStreak: async (increase) => {
			const plugin = getPlugin();
			if (!plugin.data.stats) return;
			if (!plugin.data.stats.daysWithCompletedGoal) {
				plugin.data.stats.daysWithCompletedGoal = [];
			}
			const list = plugin.data.stats.daysWithCompletedGoal;
			const today = get().today;
			let changed = false;
			if (increase) {
				if (!list.includes(today)) {
					list.push(today);
					changed = true;
				}
			} else {
				if (list.includes(today)) {
					plugin.data.stats.daysWithCompletedGoal = list.filter(
						(d) => d !== today,
					);
					changed = true;
				}
			}
			if (changed) {
				await plugin.saveData(plugin.data);
				set({
					daysWithCompletedGoal: [
						...plugin.data.stats.daysWithCompletedGoal,
					],
				});
			}
		},

		hydrateFromPluginData: () => {
			const plugin = getPlugin();
			set({
				settings: { ...plugin.data.settings },
				daysWithCompletedGoal: [
					...(plugin.data.stats?.daysWithCompletedGoal || []),
				],
				dailyActivity: [...(plugin.data.stats?.dailyActivity || [])],
				today: getToday(),
				currentActivity: null,
			});
		},

		// ─── Data actions ───

		bulkSetDailyActivity: (rows) => {
			const cur = get();
			set({ dailyActivity: rows });
			// Re-derive currentActivity from the new array to maintain the
			// "currentActivity is always a row in dailyActivity" invariant.
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
			set({
				dailyActivity: next,
				currentActivity: isCurrent ? row : cur.currentActivity,
			});
			get().requestPersist();
		},

		modifyActivity: (date, filePath, mutator) => {
			const cur = get();
			const idx = cur.dailyActivity.findIndex(
				(r) => r.date === date && r.filePath === filePath,
			);
			if (idx === -1) return; // no-op
			const updated = { ...cur.dailyActivity[idx] };
			mutator(updated);
			const next = cur.dailyActivity.map((r, i) =>
				i === idx ? updated : r,
			);
			const isCurrent =
				cur.currentActivity?.date === date &&
				cur.currentActivity?.filePath === filePath;
			set({
				dailyActivity: next,
				currentActivity: isCurrent ? updated : cur.currentActivity,
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
			set({
				dailyActivity: next,
				currentActivity: wasCurrent ? null : cur.currentActivity,
			});
			get().requestPersist();
		},

		deleteByFilePath: (filePath) => {
			const cur = get();
			const next = cur.dailyActivity.filter(
				(r) => r.filePath !== filePath,
			);
			const wasCurrent = cur.currentActivity?.filePath === filePath;
			set({
				dailyActivity: next,
				currentActivity: wasCurrent ? null : cur.currentActivity,
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
			set({ dailyActivity: next, currentActivity: newCurrent });
			get().requestPersist();
		},
	})),
);
