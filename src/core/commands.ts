import { VIEW_TYPE } from "@/ui/views/PluginView";

import { getPlugin } from "./pluginRegistry";

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
