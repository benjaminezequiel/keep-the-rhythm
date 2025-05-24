import { getLeafWithFile } from "../../utils/utils";
import { formatDate } from "@/utils/dateUtils";
import { weekdaysNames, monthNames } from "../texts";
import { db } from "../../db/db";
import React from "react";
import { HeatmapColorModes, IntensityConfig } from "../../defs/types";
import * as obsidian from "obsidian";
import { Tooltip } from "./Tooltip";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { useCtrlKey } from "../../utils/useModiferKey";
import { getCorePluginSettings } from "../../utils/windowUtility";
import { state } from "@/core/pluginState";
import { Heatmap } from "./Heatmap";
import { moment as _moment } from "obsidian";
const moment = _moment as unknown as typeof _moment.default;

interface HeatmapCellProps {
	intensity: number;
	count: number;
	date: string;
	mode: HeatmapColorModes;
	squared?: boolean;
}

export const HeatmapCell = ({
	intensity,
	count,
	date,
	mode,
	squared,
}: HeatmapCellProps) => {
	const handleClick = async (event: React.MouseEvent<HTMLDivElement>) => {
		const dailyNotesSettings = getCorePluginSettings("daily-notes");
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
				state.plugin.app.workspace.getLeaf(true).openFile(existingFile);
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

	const classes = `heatmap-square ${isTodayClass} ${isSquaredClass} ${intensityClass}`;

	const style = {
		"--intensity": `${intensity}%`,
	} as React.CSSProperties & Record<string, string | number>;

	return (
		<Tooltip
			content={
				<>
					<strong>{date}</strong>
					<div>{count.toLocaleString()} words</div>
				</>
			}
		>
			<div onClick={handleClick} className={classes} style={style}></div>
		</Tooltip>
	);
};
