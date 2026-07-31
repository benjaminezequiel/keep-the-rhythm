import { DEFAULT_SETTINGS } from "@/defs/types";
import { useStore } from "./store";
import KeepTheRhythm from "../main";

/**
 * Handle external changes to data.json (e.g. from file sync, manual edits).
 * Compares loaded data with current in-memory data, updates the store,
 * then re-hydrates the store.  Replaces the old bulkPut-into-IndexedDB
 * path.
 */
export async function handleExternalSettingsChange(plugin: KeepTheRhythm) {
	try {
		const newData = await plugin.loadData();

		if (JSON.stringify(newData) === JSON.stringify(plugin.data)) {
			return;
		}

		// Sync settings (deep compare, not reference)
		if (
			JSON.stringify(plugin.data.settings) !==
			JSON.stringify(newData.settings)
		) {
			plugin.data.settings = {
				...DEFAULT_SETTINGS,
				...newData.settings,
			};
		}

		// Sync dailyActivity: compare in-memory arrays, replace if changed.
		const newActivities = newData.stats?.dailyActivity ?? [];
		const oldActivities = plugin.data.stats?.dailyActivity ?? [];
		if (JSON.stringify(newActivities) !== JSON.stringify(oldActivities)) {
			// bulkSetDailyActivity re-derives currentActivity and triggers
			// a debounced JSON save — no manual requestPersist needed.
			useStore.getState().bulkSetDailyActivity(newActivities);
		}

		useStore.getState().hydrateFromPluginData();
	} catch (error) {
		console.error("Error in onExternalSettingsChange:", error);
	}
}
