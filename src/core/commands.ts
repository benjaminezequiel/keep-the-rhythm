import { VIEW_TYPE } from "@/ui/views/PluginView";

import { getPlugin } from "./pluginRegistry";
import { useStore } from "./store";
import { getDailySummaryMap } from "@/utils/dailySummaryCache";

export function checkPreviousStreak() {
	const {
		dailyActivity,
		today,
		todayVersion,
		historicalVersion,
		settings,
		daysWithCompletedGoal,
		requestPersist,
	} = useStore.getState();

	if (!dailyActivity) return;

	const wordsByDate = getDailySummaryMap(
		dailyActivity,
		today,
		todayVersion,
		historicalVersion,
	);

	const goal = settings.dailyWritingGoal;
	const existingSet = new Set(daysWithCompletedGoal);
	let changed = false;
	const updated = [...daysWithCompletedGoal];

	for (const [date, totalWords] of Object.entries(wordsByDate)) {
		if (existingSet.has(date)) continue;
		if (totalWords > goal) {
			updated.push(date);
			changed = true;
		}
	}

	if (changed) {
		useStore.setState({ daysWithCompletedGoal: updated });
		requestPersist();
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
