import { VIEW_TYPE } from "@/ui/views/PluginView";

import { state } from "./pluginState";
import { getDB } from "@/db/db";
import * as utils from "@/utils/utils";

/**
 * @function checkPreviousStreak check previous days to update streak if it is not correct
 * NOT SURE IF IT'S REALLY FULLY WORKING
 * ADD NOTIFICATION WITH RESULT
 */
export async function checkPreviousStreak() {
  const data = state.plugin.data;

  if (!data.settings) return;

  const activities = await getDB().dailyActivity.toArray();

  for (let i = 0; i < activities.length; i++) {
    const { totalWords } = utils.sumBothTimeEntries(activities[i]);
    if (
      totalWords > data.settings.dailyWritingGoal &&
      !data.stats?.daysWithCompletedGoal?.includes(activities[i].date)
    ) {
      data.stats?.daysWithCompletedGoal?.push(activities[i].date);
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
  const leaf = this.app.workspace.getRightLeaf(false);
  if (leaf) {
    await leaf.setViewState({
      type: VIEW_TYPE,
      active: true,
    });
  }
}
