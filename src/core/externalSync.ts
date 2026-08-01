import { DEFAULT_SETTINGS } from "@/defs/types";
import { useStore } from "./store";
import KeepTheRhythm from "../main";

/**
 * Handle external changes to data.json (e.g. from file sync, manual edits).
 *
 * Strategy: update plugin.data first, then hydrate the store from it.
 * This ensures hydrateFromPluginData reads the latest data.
 */
export async function handleExternalSettingsChange(plugin: KeepTheRhythm) {
	try {
		const newData = await plugin.loadData();

		if (JSON.stringify(newData) === JSON.stringify(plugin.data)) {
			return;
		}

		// Detect which parts changed
		const settingsChanged =
			JSON.stringify(plugin.data.settings) !==
			JSON.stringify(newData.settings);
		const statsChanged =
			JSON.stringify(plugin.data.stats) !==
			JSON.stringify(newData.stats);

		if (!settingsChanged && !statsChanged) {
			return;
		}

		// 1. Update plugin.data so hydrateFromPluginData reads fresh data
		if (settingsChanged) {
			plugin.data.settings = {
				...DEFAULT_SETTINGS,
				...newData.settings,
			};
		}
		if (statsChanged) {
			plugin.data.stats = {
				...plugin.data.stats,
				daysWithCompletedGoal:
					newData.stats?.daysWithCompletedGoal ??
					plugin.data.stats?.daysWithCompletedGoal ??
					[],
				dailyActivity:
					newData.stats?.dailyActivity ??
					plugin.data.stats?.dailyActivity ??
					[],
			};
		}

		// 2. Preserve currentActivity pointer before hydrate resets it
		const preservedActivity = useStore.getState().currentActivity;

		// 3. Sync store from (now updated) plugin.data
		useStore.getState().hydrateFromPluginData();

		// 4. Restore currentActivity if its row still exists in the new data
		if (preservedActivity) {
			const match = useStore
				.getState()
				.dailyActivity.find(
					(r) =>
						r.date === preservedActivity.date &&
						r.filePath === preservedActivity.filePath,
				);
			if (match) {
				useStore.getState().setCurrentActivity(match);
			}
		}
	} catch (error) {
		console.error("Error in onExternalSettingsChange:", error);
	}
}
