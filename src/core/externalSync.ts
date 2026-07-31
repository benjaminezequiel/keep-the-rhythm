import { DEFAULT_SETTINGS } from "@/defs/types";
import { getDB } from "@/db/db";
import { useStore } from "./store";
import KeepTheRhythm from "../main";

/**
 * Handle external changes to data.json (e.g. from file sync, manual edits).
 * Compares loaded data with current in-memory data, syncs IndexedDB rows
 * and settings, then re-hydrates the store.
 */
export async function handleExternalSettingsChange(
	plugin: KeepTheRhythm
) {
	try {
		const newData = await plugin.loadData();

		if (JSON.stringify(newData) === JSON.stringify(plugin.data)) {
			return;
		}

		// Sync settings (deep compare, not reference)
		if (JSON.stringify(plugin.data.settings) !== JSON.stringify(newData.settings)) {
			plugin.data.settings = {
				...DEFAULT_SETTINGS,
				...newData.settings,
			};
		}

		// Sync dailyActivity: compare in-memory arrays, bulk write if changed.
		// No DB read needed — plugin.data already has the latest snapshot.
		let dbMutated = false;
		const newActivities = newData.stats?.dailyActivity ?? [];
		const oldActivities = plugin.data.stats?.dailyActivity ?? [];
		if (JSON.stringify(newActivities) !== JSON.stringify(oldActivities)) {
			await getDB().dailyActivity.bulkPut(newActivities);
			dbMutated = true;
		}

		useStore.getState().hydrateFromPluginData();
		if (dbMutated) {
			useStore.getState().requestPersist();
		}
	} catch (error) {
		console.error("Error in onExternalSettingsChange:", error);
	}
}