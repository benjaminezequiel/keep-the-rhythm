export type CustomCodeBlockType = "heatmap" | "slots" | "entries";

export function getCustomCodeBlockTemplate(type: CustomCodeBlockType): string {
	switch (type) {
		case "heatmap":
			return [
				"```ktr-heatmap",
				'filePath starts_with "journal"',
				"",
				"OPTIONS",
				"HIDE month_labels, weekday_labels",
				"COLORING_MODE liquid",
				"STOPS 100, 500, 1000",
				"WEEKS 24",
				"CENTER",
				"```",
			].join("\n");
		case "slots":
			return [
				"```ktr-slots",
				"CURRENT_WEEK, WORDS",
				"CURRENT_DAY, CHARS",
				"CURRENT_STREAK",
				"WHOLE_VAULT",
				"CURRENT_MONTH, WORDS, AVG",
				"```",
			].join("\n");
		case "entries":
			return ["```ktr-entries", "2024-03-15", "```"].join("\n");
		default:
			return "```ktr-entries\n2024-03-15\n```";
	}
}

export const CUSTOM_CODE_BLOCK_COMMANDS: Array<{
	key: CustomCodeBlockType;
	label: string;
	id: string;
}> = [
	{ key: "heatmap", label: "Heatmap", id: "insert-heatmap-block" },
	{ key: "slots", label: "Slots", id: "insert-slots-block" },
	{ key: "entries", label: "Entries", id: "insert-entries-block" },
];
