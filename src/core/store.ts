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
 *   • currentFilePath   — the path of the file Obsidian currently has open.
 *                         The "current activity" row is DERIVED from this
 *                         plus dailyActivity via selectCurrentActivity().
 *                         We never store the row itself: the date is always
 *                         `today`, and the numeric fields live in
 *                         dailyActivity, so a separate copy would just
 *                         drift.  When this is set, dailyActivity is
 *                         expected to contain a row with
 *                         (date === today, filePath === currentFilePath);
 *                         if that row is missing the selector returns null
 *                         (and the next ensureActivityExists() re-creates
 *                         it).  This is the only invariant callers need
 *                         to respect.
 *   • dailyActivity     — the full activity array (the in-memory mirror of
 *                         dailyActivity in data.json).
 *                         Components subscribe via selectors; mutations go
 *                         through `bulkSetDailyActivity` / `upsertActivity` /
 *                         `deleteActivity` / `renameFilePath`.
 *   • settings          — the single in-memory source of truth for settings.
 *                         Mutate via updateSettings / mutateSettings which
 *                         trigger requestPersist(). The debounced save
 *                         serializes store → data.json.
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
	currentFilePath: string | null;
	settings: Settings;
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
	/** Idempotent: only updates if wall-clock date actually differs.
	 *  Also clears `currentFilePath` so ensureActivityExists() rebuilds
	 *  a fresh row for the new day. */
	checkDayChange: () => void;
	/** Mark this file as the currently-open one.  Caller is responsible
	 *  for ensuring the (today, filePath) row exists in dailyActivity
	 *  (events.ts does this via getExistingOrCreateNewEntry first). */
	setCurrentFilePath: (path: string | null) => void;
	/** Apply updater to settings, request persist. */
	updateSettings: (updater: (draft: Settings) => Settings) => Promise<void>;
	/** Mutate settings draft in-place, request persist. */
	mutateSettings: (updater: (draft: Settings) => void) => Promise<void>;
	/** Hydrate store from loaded data.json (used on boot and after external changes). */
	hydrateFromData: (data: PluginData) => void;

	// ─── Data actions (replace Dexie writes) ───
	/** Replace the whole dailyActivity array.  Used by initializeDataFromJSON
	 *  and externalSync.  The current-activity selector recomputes against
	 *  the new array automatically. */
	bulkSetDailyActivity: (rows: DailyActivity[]) => void;
	/** Insert or update by [date+filePath]. */
	upsertActivity: (row: DailyActivity) => void;
	/** Remove one row by [date+filePath]. */
	deleteActivity: (date: string, filePath: string) => void;
	/** Update filePath on all matching rows. */
	renameFilePath: (oldPath: string, newPath: string) => void;
}

/**
 * Derived selector: returns today's activity row for the currently-open
 * file, or null if no file is open / no row exists yet / today has
 * rolled over.  Re-runs whenever dailyActivity, currentFilePath, or
 * today changes — no manual pointer maintenance required.
 */
export const selectCurrentActivity = (s: KTRState): DailyActivity | null => {
	const fp = s.currentFilePath;
	if (!fp) return null;
	return (
		s.dailyActivity.find(
			(r) => r.date === s.today && r.filePath === fp,
		) ?? null
	);
};

// ─── requestPersist rAF coalescing ───
// Same semantics as the old emit() which used requestAnimationFrame to
// merge multiple emits in the same frame.  Here we batch multiple
// requestPersist() calls into a single persistVersion++.
let persistRafScheduled = false;
let pendingPersist = false;

export const useStore = create<KTRState>()(
	subscribeWithSelector((set, get) => ({
		today: getToday(),
		currentFilePath: null,
		settings: DEFAULT_SETTINGS,
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
				// Clear currentFilePath: any cached "row for this file"
				// now belongs to yesterday, so the selector must return
				// null until events.ts rebuilds today's row.
				set({
					today,
					currentFilePath: null,
					todayVersion: cur.todayVersion + 1,
					historicalVersion: cur.historicalVersion + 1,
				});
			}
		},

		setCurrentFilePath: (path) => {
			set({ currentFilePath: path });
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

		hydrateFromData: (data) => {
			const cur = get();
			set({
				settings: { ...DEFAULT_SETTINGS, ...data.settings },
				dailyActivity: [...(data.stats?.dailyActivity || [])],
				today: getToday(),
				todayVersion: cur.todayVersion + 1,
				historicalVersion: cur.historicalVersion + 1,
			});
		},

		// ─── Data actions ───
		// Note: none of these touch currentFilePath.  The "current
		// activity" row is derived via selectCurrentActivity() from
		// (currentFilePath, today, dailyActivity), so a mutation to
		// dailyActivity automatically refreshes the view.

		bulkSetDailyActivity: (rows) => {
			const cur = get();
			set({
				dailyActivity: rows,
				todayVersion: cur.todayVersion + 1,
				historicalVersion: cur.historicalVersion + 1,
			});
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
			const isToday = row.date === cur.today;
			set({
				dailyActivity: next,
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
			const isToday = date === cur.today;
			set({
				dailyActivity: next,
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
			// If we were tracking the renamed file, follow it.
			if (cur.currentFilePath === oldPath) {
				set({ currentFilePath: newPath });
			}
			set({
				dailyActivity: next,
				historicalVersion: cur.historicalVersion + 1,
			});
			get().requestPersist();
		},
	})),
);
