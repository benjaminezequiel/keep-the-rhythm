import { DEFAULT_SETTINGS, DailyActivity } from "@/defs/types";
import { useStore } from "./store";
import KeepTheRhythm from "../main";

/**
 * Handle external changes to data.json (e.g. from file sync, manual edits).
 *
 * Strategy: load fresh data.json, merge with defaults, hydrate the store
 * directly.  The store will be persisted back on the next debounced save.
 */
export async function handleExternalSettingsChange(plugin: KeepTheRhythm) {
	try {
		const newData = await plugin.loadData();

		if (!newData) return;

		const cur = useStore.getState();

		// Detect which parts changed
		const settingsChanged =
			JSON.stringify(cur.settings) !==
			JSON.stringify(newData.settings);
		const statsChanged =
			JSON.stringify({
				daysWithCompletedGoal: cur.daysWithCompletedGoal,
				dailyActivity: cur.dailyActivity,
			}) !== JSON.stringify(newData.stats);

		if (!settingsChanged && !statsChanged) {
			return;
		}

		// Preserve currentActivity pointer before hydrate resets it
		const preservedActivity = cur.currentActivity;

		// Build the new state directly and apply to store
		const newSettings = settingsChanged
			? { ...DEFAULT_SETTINGS, ...newData.settings }
			: cur.settings;
		const newDays = statsChanged
			? newData.stats?.daysWithCompletedGoal ?? cur.daysWithCompletedGoal
			: cur.daysWithCompletedGoal;
		const newDaily = statsChanged
			? newData.stats?.dailyActivity ?? cur.dailyActivity
			: cur.dailyActivity;

		useStore.setState({
			settings: newSettings,
			daysWithCompletedGoal: newDays,
			dailyActivity: newDaily,
			today: cur.today,
			currentActivity: null,
			todayVersion: cur.todayVersion + 1,
			historicalVersion: cur.historicalVersion + 1,
		});

		// Restore currentActivity if its row still exists in the new data
		if (preservedActivity) {
			const match = (newDaily as DailyActivity[]).find(
				(r) =>
					r.date === preservedActivity.date &&
					r.filePath === preservedActivity.filePath,
			);
			if (match) {
				useStore.getState().setCurrentActivity(match);
			}
		}

		// Trigger a persist to update data.json from store
		useStore.getState().requestPersist();
	} catch (error) {
		console.error("Error in onExternalSettingsChange:", error);
	}
}
