import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { Heatmap } from "../components/Heatmap";
import WordCountPlugin from "../../main";
import { IntensityConfig } from "src/types";

export const VIEW_TYPE = "keep-the-rhythm";

export class WordCountView extends ItemView {
	plugin: WordCountPlugin;
	root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: WordCountPlugin) {
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
		const container = this.containerEl.children[1];
		container.empty();
		const reactContainer = container.createEl("div");
		this.root = createRoot(reactContainer);
		this.root.render(
			React.createElement(Heatmap, {
				data: this.plugin.mergedStats,
				intensityLevels:
					this.plugin.pluginData.settings.intensityLevels,
				showOverview: this.plugin.pluginData.settings.showOverview,
			}),
		);
	}

	async onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}

	refresh(): void {
		this.root?.render(
			React.createElement(Heatmap, {
				data: this.plugin.mergedStats,
				intensityLevels:
					this.plugin.pluginData.settings.intensityLevels,
				showOverview: this.plugin.pluginData.settings.showOverview,
			}),
		);
	}
}
