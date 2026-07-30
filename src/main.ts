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
import { EVENTS, state } from "@/core/pluginState";
import { PluginView, VIEW_TYPE } from "@/ui/views/PluginView";
import { SettingsTab } from "@/ui/settings/SettingsTab";

import * as utils from "@/utils/utils";
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

	async onload() {
		state.setPlugin(this);
		this.onFocusHandler = () => state.checkDayChange();
		window.addEventListener("focus", this.onFocusHandler);

		await initDatabase();

		const loadedData = await this.loadData();

		await backupData(loadedData, this.app);

		await this.initializeDataFromJSON(loadedData);

		await this.saveData(this.data);

		// #endregion

		state.setToday();

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

		// The JSON save pipeline listens exclusively to DATA_PERSIST_NEEDED,
		// which is emitted by the data layer *after* an IndexedDB write has
		// actually resolved. Any other event is pure UI refresh and must
		// not schedule a save — this prevents racing saves when only the
		// in-memory activity object was mutated (before flushChangesToDB).
		const scheduleSave = async () => {
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
		state.on(EVENTS.DATA_PERSIST_NEEDED, scheduleSave);
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
				new ManualEntryModal(state.plugin.app).open();
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

		// Flush in-memory changes to the DB. Must be awaited so any pending
		// TODAY/HISTORY data events + their DATA_PERSIST_NEEDED debounced
		// save timers settle before we invalidate them below.
		await events.cleanDBTimeout();

		if (this.onFocusHandler !== null) {
			window.removeEventListener("focus", this.onFocusHandler);
		}

		// Invalidate any pending debounced saveDataToJSON callbacks that
		// may have been queued before or during cleanDBTimeout. The timer
		// is cancelled so it won't fire; if it already fired and the
		// callback is pending, the generation check inside the callback
		// (see DATA_PERSIST_NEEDED handler) will make it a no-op.
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
			// or both. Fire the appropriately-scoped events:
			//  - SETTINGS_CHANGED so SidebarView re-reads config
			//  - HISTORY_DATA_CHANGED so Entries/Heatmap re-read history
			//    (the imported dailyActivity could cover any date)
			//  - DATA_PERSIST_NEEDED only if we actually wrote to IndexedDB
			state.emit(EVENTS.SETTINGS_CHANGED);
			state.emit(EVENTS.HISTORY_DATA_CHANGED);
			if (dbMutated) {
				state.emit(EVENTS.DATA_PERSIST_NEEDED);
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

	public async updateCurrentStreak(increase: boolean) {
		if (!this.data.stats) return;

		// TODO: check previous date to see when was the last one

		if (!this.data.stats.daysWithCompletedGoal) {
			this.data.stats.daysWithCompletedGoal = [];
		}

		const { longestStreak, currentStreak } = utils.getDateStreaks(
			this.data.stats.daysWithCompletedGoal,
		);

		let changed = false;
		if (increase) {
			if (this.data.stats.daysWithCompletedGoal.includes(state.today)) {
				return;
			}
			this.data.stats.daysWithCompletedGoal.push(state.today);
			changed = true;
		} else {
			if (this.data.stats.daysWithCompletedGoal.includes(state.today)) {
				const newArray = this.data.stats.daysWithCompletedGoal?.filter(
					(item) => item !== state.today,
				);
				this.data.stats.daysWithCompletedGoal = newArray;
				changed = true;
			}
		}
		// daysWithCompletedGoal lives in this.data.stats (NOT in IndexedDB),
		// so quietSave persists it directly to data.json.  UI listeners that
		// render streak / total-days data must re-read on HISTORY_DATA_CHANGED.
		// No DATA_PERSIST_NEEDED required — that event is only for DB→JSON
		// snapshots produced by saveDataToJSON.
		if (changed) {
			this.quietSave();
			state.emit(EVENTS.HISTORY_DATA_CHANGED);
		}
	}

	/**
	 * Called by the settings UI (SettingsTab / CustomSettings) every time
	 * a setting value changes. Persists plugin.data (which contains the
	 * settings object) via saveData, then broadcasts:
	 *   • SETTINGS_CHANGED — so SidebarView, Slot etc. re-read the new
	 *     config (visibility toggles, goal, colors, tracked folders…).
	 *   • checkDayChange() — syncs state.today to wall-clock and possibly
	 *     emits DAY_CHANGED (Obsidian might have been open across midnight
	 *     while the user was tweaking settings). Previously this relied on
	 *     state.setToday() unconditionally which would *always* broadcast
	 *     a day rollover even when nothing changed — the idempotent
	 *     checkDayChange avoids that spurious broadcast.
	 */
	public async updateAndSaveEverything() {
		await this.saveData(this.data);
		state.emit(EVENTS.SETTINGS_CHANGED);
		state.checkDayChange();
	}

	public async quietSave() {
		await this.saveData(this.data);
	}

	// #endregion
}
