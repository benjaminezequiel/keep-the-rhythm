import { ItemView, WorkspaceLeaf } from "obsidian";
import KeepTheRhythm from "../../main";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { KTRView } from "../components/SidebarView";

export const VIEW_TYPE = "keep-the-rhythm";

export class PluginCoreUI extends ItemView {
	plugin: KeepTheRhythm;
	root: Root | null = null;

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
		const container = this.containerEl.children[1];
		container.empty();
		const reactContainer = container.createDiv();
		const sideBarConfig =
			this.plugin.data.settings.sidebarConfig.visibility;
		this.root = createRoot(reactContainer);

		this.root.render(
			React.createElement(KTRView, {
				plugin: this.plugin,
				showHeatmap: sideBarConfig.showHeatmap,
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
		if (!this.root) return;

		const sideBarConfig =
			this.plugin.data.settings.sidebarConfig.visibility;

		this.root.render(
			React.createElement(KTRView, {
				plugin: this.plugin,
				showHeatmap: sideBarConfig.showHeatmap,
				showSlots: sideBarConfig.showSlots, // if you're using that too
			}),
		);
	}
}
