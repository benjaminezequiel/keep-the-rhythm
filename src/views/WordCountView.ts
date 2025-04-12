import { ItemView, WorkspaceLeaf } from "obsidian";
import KeepTheRhythm from "../../main";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { Heatmap, HeatmapCell } from "@/components/Heatmap";
import { IntensityConfig } from "src/types";
import { formatDate } from "@/utils";
import { TrainFrontTunnelIcon } from "lucide-react";

export const VIEW_TYPE = "keep-the-rhythm";

export class PluginCoreUI extends ItemView {
	plugin: KeepTheRhythm;
	root: Root | null;

	constructor(leaf: WorkspaceLeaf, plugin: KeepTheRhythm) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return "Keep the Rhythm";
	}

	getIcon(): string {
		return "calendar-days";
	}

	async onOpen() {
		console.log("KTR view openened");
		const container = this.containerEl.children[1];
		container.empty();
		const reactContainer = container.createEl("div");
		this.root = createRoot(reactContainer);
		this.root.render(
			React.createElement(HeatmapCell, {
				date: formatDate(new Date()),
				count: 100,
				intensityLevels: this.plugin.data.settings.intensityStops,
			}),
		);
		this.root.render(
			React.createElement(Heatmap, {
				data: this.plugin.data,
				intensityLevels: this.plugin.data.settings.intensityStops,
				showOverview: true,
				showEntries: true,
				plugin: this.plugin,
			}),
		);
		// this.root.render(
		// 	React.createElement(Heatmap, {
		// 		data: this.plugin.mergedStats,
		// 		intensityLevels:
		// 			this.plugin.pluginData.settings.intensityLevels,
		// 		showOverview: this.plugin.pluginData.settings.showOverview,
		// 		showHeatmap: this.plugin.pluginData.settings.showHeatmap,
		// 		showEntries: this.plugin.pluginData.settings.showEntries,
		// 		plugin: this.plugin,
		// 	}),
		// );
	}

	async onClose() {
		console.log("KTR view closed");
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}

	refresh(): void {
		// this.root?.render(
		// 	React.createElement(Heatmap, {
		// 		data: this.plugin.mergedStats,
		// 		intensityLevels:
		// 			this.plugin.pluginData.settings.intensityLevels,
		// 		showOverview: this.plugin.pluginData.settings.showOverview,
		// 		showHeatmap: this.plugin.pluginData.settings.showHeatmap,
		// 		showEntries: this.plugin.pluginData.settings.showEntries,
		// 		plugin: this.plugin,
		// 	}),
		// );
	}
}
