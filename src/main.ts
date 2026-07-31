import { ManualEntryModal } from "./ui/components/ManualEntry";
import { Plugin, TFile, TAbstractFile, moment as _moment } from "obsidian";

import { ColorConfig, DEFAULT_SETTINGS, PluginData } from "@/defs/types";

import { setPlugin } from "@/core/pluginRegistry";
import { useStore } from "@/core/store";
import { PluginView, VIEW_TYPE } from "@/ui/views/PluginView";
import { SettingsTab } from "@/ui/settings/SettingsTab";

import * as events from "@/core/events";
import * as codeBlocks from "@/core/codeBlocks";
import { checkPreviousStreak, activateSidebarView } from "@/core/commands";
import { backupData } from "@/core/backup";
import {
	initializeDataFromJSON,
	flushToJSON,
	setupPersistenceScheduling,
	PersistenceScheduler,
} from "@/core/dataPersistence";
import { handleExternalSettingsChange } from "@/core/externalSync";

export default class KeepTheRhythm extends Plugin {
	data: PluginData = {
		schema: "1.0",
		settings: DEFAULT_SETTINGS,
		stats: {
			dailyActivity: [],
		},
	};

	private onFocusHandler: (() => void) | null = null;

	// Persistence scheduler with debounce state and unsubscribe handle
	private persistenceScheduler: PersistenceScheduler | null = null;

	async onload() {
		setPlugin(this);
		this.onFocusHandler = () => useStore.getState().checkDayChange();
		window.addEventListener("focus", this.onFocusHandler);

		// No DB to initialise — the in-memory store is empty until
		// initializeDataFromJSON hydrates it from data.json below.
		const loadedData = await this.loadData();

		await backupData(loadedData, this.app);

		await initializeDataFromJSON(this, loadedData);

		// Sync Zustand store with loaded plugin data before any React
		// component mounts.  After this point, store.settings /
		// store.daysWithCompletedGoal / store.today are all populated.
		useStore.getState().hydrateFromPluginData();

		/** Initialize SIDEBAR view */
		this.registerView(VIEW_TYPE, (leaf) => {
			return new PluginView(leaf, this);
		});

		this.initializeCommands();
		this.initializeEvents();
		this.initializeCodeBlocks();
		this.applyColorStyles();
		this.addSettingTab(new SettingsTab(this.app, this));

		// The JSON save pipeline subscribes to the store's persistVersion
		// counter, which is incremented (via requestPersist, rAF-coalesced)
		// by the data layer after an in-memory mutation. Pure UI refresh
		// never touches persistVersion, so it can't schedule a save — this
		// prevents racing saves when only an in-memory activity object was
		// mutated before flushChangesToJSON.
		this.persistenceScheduler = setupPersistenceScheduling(this);
	}

	public applyColorStyles() {
		const containerStyle = this.app.workspace.containerEl.style;
		let light = undefined;
		let dark = undefined;

		if (this.data.settings?.heatmapConfig?.colors) {
			light = this.data.settings.heatmapConfig.colors?.light;
			dark = this.data.settings.heatmapConfig.colors?.dark;
		}

		if (light && dark) {
			for (let i = 0; i <= 4; i++) {
				const key = i as keyof ColorConfig;
				containerStyle.setProperty(`--light-${i}`, light[key]);
				containerStyle.setProperty(`--dark-${i}`, dark[key]);
			}
		}
	}

	private initializeCommands() {
		this.addRibbonIcon("calendar-days", "Keep the Rhythm", () => {
			activateSidebarView();
		});

		this.addCommand({
			id: "open-keep-the-rhythm",
			name: "Open sidebar view",
			callback: () => {
				activateSidebarView();
			},
		});

		this.addCommand({
			id: "add-ktr-manual-entry",
			name: "Add manual entry",
			callback: () => {
				new ManualEntryModal(this.app).open();
			},
		});

		this.addCommand({
			id: "check-ktr-streak",
			name: "Check writing goal from previous days",
			callback: () => {
				checkPreviousStreak();
			},
		});
	}

	private initializeEvents() {
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				events.handleEditorChange(editor, info, this);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile) events.handleFileDelete(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("create", (file: TAbstractFile) => {
				if (file instanceof TFile) events.handleFileCreate(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on(
				"rename",
				(file: TAbstractFile, oldPath: string) => {
					if (file instanceof TFile)
						events.handleFileRename(file, oldPath);
				},
			),
		);
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file) events.handleFileOpen(file);
			}),
		);
	}

	private initializeCodeBlocks() {
		this.registerMarkdownCodeBlockProcessor(
			"ktr-heatmap",
			codeBlocks.createHeatmapCodeBlock,
		);

		this.registerMarkdownCodeBlockProcessor(
			"ktr-slots",
			codeBlocks.createSlotsCodeBlock,
		);

		this.registerMarkdownCodeBlockProcessor(
			"ktr-entries",
			codeBlocks.createEntriesCodeBlock,
		);
	}

	// #region Unloading

	async onunload() {
		if (this.onFocusHandler !== null) {
			window.removeEventListener("focus", this.onFocusHandler);
		}

		// Stop reacting to persist signals and invalidate pending saves.
		this.persistenceScheduler?.dispose();
		this.persistenceScheduler = null;

		// Flush any pending editor-change sample so the final deltas land
		// in the in-memory store before we snapshot it for the JSON save.
		await events.cleanDBTimeout();

		// Persist and back up.  No DB to clear — the in-memory store is
		// garbage-collected with the plugin.
		await flushToJSON(this);
		await backupData(this.data, this.app);
	}

	// #endregion

	async onExternalSettingsChange() {
		await handleExternalSettingsChange(this);
	}

	/**
	 * Called by the settings UI (SettingsTab / CustomSettings) every time
	 * a setting value changes. Hydrates the Zustand store from plugin.data
	 * (so useStore selectors re-render with the new settings) and schedules
	 * a debounced JSON save.  plugin.data.settings has already been mutated
	 * by the caller before this method is called.
	 *
	 * Streak updates go through the store's updateStreak action (called
	 * from events.ts checkStreak), not a separate plugin method.
	 */
	public updateAndSaveEverything() {
		useStore.getState().hydrateFromPluginData();
		useStore.getState().requestPersist();
	}
}
