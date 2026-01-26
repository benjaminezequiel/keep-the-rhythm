import { KeyProvider } from "@/utils/useModiferKey";
import React, { useEffect, useState } from "react";
import type { PluginData } from "@/defs/types";
import KeepTheRhythm from "@/main";
import { Heatmap } from "./Heatmap";
import { SlotWrapper } from "./SlotWrapper";
import { EVENTS, state } from "@/core/pluginState";
import { Entries } from "./Entries";

interface KTRView {
  data?: PluginData;
  showSlots?: boolean;
  showHeatmap?: boolean;
  showEntries?: boolean;
  plugin: KeepTheRhythm;
}

export const KTRView = ({ plugin }: KTRView) => {
  const [heatmapConfigState, setHeatmapConfigState] = useState(
    plugin.data.settings.heatmapConfig,
  );

  const [slots, setSlots] = useState(plugin.data.settings.sidebarConfig.slots);
  const [showHeatmap, setShowHeatmap] = useState(
    plugin.data.settings.sidebarConfig.visibility.showHeatmap,
  );
  const [showEntries, setShowEntries] = useState(
    plugin.data.settings.sidebarConfig.visibility.showEntries,
  );
  const [showSlots, setShowSlots] = useState(
    plugin.data.settings.sidebarConfig.visibility.showSlots,
  );

  const updateData = () => {
    setHeatmapConfigState(plugin.data.settings.heatmapConfig);

    setSlots(plugin.data.settings.sidebarConfig.slots);

    setShowHeatmap(plugin.data.settings.sidebarConfig.visibility.showHeatmap);
    setShowEntries(plugin.data.settings.sidebarConfig.visibility.showEntries);
    setShowSlots(plugin.data.settings.sidebarConfig.visibility.showSlots);
  };

  useEffect(() => {
    updateData();

    state.on(EVENTS.REFRESH_EVERYTHING, updateData);

    return () => {
      state.off(EVENTS.REFRESH_EVERYTHING, updateData);
    };
  }, []);

  return (
    <div
      className={`
			sideBarView 
			`}
    >
      <KeyProvider>
        {showSlots && <SlotWrapper slots={slots} />}
        {showHeatmap && (
          <Heatmap heatmapConfig={heatmapConfigState} query={""} />
        )}
        {showEntries && <Entries />}
      </KeyProvider>
    </div>
  );
};
