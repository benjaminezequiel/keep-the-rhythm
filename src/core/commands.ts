import { VIEW_TYPE } from "@/ui/views/PluginView";

import { getPlugin } from "./pluginRegistry";
import { useStore } from "./store";
import { getDailySummaryMap } from "@/utils/dailySummaryCache";

export function checkPreviousStreak() {
	const plugin = getPlugin();
	const data = plugin.data;

	if (!data.settings) return;
	if (!data.stats?.dailyActivity) return;

	const { dailyActivity, today, todayVersion, historicalVersion } =
		useStore.getState();

	const wordsByDate = getDailySummaryMap(
		dailyActivity,
		today,
		todayVersion,
		historicalVersion,
	);

	let changed = false;
	for (const [date, totalWords] of Object.entries(wordsByDate)) {
		if (data.stats?.daysWithCompletedGoal?.includes(date)) {
			continue;
		}
		if (totalWords > data.settings.dailyWritingGoal) {
			data.stats?.daysWithCompletedGoal?.push(date);
			changed = true;
		}
	}

	// Sync the store's streak list so Slot / Entries selectors re-render,
	// and schedule a unified debounced JSON save.
	if (changed) {
		useStore.setState({
			daysWithCompletedGoal: [
				...(plugin.data.stats?.daysWithCompletedGoal || []),
			],
		});
		useStore.getState().requestPersist();
	}
}

/**
 * @function activateSidebarView opens the SIDEBAR plugin view
 */
export async function activateSidebarView() {
	const app = getPlugin().app;
	// Return if view already exists
	if (app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) return;

	// Get the leaf and focus on it
	const leaf = app.workspace.getRightLeaf(false);
	if (leaf) {
		await leaf.setViewState({
			type: VIEW_TYPE,
			active: true,
		});
	}
}
