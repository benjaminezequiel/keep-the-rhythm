import { deleteActivityFromDate } from "../../db/queries";
import { Tooltip } from "./Tooltip";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getActivityByDate } from "../../db/queries";
import { sumTimeEntries, getFileNameWithoutExtension } from "../../utils/utils";
import { useStore } from "@/core/store";
import { getPlugin } from "@/core/pluginRegistry";
import { DailyActivity } from "../../db/types";
import { FileView, Notice, setIcon } from "obsidian";
import { ManualEntryModal } from "../components/ManualEntry";
import { EntryFilter } from "@/core/codeBlocks";

interface EntriesProps {
  date?: string;
  filters?: EntryFilter[];
}

export const Entries = ({
  date: dateProp,
  filters,
}: EntriesProps) => {
  // Subscribe to today so the header label + default date stay live when
  // the calendar rolls over (DAY_CHANGED equivalent).
  const today = useStore((s) => s.today);
  const date = dateProp ?? today;

  // useLiveQuery auto re-runs whenever the underlying IndexedDB rows for
  // `date` change (insert / modify / delete), replacing the old
  // TODAY_DATA_CHANGED / HISTORY_DATA_CHANGED event listeners.
  const entries = useLiveQuery(
    async () => {
      const fetchedActivities = await getActivityByDate(date);

      return fetchedActivities
        .filter((entry) => sumTimeEntries(entry, true) != 0)
        .filter((entry) => {
          if (!filters || filters.length === 0) return true;
          return filters.every((f) => {
            if (f.type === "includes") return entry.filePath?.includes(f.value);
            if (f.type === "excludes")
              return !entry.filePath?.includes(f.value);
            return true;
          });
        })
        .sort((a, b) => {
          const aCount = sumTimeEntries(a, true);
          const bCount = sumTimeEntries(b, true);
          return bCount - aCount;
        });
    },
    [date, filters],
    [] as DailyActivity[],
  );

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
          <Tooltip content="Add Entry">
            <button
              className="todayEntries__manual-entry"
              ref={(el) => el && setIcon(el, "list-plus")}
              onMouseDown={addManualEntry}
            />
          </Tooltip>
        </div>
        {entries && entries.length > 0 ? (
          entries.map((entry) => {
            const delta = sumTimeEntries(entry, true);
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
