import { deleteActivityById } from "../../db/queries";
import { Tooltip } from "./Tooltip";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActivityByDate } from "../../db/queries";
import { sumTimeEntries, getFileNameWithoutExtension } from "../../utils/utils";
import { state, EVENTS } from "../../core/pluginState";
import { DailyActivity } from "../../db/types";
import { Unit } from "../../defs/types";
import { FileView, Notice, setIcon } from "obsidian";
import { ManualEntryModal } from "../components/ManualEntry";
import { EntryFilter } from "@/core/codeBlocks";

interface EntriesProps {
	date?: string;
	filters?: EntryFilter[];
}

const matchesFilters = (entry: DailyActivity, filters?: EntryFilter[]) => {
	if (!filters || filters.length === 0) return true;
	const path = entry.filePath ?? "";
	return filters.every((f) => {
		if (f.type === "includes") return path.includes(f.value);
		if (f.type === "excludes") return !path.includes(f.value);
		return true;
	});
};

export const Entries = ({ date, filters }: EntriesProps) => {
	const [unit, setUnit] = useState<Unit>(
		state.plugin.data.settings.preferredUnit ?? Unit.WORD,
	);
	const [entries, setEntries] = useState<DailyActivity[]>([]);

	const [today, setToday] = useState<string>(state.today);

	const requestId = useRef(0);
	const mounted = useRef(true);

	const activeDate = date ?? today;

	const handleEntriesRefresh = useCallback(async () => {
		const targetDate = date ?? state.today;
		setToday(state.today);

		const id = ++requestId.current;
		const fetched = await getActivityByDate(targetDate);

		if (!mounted.current || id !== requestId.current) return;

		setEntries(fetched.filter((entry) => matchesFilters(entry, filters)));
	}, [date, filters]);

	useEffect(() => {
		mounted.current = true;
		const handleRefresh = () => {
			void handleEntriesRefresh();
		};
		handleRefresh();

		state.on(EVENTS.REFRESH_EVERYTHING, handleRefresh);
		return () => {
			mounted.current = false;
			state.off(EVENTS.REFRESH_EVERYTHING, handleRefresh);
		};
	}, [handleEntriesRefresh]);

	const visibleEntries = useMemo(() => {
		return entries
			.map((entry) => {
				const isDeleted = !state.plugin.app.vault.getFileByPath(
					entry.filePath,
				);
				const delta = sumTimeEntries(entry, unit, true);
				return { entry, delta, isDeleted };
			})
			.filter(({ delta, isDeleted }) => delta !== 0 || isDeleted)
			.sort((a, b) => b.delta - a.delta);
	}, [entries, unit]);

	const toggleUnit = () => {
		setUnit((prev) => (prev === Unit.WORD ? Unit.CHAR : Unit.WORD));
	};

	const addManualEntry = () => {
		new ManualEntryModal(state.plugin.app).open();
	};

	const openFile = async (filePath?: string) => {
		if (!filePath) {
			new Notice("File not found!");
			return;
		}

		const file = state.plugin.app.vault.getFileByPath(filePath);
		if (!file) {
			new Notice("File not found!");
			return;
		}

		const leaves = state.plugin.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			if (
				leaf.view instanceof FileView &&
				leaf.view.file?.path === file.path
			) {
				state.plugin.app.workspace.setActiveLeaf(leaf);
				return;
			}
		}

		const newLeaf = state.plugin.app.workspace.getLeaf("tab");
		await newLeaf.openFile(file);
	};

	const isToday = activeDate === today;

	return (
		<div className="todayEntries__section">
			<RadixTooltip.Provider delayDuration={200}>
				<div className="todayEntries__header">
					<div className="todayEntries__section-title">
						{isToday ? "ENTRIES TODAY" : `ENTRIES (${activeDate})`}
					</div>
					<Tooltip content="Add Entry">
						<button
							className="todayEntries__manual-entry"
							ref={(el) => el && setIcon(el, "list-plus")}
							onMouseDown={addManualEntry}
						/>
					</Tooltip>
					<Tooltip content="Toggle Unit">
						<button
							className="todayEntries__entry-unit"
							ref={(el) => el && setIcon(el, "case-sensitive")}
							onMouseDown={toggleUnit}
						/>
					</Tooltip>
				</div>
				{visibleEntries.length > 0 ? (
					visibleEntries.map(({ entry, delta, isDeleted }) => {
						const prefix = delta > 0 ? "+" : "";

						return (
							<div
								key={
									entry.id ??
									`${entry.date}:${entry.filePath}`
								}
								className={
									isDeleted
										? "todayEntries__list-item todayEntries__list-item--deleted"
										: "todayEntries__list-item"
								}
							>
								<span
									className="todayEntries__file-path"
									onClick={() => {
										void openFile(entry.filePath);
									}}
								>
									{getFileNameWithoutExtension(
										entry.filePath,
									)}
								</span>
								<div className="todayEntries__list-item-right">
									{/* {isDeleted && (
										<span className="todayEntries__deleted-label">
											DELETED
										</span>
									)} */}
									{delta !== 0 && (
										<>
											<span className="todayEntries__word-count">
												{prefix}
												{delta.toLocaleString()}
											</span>
											<span className="todayEntries_list-item-unit">
												{" " + unit.toLowerCase() + "s"}
											</span>
										</>
									)}
									<Tooltip content="Delete entry">
										<button
											className="todayEntries__delete-button"
											ref={(el) =>
												el && setIcon(el, "trash-2")
											}
											onMouseDown={() => {
												void (async () => {
													if (
														entry.id === undefined
													) {
														new Notice(
															"Entry has no ID, cannot delete.",
														);
														return;
													}
													await deleteActivityById(
														entry.id,
													);
													state.emit(
														EVENTS.REFRESH_EVERYTHING,
													);
												})();
											}}
										/>
									</Tooltip>
								</div>
							</div>
						);
					})
				) : (
					<p className="empty-data">
						{isToday
							? "No files edited today"
							: "No files edited on this date"}
					</p>
				)}
			</RadixTooltip.Provider>
		</div>
	);
};
