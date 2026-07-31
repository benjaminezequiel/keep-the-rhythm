import { ManualEntryModal } from "./ui/components/ManualEntry";
import {
	Plugin,
	TFile,
	TAbstractFile,
	moment as _moment,
} from "obsidian";

import {
	ColorConfig,
	DEFAULT_SETTINGS,
	STARTING_STATS,
	PluginData,
} from "@/defs/types";

import { getDB, initDatabase } from "@/db/db";
import { getActivityByDateAndFile } from "@/db/queries";
import { setPlugin } from "@/core/pluginRegistry";
import { useStore } from "@/core/store";
import { PluginView, VIEW_TYPE } from "@/ui/views/PluginView";
import { SettingsTab } from "@/ui/settings/SettingsTab";

import * as events from "@/core/events";
import * as codeBlocks from "@/core/codeBlocks";
import { checkPreviousStreak, activateSidebarView } from "@/core/commands";
import { backupData } from "@/core/backup";

const moment = _moment as unknown as typeof _moment.default;

export default class KeepTheRhythm extends Plugin {
	data: PluginData = {
		schema: "1.0",
		settings: DEFAULT_SETTINGS,
		stats: {
			dailyActivity: [],
		},
	};

	private onFocusHandler: (() => void) | null = null;
	private JSON_DEBOUNCE_TIME = 1000;

	private JsonDebounceTimeout: any = null;
	private _saveGen = 0;
	private _isUnloading = false;
	// Unsubscribe handle for the Zustand persistVersion subscription
	// (replaces the old state.on(EVENTS.DATA_PERSIST_NEEDED, ...) listener).
	private unsubscribePersist: (() => void) | null = null;

	async onload() {
		setPlugin(this);
		this.onFocusHandler = () => useStore.getState().checkDayChange();
		window.addEventListener("focus", this.onFocusHandler);

		await initDatabase();

		const loadedData = await this.loadData();

		await backupData(loadedData, this.app);

		await this.initializeDataFromJSON(loadedData);

		await this.saveData(this.data);

		// Sync Zustand store with loaded plugin data before any React
		// component mounts.  After this point, store.settings /
		// store.daysWithCompletedGoal / store.today are all populated.
		useStore.getState().hydrateFromPluginData();

		// #endregion

		// /** Set of utility functions that registers required objects and sets plugin state */

		/** Initialize SIDEBAR view */
		this.registerView(VIEW_TYPE, (leaf) => {
			return new PluginView(leaf, this);
		});

		this.initializeCommands();
		this.initializeEvents();
		this.applyColorStyles();
		this.addSettingTab(new SettingsTab(this.app, this));

		/** Registers CUSTOM CODE BLOCKS */
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

		// The JSON save pipeline subscribes to the store's persistVersion
		// counter, which is incremented (via requestPersist, rAF-coalesced)
		// by the data layer *after* an IndexedDB write has actually
		// resolved. Pure UI refresh never touches persistVersion, so it
		// can't schedule a save — this prevents racing saves when only the
		// in-memory activity object was mutated (before flushChangesToDB).
		const scheduleSave = () => {
			if (this._isUnloading) return;

			if (this.JsonDebounceTimeout) {
				clearTimeout(this.JsonDebounceTimeout);
			}

			this._saveGen++;
			const gen = this._saveGen;
			this.JsonDebounceTimeout = setTimeout(async () => {
				if (gen !== this._saveGen) return; // stale — a newer save was scheduled or unload invalidated it
				this.JsonDebounceTimeout = null;
				await this.saveDataToJSON();
			}, this.JSON_DEBOUNCE_TIME);
		};
		this.unsubscribePersist = useStore.subscribe(
			(s) => s.persistVersion,
			() => scheduleSave(),
		);
	}

