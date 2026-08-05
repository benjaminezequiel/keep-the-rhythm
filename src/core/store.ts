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
 *   • todayActivity     — activity rows with date === today.  On a day
 *                         rollover `checkDayChange` appends the whole slice
 *                         to historicalActivity and clears it.
 *   • historicalActivity — activity rows with date < today.
 *
 *                         The two live SEPARATELY in memory so the hot path
 *                         (typing → upsertActivity on today) never touches
 *                         the (potentially large) historical array.  They are
 *                         merged back into a single flat `dailyActivity` only
 *                         when persisted to data.json (dataPersistence.ts /
 *                         buildSnapshotFromStore) or read by foreign consumers.
 *
 *                         Invariant: historicalActivity rows all have
 *                         date < today; todayActivity rows all have
 *                         date === today.
 *
 *                         Mutations go through `upsertActivity` / `deleteActivity` /
 *                         `renameFilePath` which partition by today.
 *   • settings          — the single in-memory source of truth for settings.
 *                         Mutate via mutateSettings which trigger requestPersist().
 *                         The debounced save serializes store → data.json.
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
	todayActivity: DailyActivity[];
	historicalActivity: DailyActivity[];
	todayVersion: number;
	historicalVersion: number;

	// ─── Persist signal (replaces DATA_PERSIST_NEEDED event) ───
	requestPersist: () => void;

	// ─── Generic actions ───
	/** Idempotent: only updates if wall-clock date actually differs.
	 *  Also clears `currentFilePath` so ensureActivityExists() rebuilds
	 *  a fresh row for the new day. */
	checkDayChange: () => void;
	/** Mark this file as the currently-open one.  Caller is responsible
	 *  for ensuring the (today, filePath) row exists in dailyActivity
	 *  (events.ts does this via getExistingOrCreateNewEntry first). */
	setCurrentFilePath: (path: string | null) => void;
	/** Mutate settings draft in-place, request persist. */
	mutateSettings: (updater: (draft: Settings) => void) => void;
	/** Hydrate store from loaded data.json (used on boot and after external changes). */
	hydrateFromData: (data: PluginData) => void;

	// ─── Data actions (replace Dexie writes) ───
	/** Insert or update by [date+filePath]. */
	upsertActivity: (row: DailyActivity) => void;
	/** Remove one row by [date+filePath]. */
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
		currentFilePath: null,
		settings: DEFAULT_SETTINGS,
		persistVersion: 0,
		todayActivity: [],
		historicalActivity: [],
		todayVersion: 0,
		historicalVersion: 0,

		checkDayChange: () => {
			const today = getToday();
			const cur = get();
			if (today !== cur.today) {
				// Migrate yesterday's today-slice into the historical array.
				// The old todayActivity rows now all have date === cur.today <
				// today, satisfying the date < today invariant.
				set({
					today,
					currentFilePath: null,
					todayActivity: [],
					historicalActivity: [
						...cur.historicalActivity,
						...cur.todayActivity,
					],
					todayVersion: cur.todayVersion + 1,
					historicalVersion: cur.historicalVersion + 1,
				});
				get().requestPersist();
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

		mutateSettings: (updater) => {
			const cur = get();
			// Clone deeply enough so that Zustand selectors (which use
			// Object.is by default) detect changes to nested objects.
			// Without this, mutating cur.settings in-place and then
			// shallow-spreading leaves sidebarConfig / slots with the
			// same references, and subscribers silently miss the update.
			const newSettings: Settings = {
				...cur.settings,
				sidebarConfig: {
					...cur.settings.sidebarConfig,
					slots: cur.settings.sidebarConfig.slots.map((s) => ({
						...s,
					})),
				},
			};
			updater(newSettings);
			set({ settings: newSettings });
			cur.requestPersist();
		},

		hydrateFromData: (data) => {
			const cur = get();
			const today = getToday();
			const flat = [...(data.stats?.dailyActivity || [])];
			set({
				settings: { ...DEFAULT_SETTINGS, ...data.settings },
				todayActivity: flat.filter((a) => a.date === today),
				historicalActivity: flat.filter((a) => a.date < today),
				today,
				todayVersion: cur.todayVersion + 1,
				historicalVersion: cur.historicalVersion + 1,
			});
		},

		// ─── Data actions ───

		upsertActivity: (row) => {
			const cur = get();
			const isToday = row.date === cur.today;
			const arr = isToday ? cur.todayActivity : cur.historicalActivity;
			const idx = arr.findIndex(
				(r) => r.date === row.date && r.filePath === row.filePath,
			);
			const next =
				idx === -1
					? [...arr, row]
					: arr.map((r, i) => (i === idx ? row : r));
			set({
				todayActivity: isToday ? next : cur.todayActivity,
				historicalActivity: isToday ? cur.historicalActivity : next,
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
			const isToday = date === cur.today;
			if (isToday) {
				set({
					todayActivity: cur.todayActivity.filter(
						(r) => !(r.date === date && r.filePath === filePath),
					),
					todayVersion: cur.todayVersion + 1,
				});
			} else {
				set({
					historicalActivity: cur.historicalActivity.filter(
						(r) => !(r.date === date && r.filePath === filePath),
					),
					historicalVersion: cur.historicalVersion + 1,
				});
			}
			get().requestPersist();
		},

		renameFilePath: (oldPath, newPath) => {
			const cur = get();
			// Update any matching rows in both partitions (a file can have
			// entries on today AND earlier days).
			set({
				todayActivity: cur.todayActivity.map((r) =>
					r.filePath === oldPath ? { ...r, filePath: newPath } : r,
				),
				historicalActivity: cur.historicalActivity.map((r) =>
					r.filePath === oldPath ? { ...r, filePath: newPath } : r,
				),
				// If we were tracking the renamed file, follow it.
				...(cur.currentFilePath === oldPath
					? { currentFilePath: newPath }
					: {}),
				...(cur.historicalActivity.some(
					(r) => r.filePath === oldPath,
				)
					? { historicalVersion: cur.historicalVersion + 1 }
					: {}),
			});
			get().requestPersist();
		},
	})),
);
