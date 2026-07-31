import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { DailyActivity } from "@/db/types";
import { Settings, DEFAULT_SETTINGS } from "@/defs/types";
import { formatDate } from "@/utils/dateUtils";
import { getPlugin } from "./pluginRegistry";

/**
 * Zustand store — the single source of truth for non-DB reactive state.
 *
 * What lives here:
 *   • today             — current date string, changes on day rollover
 *   • currentActivity   — in-memory activity for the open file (wordsAdded
 *                         mutates here before flush to IndexedDB)
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
 *   • DB activity rows  — use useLiveQuery in components
 *   • isUpdatingActivity — module-level var in events.ts (internal guard)
 */
interface KTRState {
  // ─── Core state ───
  today: string;
  currentActivity: DailyActivity | null;
  settings: Settings;
  daysWithCompletedGoal: string[];

  // ─── Persist signal (replaces DATA_PERSIST_NEEDED event) ───
  persistVersion: number;

  // ─── Actions ───
  /** Force-refresh today to wall-clock date. Use on boot to guarantee
   *  listeners fire at least once even if date hasn't changed. */
  setToday: () => void;
  /** Idempotent: only updates if wall-clock date actually differs. */
  checkDayChange: () => void;
  /** Replace currentActivity (immutable — triggers selector re-render). */
  setCurrentActivity: (activity: DailyActivity | null) => void;
  /** Add delta to currentActivity.wordsAdded (immutable update). */
  accumulateCurrentActivityWords: (delta: number) => void;
  /** rAF-coalesced persist signal. Replaces emit(DATA_PERSIST_NEEDED). */
  requestPersist: () => void;
  /** Apply updater to settings, persist, and sync store. */
  updateSettings: (updater: (draft: Settings) => Settings) => Promise<void>;
  /** Mutate settings draft in-place, persist, and sync store. */
  mutateSettings: (updater: (draft: Settings) => void) => Promise<void>;
  /** Update streak list, persist, and sync store. */
  updateStreak: (increase: boolean) => Promise<void>;
  /** Sync store from plugin.data (used on boot and after external changes). */
  hydrateFromPluginData: () => void;
}

// ─── requestPersist rAF coalescing ───
// Same semantics as the old emit() which used requestAnimationFrame to
// merge multiple emits in the same frame.  Here we batch multiple
// requestPersist() calls into a single persistVersion++.
let persistRafScheduled = false;
let pendingPersist = false;

export const useStore = create<KTRState>()(
  subscribeWithSelector((set, get) => ({
    today: formatDate(new Date()),
    currentActivity: null,
    settings: DEFAULT_SETTINGS,
    daysWithCompletedGoal: [],
    persistVersion: 0,

    setToday: () => {
      set({ today: formatDate(new Date()) });
    },

    checkDayChange: () => {
      const today = formatDate(new Date());
      if (today !== get().today) {
        set({ today });
      }
    },

    setCurrentActivity: (activity) => {
      set({ currentActivity: activity });
    },

    accumulateCurrentActivityWords: (delta) => {
      const cur = get().currentActivity;
      if (!cur) return;
      // Immutable update: new object reference so useStore selector
      // (e.g. useStore(s => s.currentActivity)) triggers re-render.
      set({
        currentActivity: {
          ...cur,
          wordsAdded: (cur.wordsAdded || 0) + (delta || 0),
        },
      });
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
        today: formatDate(new Date()),
      });
    },
  })),
);
