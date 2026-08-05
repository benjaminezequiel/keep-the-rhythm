import {
	deleteActivityFromDate,
	selectHistoricalVersion,
	selectTodayVersion,
} from "@/core/dataQueries";
import { Tooltip } from "./Tooltip";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import React from "react";
import { useMemo } from "react";
import { getActivityByDate } from "@/core/dataQueries";
import { getFileNameWithoutExtension } from "@/utils/utils";
import { useStore } from "@/core/store";
import { getPlugin } from "@/core/pluginRegistry";
import { getTodayEntries } from "@/utils/dailySummaryCache";
import { FileView, Notice, setIcon } from "obsidian";
import { ManualEntryModal } from "../components/ManualEntry";
import { EntryFilter } from "@/core/codeBlocks";

interface EntriesProps {
	date?: string;
	filters?: EntryFilter[];
}

export const Entries = ({ date: dateProp, filters }: EntriesProps) => {
	// Subscribe to today so the header label + default date stay live when
	// the calendar rolls over.
	const today = useStore((s) => s.today);
	const date = dateProp ?? today;
	const todayVersion = useStore(selectTodayVersion);
	const historicalVersion = useStore(selectHistoricalVersion);
	const isToday = date === today;

	// Today's path: O(1) from the partitioned cache, only refreshes when
	// todayVersion moves.  The cache returns a stable reference for
	// unchanged today data, so unrelated re-renders stay free.
	const todayEntries = useMemo(() => {
		return getTodayEntries();
	}, [todayVersion]);

	// Historical path: O(N) filter over dailyActivity, but only runs when
	// historicalVersion moves.  Keystrokes that only touch today bump
	// todayVersion - not historicalVersion - so this stays cached.
	const historicalEntries = useMemo(() => {
		return getActivityByDate(date);
	}, [date, historicalVersion]);

	const rawEntries = isToday ? todayEntries : historicalEntries;

	// Filter + sort live in their own useMemo so a `filters` change does
	// not re-fetch data, and a data change does not re-run the filter
	// against the same predicate.  The work is cheap (k < 10) but the
	// reference identity matters for the children below.
	const entries = useMemo(() => {
		const hasFilters = filters && filters.length > 0;
		return rawEntries
			.filter((entry) => {
				if (entry.wordsAdded == 0) return false;
				if (!hasFilters) return true;
				return filters!.every((f) => {
					if (f.type === "includes")
						return entry.filePath?.includes(f.value);
					if (f.type === "excludes")
						return !entry.filePath?.includes(f.value);
					return true;
				});
			})
			.sort((a, b) => b.wordsAdded - a.wordsAdded);
	}, [rawEntries, filters]);

	const addManualEntry = () => {
		new ManualEntryModal(getPlugin().app).open();
	};

	return (
		<div className="todayEntries__section">
			<RadixTooltip.Provider delayDuration={200}>
				<div className="todayEntries__header">
					<div className="todayEntries__section-title">
						{date == today ? "ENTRIES TODAY" : `ENTRIES (${date})`}
					</div>
					<Tooltip content="Add or Update Entry">
						<button
							className="todayEntries__manual-entry"
							ref={(el) => el && setIcon(el, "list-plus")}
							onMouseDown={addManualEntry}
						/>
					</Tooltip>
				</div>
				{entries && entries.length > 0 ? (
					entries.map((entry) => {
						const delta = entry.wordsAdded;
						const prefix = delta > 0 ? "+" : "";

						return (
              <div key={entry.filePath} className="todayEntires__list-item">
								<span
									className="todayEntries__file-path"
									onClick={async () => {
										const app = getPlugin().app;
                    const file = app.vault.getFileByPath(entry.filePath);

										if (!file) {
											new Notice("File not found!");
											return;
										}

                    const leaves = app.workspace.getLeavesOfType("markdown");
										for (const leaf of leaves) {
											if (
												leaf.view instanceof FileView &&
                        leaf.view.file?.path == file.path
											) {
												// Activate the existing leaf
                        app.workspace.setActiveLeaf(leaf);
												return;
											}
										}

                    const newLeaf = app.workspace.getLeaf("tab");

										await newLeaf.openFile(file);
									}}
								>
                  {getFileNameWithoutExtension(entry.filePath)}
								</span>
								<div className="todayEntries__list-item-right">
									<span className="todayEntries__word-count">
										{prefix}
										{delta.toLocaleString()}
									</span>
									<span className="todayEntries_list-item-unit">
										{" words"}
									</span>
									<Tooltip content="Delete entry">
										<button
											className="todayEntries__delete-button"
                      ref={(el) => el && setIcon(el, "trash-2")}
											onMouseDown={async () => {
                        await deleteActivityFromDate(entry.filePath, date);
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
