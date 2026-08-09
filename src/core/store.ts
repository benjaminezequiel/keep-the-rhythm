import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { PluginData } from "@/defs/types";
import { Settings, DEFAULT_SETTINGS } from "@/defs/types";
import { DayActivityMap, DaysMap } from "@/defs/types";
import { getToday } from "@/utils/dateUtils";
import { decodeActivities } from "./statsCodec";

/**
 * Zustand store — the single source of truth for all in-memory reactive state.
 *
 * What lives here:
 *   • today              — current date string, changes on day rollover.
 *                          Liveness is derived purely from the baseline:
 *                          a file is "live" iff `todayBaselines` has an
 *                          entry for it (events.ts derives this).  Rows in
 *                          `days[today]` are written lazily — only when a
 *                          file's first sampled delta is non-zero — so a
 *                          bare file open never produces a 0-word entry.
 *                          Day rollover naturally ends that liveness because
 *                          `todayBaselines` is reset.
 *   • days               — date → filePath → words added.  One map for ALL
 *                          dates: today's slice is `days[today]`, no
 *                          separate partition.  On a day rollover nothing
 *                          moves — the old keys just stop being "today" —
 *                          only the baseline table is discarded.
 *   • todayBaselines     — filePath → word count at first touch today.
 *                          Live deltas are `editorCount - baseline`; without
 *                          the baseline a restart / sync merge could not
 *                          keep computing deltas against the same anchor.
 *                          Referenced (not persisted) outside the current
 *                          day — `todayBaselinesDay` records which date they
 *                          belong to so stale baselines are dropped.
 *
 *                          The maps live together so the hot path
 *                          (typing → upsertAdded on days[today]) is O(1)
 *                          and never touches the (potentially large) other
 *                          days.  Persisted as-is via statsCodec.ts.
 *
 *                          MUTATION CONTRACT: nothing in the app subscribes
 *                          to these map references (React reacts to the
 *                          version stamps below, persistence to
 *                          persistVersion).  The data actions therefore
 *                          mutate the maps IN PLACE and only `set()` the
 *                          version counters — no reference copying.
 *
 *   • settings           — the single in-memory source of truth for settings.
 *                          Mutate via mutateSettings which trigger requestPersist().
 *   • persistVersion     — monotonic counter; dataPersistence.ts subscribes
 *                          to it (via subscribeWithSelector) to schedule
 *                          debounced JSON saves.
 *   • todayVersion       — increments when today's data changes, used to
 *                          invalidate the module-level partitioned cache
 *   • historicalVersion  — increments when non-today data changes
 *
 * Data flow:
 *   Boot:    data.json → hydrateFromData → store (decoded via statsCodec)
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
	settings: Settings;
	persistVersion: number;
	days: DaysMap;
	todayBaselines: DayActivityMap;
	todayBaselinesDay: string | null;
	todayVersion: number;
	historicalVersion: number;
	/** Fast set of all file paths ever tracked — used to short-circuit
	 *  rename events for files that never appeared in days.  Allowed to
	 *  have stale entries (false positives are harmless); must never
	 *  miss a tracked file (false negatives would skip real renames). */
	activeFiles: Set<string>;

	// ─── Persist signal (replaces DATA_PERSIST_NEEDED event) ───
	requestPersist: () => void;

	// ─── Generic actions ───
	/** Idempotent: only updates if wall-clock date actually differs.
	 *  Discards yesterday's baselines — liveness is derived from
	 *  (row in days[today], baseline) so the next touch on any file
	 *  re-establishes a fresh row + baseline for the new day. */
	checkDayChange: () => void;
	/** Mutate settings draft in-place, request persist. */
	mutateSettings: (updater: (draft: Settings) => void) => void;
	/** Hydrate store from loaded data.json (used on boot and after external changes). */
	hydrateFromData: (data: PluginData) => void;

	// ─── Data actions ───
	/** Write (or overwrite) the words-added counter for [date, filePath]. */
	upsertAdded: (date: string, filePath: string, added: number) => void;
	/** Record today's starting word count for a file (todayBaselines). */
	setBaseline: (filePath: string, baseline: number) => void;
	/** Remove one row by [date+filePath] (and its baseline when date is today). */
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
		settings: DEFAULT_SETTINGS,
		persistVersion: 0,
		days: {},
		todayBaselines: {},
		todayBaselinesDay: null,
		todayVersion: 0,
		historicalVersion: 0,
		activeFiles: new Set<string>(),

		checkDayChange: () => {
			const today = getToday();
			const cur = get();
			if (today !== cur.today) {
				// Data needs no migration: yesterday's rows are already in
				// `days` under their own date key — they simply stop being
				// "today".  Only the day-scoped transient state is reset:
				// baselines (dead weight); liveness is data-derived so the
				// next touch on any file re-establishes a fresh baseline.
				set({
					today,
					todayBaselines: {},
					todayBaselinesDay: null,
					todayVersion: cur.todayVersion + 1,
					historicalVersion: cur.historicalVersion + 1,
				});
				get().requestPersist();
			}
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
			// Deep-clone so Zustand's default Object.is change detection sees
			// new references at every level (sidebarConfig, slots, …) when
			// the updater mutates `newSettings` in place.  Settings is pure
			// JSON-serializable data, so structuredClone is safe.
			const newSettings: Settings = structuredClone(cur.settings);
			updater(newSettings);
			set({ settings: newSettings });
			cur.requestPersist();
		},

		hydrateFromData: (data) => {
			const cur = get();
			const today = getToday();
			const decoded = decodeActivities(data?.stats, today);
			set({
				settings: { ...DEFAULT_SETTINGS, ...data?.settings },
				days: decoded.days,
				todayBaselines: decoded.todayBaselines,
				todayBaselinesDay: decoded.todayBaselinesDay,
				today,
				todayVersion: cur.todayVersion + 1,
				historicalVersion: cur.historicalVersion + 1,
				activeFiles: decoded.activeFiles,
			});
		},

		// ─── Data actions ───

		upsertAdded: (date, filePath, added) => {
			const cur = get();
			// In-place mutation: nothing in the app subscribes to the map
			// references themselves — React reacts to version stamps,
			// persistence to persistVersion (requestPersist).
			const day = (cur.days[date] ??= {});
			day[filePath] = added;
			cur.activeFiles.add(filePath);
			set(
				date === cur.today
					? { todayVersion: cur.todayVersion + 1 }
					: { historicalVersion: cur.historicalVersion + 1 },
			);
			get().requestPersist();
		},

		setBaseline: (filePath, baseline) => {
			const cur = get();
			if (cur.todayBaselines[filePath] === baseline) return;
			cur.todayBaselines[filePath] = baseline;
			set({ todayBaselinesDay: cur.today });
			get().requestPersist();
		},

		deleteActivity: (date, filePath) => {
			const cur = get();
			const day = cur.days[date];
			if (day) {
				delete day[filePath];
				if (Object.keys(day).length === 0) {
					delete cur.days[date];
				}
			}
			if (date === cur.today) {
				delete cur.todayBaselines[filePath];
				set({ todayVersion: cur.todayVersion + 1 });
			} else {
				set({ historicalVersion: cur.historicalVersion + 1 });
			}
			get().requestPersist();
		},

		renameFilePath: (oldPath, newPath) => {
			const cur = get();
			if (oldPath === newPath) return;
			if (!cur.activeFiles.has(oldPath)) return;

			cur.activeFiles.add(newPath);

			const renameInPlace = (m: DayActivityMap): boolean => {
				if (!(oldPath in m)) return false;
				m[newPath] = m[oldPath];
				delete m[oldPath];
				return true;
			};

			let todayChanged = false;
			let historicalChanged = false;
			for (const [date, day] of Object.entries(cur.days)) {
				if (renameInPlace(day)) {
					if (date === cur.today) todayChanged = true;
					else historicalChanged = true;
				}
			}

			renameInPlace(cur.todayBaselines); // only today has baselines

			set({
				...(todayChanged
					? { todayVersion: cur.todayVersion + 1 }
					: {}),
				...(historicalChanged
					? { historicalVersion: cur.historicalVersion + 1 }
					: {}),
			});
			get().requestPersist();
		},
	})),
);