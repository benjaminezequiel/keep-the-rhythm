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

		// Both REFRESH_EVERYTHING (cross-day / history / settings) and
		// REFRESH_TODAY (only today's data changed) must schedule a JSON
		// save — the debounce coalesces them regardless.
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
		state.on(EVENTS.REFRESH_EVERYTHING, scheduleSave);
		state.on(EVENTS.REFRESH_TODAY, scheduleSave);
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

		// Flush in-memory changes to the DB. Must be awaited so all
		// REFRESH_EVERYTHING emissions (and their debounced save timers)
		// settle before we invalidate them below.
		await events.cleanDBTimeout();

		if (this.onFocusHandler !== null) {
			window.removeEventListener("focus", this.onFocusHandler);
		}

		// Invalidate any pending debounced saveDataToJSON callbacks that
		// may have been queued before or during cleanDBTimeout. The timer
		// is cancelled so it won't fire; if it already fired and the
		// callback is pending, the generation check inside the callback
		// (see REFRESH_EVERYTHING handler) will make it a no-op.
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
				}
			});

			/** Assign new external settings*/
			if (this.data.settings !== newData.settings) {
				this.data.settings = {
					...DEFAULT_SETTINGS,
					...newData.settings,
				};
			}

			state.emit(EVENTS.REFRESH_EVERYTHING);
			//TODO: ADD "SAVE AND UPDATE" HERE + EMIT UPDATE TO PLUGIN STATE
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

		if (increase) {
			if (this.data.stats.daysWithCompletedGoal.includes(state.today)) {
				return;
			}
			this.data.stats.daysWithCompletedGoal.push(state.today);
		} else {
			if (this.data.stats.daysWithCompletedGoal.includes(state.today)) {
				const newArray = this.data.stats.daysWithCompletedGoal?.filter(
					(item) => item !== state.today,
				);
				this.data.stats.daysWithCompletedGoal = newArray;
			}
		}
		this.quietSave();
	}

	public async updateAndSaveEverything() {
		await this.saveData(this.data);
		state.setToday(); // already refreshes everything
	}

	public async quietSave() {
		await this.saveData(this.data);
	}

	// #endregion
}
