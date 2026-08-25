import { getLeafWithFile } from "../../utils/utils";
import { formatDate } from "@/utils/dateUtils";
import React from "react";
import { HeatmapColorModes } from "../../defs/types";
import * as obsidian from "obsidian";
import { Tooltip } from "./Tooltip";
import { getCorePluginSettings } from "../../utils/windowUtility";
import { state } from "@/core/pluginState";
import { moment as _moment } from "obsidian";
import { Unit } from "../../defs/types";
const moment = _moment as unknown as typeof _moment.default;

interface DailyNotesSettings {
	folder?: string;
	format?: string;
}

function isDailyNotesSettings(value: unknown): value is DailyNotesSettings {
	return typeof value === "object" && value !== null;
}

interface HeatmapCellProps {
	intensity: number;
	count: number;
	unit: Unit;
	dimmed?: boolean;
	date: string;
	mode: HeatmapColorModes;
	squared?: boolean;
}

export const HeatmapCell = ({
	intensity,
	count,
	unit,
	dimmed,
	date,
	mode,
	squared,
}: HeatmapCellProps) => {
	const handleClick = async (_event: React.MouseEvent<HTMLDivElement>) => {
		if (!state.plugin.data.settings.heatmapNavigation) return;

		const dailyNotesSettings = getCorePluginSettings("daily-notes");
		if (!isDailyNotesSettings(dailyNotesSettings)) return;
		let notePath = "";

		if (dailyNotesSettings?.folder) {
			notePath += dailyNotesSettings.folder.endsWith("/")
				? dailyNotesSettings.folder
				: dailyNotesSettings.folder + "/";
		}

		if (dailyNotesSettings?.format) {
			notePath += moment(date, "YYYY-MM-DD").format(
				dailyNotesSettings.format,
			);
		} else {
			notePath += date;
		}

		notePath += ".md";

		const existingFile =
			state.plugin.app.vault.getAbstractFileByPath(notePath);

		if (existingFile instanceof obsidian.TFile) {
			const existingLeaf = getLeafWithFile(
				state.plugin.app,
				existingFile,
			);
			if (existingLeaf) {
				state.plugin.app.workspace.setActiveLeaf(existingLeaf);
			} else {
				void state.plugin.app.workspace
					.getLeaf(true)
					.openFile(existingFile);
			}
		} else {
			const newFile = await state.plugin.app.vault.create(notePath, "");
			await state.plugin.app.workspace.getLeaf(true).openFile(newFile);
		}
	};

	let intensityClass = "";

	if (
		mode == HeatmapColorModes.STOPS ||
		mode == HeatmapColorModes.SOLID ||
		intensity == 0
	) {
		//  TODO: fix this, is not working :(
		intensityClass = "level-" + intensity + " ";
	} else if (mode == HeatmapColorModes.GRADUAL) {
		intensityClass = "proportional-intensity";
	} else if (mode == HeatmapColorModes.LIQUID) {
		intensityClass = "liquid-intensity";
	}
	const isTodayClass =
		date == formatDate(new Date()) ? "heatmap-square-today" : "";

	const isSquaredClass = squared ? "cell-squared" : "cell-rounded";

	const dimmedClass = dimmed ? "heatmap-square-dimmed" : "";
	const classes = `heatmap-square ${isTodayClass} ${isSquaredClass} ${intensityClass} ${dimmedClass}`;

	const style = {
		"--intensity": `${intensity}%`,
	} as React.CSSProperties & Record<string, string | number>;

	return (
		<Tooltip
			content={
				<>
					<strong>{date}</strong>
					<div>
						{count.toLocaleString()}{" "}
						{unit === Unit.WORD ? "words" : "characters"}
					</div>
				</>
			}
		>
			<div
				onClick={(event) => {
					void handleClick(event);
				}}
				className={classes}
				style={style}
			></div>
		</Tooltip>
	);
};
