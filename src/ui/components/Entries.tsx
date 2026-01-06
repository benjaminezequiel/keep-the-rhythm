import { deleteActivityFromDate, deleteActivityById } from "../../db/queries";
import { Tooltip } from "./Tooltip";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import React from "react";
import { useEffect, useState, useRef } from "react";
import { formatDate } from "../../utils/dateUtils";
import { getActivityByDate } from "../../db/queries";
import { sumTimeEntries, getFileNameWithoutExtension } from "../../utils/utils";
import { state, EVENTS } from "../../core/pluginState";
import { DailyActivity } from "../../db/types";
import { Unit } from "../../defs/types";
import { MarkdownView, FileView, Notice, setIcon, TFile } from "obsidian";
import { getDB } from "../../db/db";
import { getWordCount } from "../../core/wordCounting";

interface EntriesProps {
	date?: string;
}
export const Entries = ({ date = formatDate(new Date()) }: EntriesProps) => {
	const [unit, setUnit] = useState<Unit>(Unit.WORD);
	const [entries, setEntries] = useState<DailyActivity[]>([]);

	const deleteButtonRef = useRef<HTMLButtonElement>(null);

	if (
		deleteButtonRef instanceof HTMLElement &&
		!deleteButtonRef.dataset.iconSet
	) {
		setIcon(deleteButtonRef, "trash-2");
		deleteButtonRef.dataset.iconSet = "true";
	}

	const handleEntriesRefresh = async () => {
		const fetchedActivities = await getActivityByDate(date);

		const pathCounts = new Map<string, number>();
		for (const activity of fetchedActivities) {
			if (activity.filePath) {
				pathCounts.set(
					activity.filePath,
					(pathCounts.get(activity.filePath) || 0) + 1,
				);
			}
		}

		setEntries(
			fetchedActivities
				.filter((entry) => sumTimeEntries(entry, Unit.WORD, true) != 0)
				.sort((a, b) => {
					const aCount = sumTimeEntries(a, unit, true);
					const bCount = sumTimeEntries(b, unit, true);
					return bCount - aCount;
				}),
		);
	};

	const toggleUnit = () => {
		setUnit(unit == Unit.WORD ? Unit.CHAR : Unit.WORD);
	};

	useEffect(() => {
		handleEntriesRefresh();
		state.on(EVENTS.REFRESH_EVERYTHING, handleEntriesRefresh);

		return () => {
			state.off(EVENTS.REFRESH_EVERYTHING, handleEntriesRefresh);
		};
	}, []);

	return (
		<div className="todayEntries__section">
			<RadixTooltip.Provider delayDuration={200}>
				<div className="todayEntries__header">
					<div className="todayEntries__section-title">
						{date == state.today
							? "ENTRIES TODAY"
							: `ENTRIES (${date})`}
					</div>
					<Tooltip content="Toggle Unit">
						<button
							className="todayEntries__entry-unit"
							ref={(el) => el && setIcon(el, "case-sensitive")}
							onMouseDown={toggleUnit}
						/>
					</Tooltip>
				</div>
				{entries.length > 0 ? (
					entries.map((entry) => {
						const delta = sumTimeEntries(entry, unit, true);
						const prefix = delta > 0 ? "+" : "";

						return (
							<div
								key={entry.filePath}
								className="todayEntires__list-item"
							>
								<span
									className="todayEntries__file-path"
									onClick={async () => {
										const file =
											state.plugin.app.vault.getFileByPath(
												entry.filePath,
											);

										if (!file) {
											new Notice("File not found!");
											return;
										}

										const leaves =
											state.plugin.app.workspace.getLeavesOfType(
												"markdown",
											);
										for (const leaf of leaves) {
											if (
												leaf.view instanceof FileView &&
												leaf.view.file?.path ==
													file.path
											) {
												// Activate the existing leaf
												state.plugin.app.workspace.setActiveLeaf(
													leaf,
												);
												return;
											}
										}

										const newLeaf =
											state.plugin.app.workspace.getLeaf(
												"tab",
											);

										await newLeaf.openFile(file);
									}}
								>
									{getFileNameWithoutExtension(
										entry.filePath,
									)}
								</span>
								<div className="todayEntries__list-item-right">
									<span className="todayEntries__word-count">
										{prefix}
										{delta.toLocaleString()}
									</span>
									<span className="todayEntries_list-item-unit">
										{" " + unit.toLowerCase() + "s"}
									</span>
									<Tooltip content="Delete entry">
										<button
											className="todayEntries__delete-button"
											ref={(el) =>
												el && setIcon(el, "trash-2")
											}
											onMouseDown={async (e) => {
    e.stopPropagation();

    if (entry.id === undefined) {
        new Notice("Error: Entry ID is missing.");
        return;
    }
    const oldId = entry.id;

    await deleteActivityById(oldId);

    const workspace = state.plugin.app.workspace;
    const targetLeaf = workspace.getLeavesOfType("markdown").find((leaf) => {
        // @ts-ignore
        return leaf.view.file && leaf.view.file.path === entry.filePath;
    });

    if (targetLeaf) {
        // @ts-ignore
        const editor = targetLeaf.view.editor;
        const content = editor.getValue();

        const pluginInstance = state.plugin as any;
        const settings = pluginInstance.data?.settings || pluginInstance.settings || {};
        const enabledLanguages = settings.enabledLanguages || [];

        let wordRegex = /\S+/g;

        if (enabledLanguages.length === 4) {
            wordRegex = /[\u4e00-\u9fa5]|[a-zA-Z0-9_\-]+/g;
        } else if (enabledLanguages.length > 4) {
            wordRegex = /[\p{L}\p{N}\p{M}\-_]+|\p{P}|\p{S}/gu;
        } else {
            wordRegex = /\S+/g;
        }

        const currentWords = getWordCount(content, wordRegex);
        const currentChars = content.length;

        const anchorChange = {
            timeKey: Date.now().toString(),
            w: 0,
            c: 0
        };

        const newEntryData = {
            filePath: entry.filePath,
            date: entry.date,
            wordCountStart: currentWords,
            charCountStart: currentChars,
            changes: [anchorChange],
        };

        const newId = await getDB().dailyActivity.add(newEntryData);

        if (state.currentActivity && state.currentActivity.filePath === entry.filePath) {
            state.currentActivity.id = newId;
            state.currentActivity.wordCountStart = currentWords;
            state.currentActivity.charCountStart = currentChars;
            state.currentActivity.changes = [anchorChange];
        }
    }

    state.emit(EVENTS.REFRESH_EVERYTHING);
											}}
										/>
									</Tooltip>
								</div>
							</div>
						);
					})
				) : (
					<p className="empty-data">No files edited today</p>
				)}
			</RadixTooltip.Provider>
		</div>
	);
};
