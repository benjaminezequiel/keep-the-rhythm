export interface SettingItem {
	key: string;
	type: "toggle" | "number" | "dropdown" | "date" | "custom";
	title: string;
	description?: string;
	placeholder?: string;
	options?: Record<string, string>;
	visibleWhen?: Record<string, boolean | string[]>;
}

export interface SettingsSection {
	id: string;
	title: string;
	settings: SettingItem[];
}

export type SettingsSchema = {
	sections: SettingsSection[];
};

export const SETTINGS_SCHEMA: SettingsSchema = {
	sections: [
		{
			id: "general",
			title: "General",
			settings: [
				{
					key: "preferredUnit",
					type: "dropdown",
					title: "Preferred Unit",
					description: "Default unit used when displaying counts.",
					options: { WORD: "Words", CHAR: "Characters" },
				},
				{
					key: "enabledLanguages",
					type: "custom",
					title: "Enabled Languages",
					description: "Select which writing systems to count.",
				},
				{
					key: "dailyWritingGoal",
					type: "number",
					title: "Writing Goal",
					description:
						"Amount of words you intend to write on a day.",
					placeholder: "500",
				},
				{
					key: "ignoreComments",
					type: "toggle",
					title: "Don't count comments",
					description:
						"Text inside %% comments %% won't be counted. Changing this won't retroactively update your history.",
				},
				{
					key: "ignoreTasks",
					type: "toggle",
					title: "Don't count tasks",
					description:
						"Task lines like \"- [ ] buy milk\" won't be counted at all. Checkbox syntax is always excluded regardless of this setting. Changing this won't retroactively update your history.",
				},
				{
					key: "ignoreDeletedFiles",
					type: "toggle",
					title: "Ignore deleted files",
					description:
						"Deleting a file won't subtract its words and characters from your daily totals.",
				},
			],
		},
		{
			id: "heatmaps",
			title: "Heatmaps",
			settings: [
				{
					key: "heatmapNavigation",
					type: "toggle",
					title: "Clicking a Cell Opens its Daily Note",
				},
				{
					key: "heatmapConfig.roundCells",
					type: "toggle",
					title: "Rounded Cells",
				},
				{
					key: "heatmapConfig.hideMonthLabels",
					type: "toggle",
					title: "Hide Month Labels",
				},
				{
					key: "heatmapConfig.hideWeekdayLabels",
					type: "toggle",
					title: "Hide Weekday Labels",
				},
				{
					key: "heatmapConfig.alignLeft",
					type: "toggle",
					title: "Align heatmap cells to the left",
				},
				{
					key: "heatmapConfig.startDate",
					type: "date",
					title: "Custom Start Date",
					description:
						"Makes the heatmap start from a specific date (like the start of the year).",
				},
				{
					key: "heatmapConfig.numberOfWeeks",
					type: "number",
					title: "Default number of weeks displayed",
				},
				{
					key: "heatmapConfig.intensityMode",
					type: "custom",
					title: "Coloring Mode",
					description: "Changes how the heatmap cells are filled.",
				},
				{
					key: "heatmapConfig.intensityStops",
					type: "custom",
					title: "Intensity thresholds",
					description:
						"Changes how the color of each cell is calculated.",
				},

				{
					key: "heatmapConfig.colors[light]",
					type: "custom",
					title: "Light Theme Colors",
					description:
						"Colors used to paint each cell, ranges vary based on coloring mode.",
				},
				{
					key: "heatmapConfig.colors[dark]",
					type: "custom",
					title: "Dark Theme Colors",
					description:
						"Colors used to paint each cell, ranges vary based on coloring mode.",
				},
			],
		},
		{
			id: "sidebar",
			title: "Sidebar",
			settings: [
				{
					key: "sidebarConfig.visibility.showSlots",
					type: "toggle",
					title: "Show overview",
					description:
						"Display the overview section in the word count heatmap.",
				},
				{
					key: "sidebarConfig.visibility.showGoalWidget",
					type: "toggle",
					title: "Show daily goal widget",
					description:
						"Display an animated ring showing progress towards today's writing goal.",
				},
				{
					key: "sidebarConfig.visibility.showEntries",
					type: "toggle",
					title: "Show today's entries",
					description:
						"Display which files were edited today and their respective word counts.",
				},
				{
					key: "sidebarConfig.visibility.showHeatmap",
					type: "toggle",
					title: "Show heatmap",
					description:
						"Displays a heatmap with historic writing data.",
				},
			],
		},
		{
			id: "backup",
			title: "Backup",
			settings: [
				{
					key: "backupConfig.enabled",
					type: "toggle",
					title: "Automatic Backups",
					description:
						"For safety, disabling this does not delete existing back-ups, you have to do it manually.",
				},
				{
					key: "backupConfig.folderPath",
					type: "custom",
					title: "Backup Folder Path",
					description:
						"Location where backup files will be stored (relative to vault root).",
					placeholder: ".keep-the-rhythm",
					visibleWhen: { "backupConfig.enabled": true },
				},
				{
					key: "backupConfig.maxNumberOfBackups",
					type: "number",
					title: "Maximum Number of Backups",
					description:
						"How many backup files to keep. Older backups will be automatically deleted.",
					placeholder: "3",
					visibleWhen: { "backupConfig.enabled": true },
				},
			],
		},
	],
};
