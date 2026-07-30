import { VIEW_TYPE } from "@/ui/views/PluginView";

import { state } from "./pluginState";
import { getDB } from "@/db/db";

export async function checkPreviousStreak() {
  const data = state.plugin.data;

  if (!data.settings) return;

  const activities = await getDB().dailyActivity.toArray();

  const wordsByDate = activities.reduce<Record<string, number>>((acc, act) => {
    acc[act.date] = (acc[act.date] || 0) + act.wordsAdded;
    return acc;
  }, {});

  for (const [date, totalWords] of Object.entries(wordsByDate)) {
    if (
      totalWords > data.settings.dailyWritingGoal &&
      !data.stats?.daysWithCompletedGoal?.includes(date)
    ) {
      data.stats?.daysWithCompletedGoal?.push(date);
    }
  }
}

/**
 * @function activateSidebarView opens the SIDEBAR plugin view
 */
export async function activateSidebarView() {
  // Return if view already exists

  if (state.plugin.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) return; // add "window already open" notification, hm but its gonna focus later

  // Get the leaf and focus on it
  const leaf = state.plugin.app.workspace.getRightLeaf(false);
  if (leaf) {
    await leaf.setViewState({
      type: VIEW_TYPE,
      active: true,
    });
  }
}