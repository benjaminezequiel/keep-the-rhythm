import { VIEW_TYPE } from "@/ui/views/PluginView";

import { state } from "./pluginState";
import { getDB } from "@/db/db";
import * as utils from "@/utils/utils";
import { Editor, MarkdownView, Notice } from "obsidian";
import {
	CustomCodeBlockType,
	getCustomCodeBlockTemplate,
} from "@/core/codeBlockTemplates";

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

export function insertCustomCodeBlock(
	type: CustomCodeBlockType,
	editor?: Editor,
) {
	const activeEditor =
		editor ??
		state.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;

	if (!activeEditor) {
		new Notice("KTR: Open a markdown file to insert a code block.");
		return;
	}

	activeEditor.replaceSelection(`${getCustomCodeBlockTemplate(type)}\n`);
}

/**
 * @function activateSidebarView opens the SIDEBAR plugin view
 */
export async function activateSidebarView() {
	const leaf = await state.plugin.app.workspace.ensureSideLeaf(
		VIEW_TYPE,
		"right",
		{
			active: true,
			reveal: true,
			split: true,
		},
	);

	if (leaf) {
		state.plugin.app.workspace.setActiveLeaf(leaf, {
			focus: true,
		});
	}
}
