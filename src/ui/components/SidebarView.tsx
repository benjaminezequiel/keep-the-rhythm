import React from "react";
import { Heatmap } from "./Heatmap";
import { SlotWrapper } from "./SlotWrapper";
import { useStore } from "@/core/store";
import { Entries } from "./Entries";

export const KTRView = () => {
  // Each selector subscribes to exactly the slice of settings it cares
  // about.  Zustand's default Object.is equality means the component only
  // re-renders when the selected value actually changes.
  const heatmapConfig = useStore((s) => s.settings.heatmapConfig);
  const showHeatmap = useStore(
    (s) => s.settings.sidebarConfig.visibility.showHeatmap,
  );
  const showEntries = useStore(
    (s) => s.settings.sidebarConfig.visibility.showEntries,
  );
  const showSlots = useStore(
    (s) => s.settings.sidebarConfig.visibility.showSlots,
  );

  return (
    <div className="sideBarView">
      {showSlots && <SlotWrapper />}
      {showHeatmap && <Heatmap heatmapConfig={heatmapConfig} />}
      {showEntries && <Entries />}
    </div>
  );
};