	private async initializeDataFromJSON(loadedData: PluginData) {
		if (!loadedData) {
			this.data.stats = {
				...STARTING_STATS,
			};
			return;
		}
		if (loadedData.settings) {
			this.data.settings = {
				...DEFAULT_SETTINGS,
				...loadedData.settings,
			};
		}
		if (loadedData.stats) {
			this.data.stats = loadedData.stats;
			await checkPreviousStreak();

			const dailyActivitiesFromJSON =
				this.data.stats?.dailyActivity || [];

			try {
				/** BulkPut updates the records if they already exist! */
				await getDB().dailyActivity.bulkPut(dailyActivitiesFromJSON);
			} catch (error) {
				console.error(
					"Failed loading some data, contact the developer.",
					error,
				);
			}
		}
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

	// #endregion

	// #region Unloading

	async onunload() {
		this._isUnloading = true;

		// Stop reacting to persist signals before flushing — once we begin
		// tearing down, any pending persistVersion increment must not
		// schedule a (now-meaningless) debounced save.
		if (this.unsubscribePersist) {
			this.unsubscribePersist();
			this.unsubscribePersist = null;
		}

		// Flush in-memory changes to the DB. Must be awaited so the
		// resulting persistVersion bump (and its debounced save timer)
		// settle before we invalidate them below.  Since we already
		// unsubscribed, the bump is a no-op for the save pipeline.
		await events.cleanDBTimeout();

		if (this.onFocusHandler !== null) {
			window.removeEventListener("focus", this.onFocusHandler);
		}

		// Invalidate any pending debounced saveDataToJSON callbacks that
		// may have been queued before or during cleanDBTimeout. The timer
		// is cancelled so it won't fire; if it already fired and the
		// callback is pending, the generation check inside the callback
		// (see persistVersion subscriber) will make it a no-op.
		this._saveGen++;
		if (this.JsonDebounceTimeout) {
			clearTimeout(this.JsonDebounceTimeout);
			this.JsonDebounceTimeout = null;
		}
		// Persist and back up BEFORE clearing the DB. These must be awaited and
		// ordered: an un-awaited clear() could otherwise empty the DB before
		// saveDataToJSON snapshots it, backing up (and saving) empty stats.
		await this.saveDataToJSON();
		await backupData(this.data, this.app);

		await getDB().dailyActivity.clear();
	}

	// #endregion

	async onExternalSettingsChange() {
		try {
			const newData = (await this.loadData()) as PluginData;

			if (JSON.stringify(newData) == JSON.stringify(this.data)) {
				return;
			}

			let dbMutated = false;
			// Note: this forEach runs async work in "fire and forget"; any
			// actual DB put() still resolves eventually and the events
			// below remain semantically correct ("something may have
			// changed — re-render and re-snapshot").
			newData.stats?.dailyActivity.forEach(async (activity, index) => {
				let existingActivity;

				existingActivity = await getActivityByDateAndFile(
					activity.date, activity.filePath);

				/** Find any new activity and add it to the db */
				if (
					existingActivity &&
					JSON.stringify(existingActivity) == JSON.stringify(activity)
				) {
					return;
				} else {
					getDB().dailyActivity.put(activity);
					dbMutated = true;
				}
			});

			/** Assign new external settings*/
			if (this.data.settings !== newData.settings) {
				this.data.settings = {
					...DEFAULT_SETTINGS,
					...newData.settings,
				};
			}

			// External settings file could have changed settings, DB rows,
			// or both. Re-sync the store from plugin.data so useStore
			// selectors (settings + daysWithCompletedGoal) re-render, and
			// let useLiveQuery pick up any DB rows we just put().  Only
			// request a JSON persist if we actually wrote to IndexedDB.
			useStore.getState().hydrateFromPluginData();
			if (dbMutated) {
				useStore.getState().requestPersist();
			}
		} catch (error) {
			console.error("Error in onExternalSettingsChange:", error);
		}
	}

	// #region SAVING DATA

	private async saveDataToJSON() {
		const dailyActivityDB = await getDB().dailyActivity.toArray();

		// Safety guard: if the DB is empty but we have entries in memory, the DB
		// was likely cleared by a race (e.g., a stale timer callback or an
		// un-awaited clear()).  Don't overwrite data.json with empty data.
		if (
			dailyActivityDB.length === 0 &&
			(this.data.stats?.dailyActivity?.length ?? 0) > 0
		) {
			return;
		}

		this.data.stats = {
			...this.data.stats,
			dailyActivity: dailyActivityDB,
		};

		await this.saveData(this.data);
	}

	/**
	 * Called by the settings UI (SettingsTab / CustomSettings) every time
	 * a setting value changes. Persists plugin.data, then:
	 *   • hydrates the Zustand store from plugin.data (so useStore
	 *     selectors in SidebarView/SlotWrapper/Slot re-render with the
	 *     new settings — replaces the old SETTINGS_CHANGED event)
	 *   • checkDayChange() in case Obsidian was open across midnight
	 *
	 * Streak updates go through the store's updateStreak action (called
	 * from events.ts checkStreak), not a separate plugin method.
	 */
	public async updateAndSaveEverything() {
		await this.saveData(this.data);
		useStore.getState().hydrateFromPluginData();
		useStore.getState().checkDayChange();
	}

	public async quietSave() {
		await this.saveData(this.data);
	}

	// #endregion
}
