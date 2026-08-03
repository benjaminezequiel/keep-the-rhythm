import { ManualEntryModal } from "./ui/components/ManualEntry";
import { Plugin, TFile, TAbstractFile, moment as _moment } from "obsidian";

import { ColorConfig } from "@/defs/types";

import { setPlugin } from "@/core/pluginRegistry";
import { useStore } from "@/core/store";
import { PluginView, VIEW_TYPE } from "@/ui/views/PluginView";
import { SettingsTab } from "@/ui/settings/SettingsTab";

import * as events from "@/core/events";
import * as codeBlocks from "@/core/codeBlocks";
import { checkPreviousStreak, activateSidebarView } from "@/core/commands";
import { backupData } from "@/core/backup";
import {
	buildSnapshotFromStore,
	setupPersistenceScheduling,
	PersistenceScheduler,
} from "@/core/dataPersistence";
import { handleExternalSettingsChange } from "@/core/externalSync";
import { resetDailySummaryCache } from "@/utils/dailySummaryCache";

export default class KeepTheRhythm extends Plugin {
	private onFocusHandler: (() => void) | null = null;
	private onVisibilityHandler: (() => void) | null = null;

	// Persistence scheduler with debounce state and unsubscribe handle
	private persistenceScheduler: PersistenceScheduler | null = null;

	async onload() {
		setPlugin(this);
		this.onFocusHandler = () => useStore.getState().checkDayChange();
		window.addEventListener("focus", this.onFocusHandler);

		// No DB to initialise — the in-memory store is empty until
		// we hydrate it from data.json below.
		const loadedData = await this.loadData();

		await backupData(loadedData, this.app);

		// Sync Zustand store with loaded data before any React
		// component mounts.  After this point, store.settings /
		// store.daysWithCompletedGoal / store.today are all populated.
		useStore.getState().hydrateFromData(loadedData);
		
		checkPreviousStreak();

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

		// requestAnimationFrame is paused in background tabs, so the
		// normal rAF-coalesced requestPersist() never fires while the
		// user is in another app.  If the OS then hard-kills the
		// renderer (or the user hard-reloads) the in-memory edits are
		// lost.  Flush proactively whenever the tab goes hidden or the
		// page is about to be discarded.
		this.onVisibilityHandler = () => {
			if (document.hidden) void this.flushNow();
		};
		document.addEventListener("visibilitychange", this.onVisibilityHandler);
		window.addEventListener("pagehide", () => void this.flushNow());
	}

	/**
	 * Drain any pending editor-change sample into the in-memory store
	 * and immediately persist the store to data.json.  Used by the
	 * visibilitychange / pagehide handlers (because requestAnimationFrame
	 * is paused in background tabs) and during plugin unload so a
	 * coalesced debounced save still lands on disk before the scheduler
	 * is disposed.
	 */
	private async flushNow() {
		await events.flushPendingEditorChange();
		await this.persistenceScheduler?.flushNow();
	}

	public applyColorStyles() {
		const { settings } = useStore.getState();
		const containerStyle = this.app.workspace.containerEl.style;
		let light = undefined;
		let dark = undefined;

		if (settings?.heatmapConfig?.colors) {
			light = settings.heatmapConfig.colors?.light;
			dark = settings.heatmapConfig.colors?.dark;
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
				events.handleEditorChange(editor, info);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile) events.handleFileDelete(file);
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
		if (this.onVisibilityHandler !== null) {
			document.removeEventListener("visibilitychange", this.onVisibilityHandler);
		}

		// Drain pending editor deltas and persist to data.json before
		// tearing down the scheduler, so a coalesced debounced save
		// still lands on disk.
		await this.flushNow();

		// Stop reacting to persist signals.
		this.persistenceScheduler?.dispose();
		this.persistenceScheduler = null;

		// Back up.  No DB to clear — the in-memory store is
		// garbage-collected with the plugin.
		await backupData(buildSnapshotFromStore(), this.app);

		// Reset the module-level partitioned cache so stale data doesn't
		// leak into the next plugin load cycle.
		resetDailySummaryCache();
	}

	// #endregion

	async onExternalSettingsChange() {
		await handleExternalSettingsChange(this);
	}

	/**
	 * Lightweight persist for visual/settings-only changes.
	 * Re-snapshots the store's current settings (breaking the shared
	 * reference so selectors detect the change) and schedules a
	 * debounced JSON save.
	 */
	public updateVisualSettingsOnly() {
		const cur = useStore.getState();
		useStore.setState({ settings: { ...cur.settings } });
		cur.requestPersist();
	}
}
