import { getLeafWithFile } from "../../utils/utils";
import { formatDate } from "@/utils/dateUtils";
import { weekdaysNames, monthNames } from "../texts";
import React from "react";
import { HeatmapColorModes, IntensityConfig } from "../../defs/types";
import * as obsidian from "obsidian";
import { Tooltip } from "./Tooltip";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { useCtrlKey } from "../../utils/useModiferKey";
import { getCorePluginSettings } from "../../utils/windowUtility";
import { getPlugin } from "@/core/pluginRegistry";
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
	const handleClick = async (_event: React.MouseEvent<HTMLDivElement>) => {
		const app = getPlugin().app;
		if (!getPlugin().data.settings.heatmapNavigation) return;

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

		const existingFile = app.vault.getAbstractFileByPath(notePath);

		if (existingFile instanceof obsidian.TFile) {
			const existingLeaf = getLeafWithFile(app, existingFile);
			if (existingLeaf) {
				app.workspace.setActiveLeaf(existingLeaf);
			} else {
				app.workspace.getLeaf(true).openFile(existingFile);
			}
		} else {
			const newFile = await app.vault.create(notePath, "");
			await app.workspace.getLeaf(true).openFile(newFile);
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
