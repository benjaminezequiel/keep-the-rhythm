import {
	deleteActivityFromDate,
	selectHistoricalVersion,
} from "@/core/dataQueries";
import { Tooltip } from "./Tooltip";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { getActivityByDate } from "@/core/dataQueries";
import { getFileNameWithoutExtension } from "@/utils/utils";
import { useStore } from "@/core/store";
import { getPlugin } from "@/core/pluginRegistry";
import { FileView, Notice, setIcon } from "obsidian";
import { ManualEntryModal } from "../components/ManualEntry";
import { EntryFilter } from "@/core/codeBlocks";
import { DailyActivity } from "@/defs/types";

interface EntriesProps {
	date?: string;
	filters?: EntryFilter[];
}

interface EntryRowProps {
	entry: DailyActivity;
	onOpenFile: (filePath: string) => void;
	onDelete: (filePath: string) => void;
}

/**
 * Memoized row: only re-renders when the entry itself changes (filePath or
 * wordsAdded) or when handlers change.  With React.memo the other rows skip
 * reconciliation entirely on each keystroke, instead of N rows each getting
 * a fresh prop bundle.
 */
const EntryRow = React.memo(function EntryRow({
	entry,
	onOpenFile,
	onDelete,
}: EntryRowProps) {
	const deleteButtonRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		const el = deleteButtonRef.current;
		if (el) setIcon(el, "trash-2");
	}, []);

	const delta = entry.wordsAdded;
	const prefix = delta > 0 ? "+" : "";

	return (
		<div className="todayEntires__list-item">
			<span
				className="todayEntries__file-path"
				onClick={() => onOpenFile(entry.filePath)}
			>
				{getFileNameWithoutExtension(entry.filePath)}
			</span>
			<div className="todayEntries__list-item-right">
				<span className="todayEntries__word-count">
					{prefix}
					{delta.toLocaleString()}
				</span>
				<span className="todayEntries_list-item-unit">{" words"}</span>
				<Tooltip content="Delete entry">
					<button
						ref={deleteButtonRef}
						className="todayEntries__delete-button"
						onMouseDown={() => onDelete(entry.filePath)}
					/>
				</Tooltip>
			</div>
		</div>
	);
});

export const Entries = ({ date: dateProp, filters }: EntriesProps) => {
	// Subscribe to today so the header label + default date stay live when
	// the calendar rolls over.
	const today = useStore((s) => s.today);
	const date = dateProp ?? today;
	const historicalVersion = useStore(selectHistoricalVersion);
	const isToday = date === today;

	const todayEntries = useStore((s) => s.todayActivity);

	// Historical path: O(N) filter over dailyActivity, but only runs when
	// historicalVersion moves.  Keystrokes that only touch today bump
	// todayVersion - not historicalVersion - so this stays cached.
	const historicalEntries = useMemo(() => getActivityByDate(date), [
		date,
		historicalVersion,
	]);

	const rawEntries = isToday ? todayEntries : historicalEntries;

	const matchesFilters = (entry: DailyActivity): boolean => {
		if (entry.wordsAdded === 0) return false;
		// "date" type is resolved upstream into the `date` prop, so only
		// includes/excludes reach this predicate.
		return (filters ?? []).every((f) => {
			if (f.type === "includes") return entry.filePath.includes(f.value);
			if (f.type === "excludes") return !entry.filePath.includes(f.value);
			return true;
		});
	};

	// Filter + sort live in their own useMemo so a `filters` change does
	// not re-fetch data, and a data change does not re-run the filter
	// against the same predicate.  The work is cheap (k < 10) but the
	// reference identity matters for the children below.
	const entries = useMemo(
		() =>
			rawEntries
				.filter(matchesFilters)
				.sort((a, b) => b.wordsAdded - a.wordsAdded),
		[rawEntries, filters],
	);

	const addManualEntry = useCallback(() => {
		new ManualEntryModal(getPlugin().app).open();
	}, []);

	const setManualEntryIcon = useCallback((el: HTMLButtonElement | null) => {
		if (el && !el.dataset.iconSet) {
			setIcon(el, "list-plus");
			el.dataset.iconSet = "1";
		}
	}, []);

	const handleOpenFile = useCallback(async (filePath: string) => {
		const app = getPlugin().app;
		const file = app.vault.getFileByPath(filePath);

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
				app.workspace.setActiveLeaf(leaf);
				return;
			}
		}

		const newLeaf = app.workspace.getLeaf("tab");
		await newLeaf.openFile(file);
	}, []);

	const handleDelete = useCallback(
		(filePath: string) => {
			void deleteActivityFromDate(filePath, date);
		},
		[date],
	);

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
							ref={setManualEntryIcon}
							onMouseDown={addManualEntry}
						/>
					</Tooltip>
				</div>
				{entries && entries.length > 0 ? (
					entries.map((entry) => (
						<EntryRow
							key={entry.filePath}
							entry={entry}
							onOpenFile={handleOpenFile}
							onDelete={handleDelete}
						/>
					))
				) : (
					<p className="empty-data">No files edited today</p>
				)}
			</RadixTooltip.Provider>
		</div>
	);
};
