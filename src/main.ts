import { formatDate } from "./utils/dateUtils";
import { moment as _moment } from "obsidian";
const moment = _moment as unknown as typeof _moment.default;
import {
	Plugin,
	TFile,
	TAbstractFile,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Notice,
} from "obsidian";
import React from "react";
import { createRoot } from "react-dom/client";

import {
	ColorConfig,
	DEFAULT_SETTINGS,
	STARTING_STATS,
	PluginData,
} from "@/defs/types";

import { getDB, initDatabase } from "@/db/db";
import { EVENTS, state } from "@/core/pluginState";
import { PluginView, VIEW_TYPE } from "@/ui/views/PluginView";

import { SettingsTab } from "@/ui/views/SettingsTab";
import { SlotWrapper } from "./ui/components/SlotWrapper";
import { Heatmap } from "@/ui/components/Heatmap";
import { Entries } from "./ui/components/Entries";

import { migrateDataFromOldFormat } from "./utils/migrateData";
import { parseQueryToJSEP, parseSlotQuery } from "./core/codeBlockQuery";
import * as utils from "@/utils/utils";
import * as events from "@/core/events";

export default class KeepTheRhythm extends Plugin {
	data: PluginData = {
		schema: "0.2",
		settings: DEFAULT_SETTINGS,
		stats: {
			dailyActivity: [],
		},
	};
	codeBlockRoots: Map<
		HTMLElement,
		{ root: any; ctx: MarkdownPostProcessorContext; source: string }
	> = new Map();
	private JSON_DEBOUNCE_TIME = 1000;
	private JsonDebounceTimeout: any = null;

	// #region Initialization
	async onload() {
		// #region JSON

		state.setPlugin(this);

		initDatabase();
		getDB().dailyActivity.clear(); // restarts DB to ensure data.json is the source of truth
		const loadedData = await this.loadData();

		let lastBreakingChangeToSchema = "0.2";

		if (loadedData) {
			await this.backupDataToVaultFolder(loadedData);
		}

		/** Data is only loaded into dexie if it's the correct schema */
		if (loadedData && loadedData.schema == lastBreakingChangeToSchema) {
			await this.initializeDataFromJSON(loadedData);
		} else if (
			loadedData &&
			loadedData.schema !== lastBreakingChangeToSchema
		) {
			new Notice("KTR: Migrating data from previous versions...");
			await this.migrateDataFromJSON(loadedData);
		} else if (!loadedData) {
			this.data.schema = lastBreakingChangeToSchema;
			this.data.stats = {
				...STARTING_STATS,
			};
		} else {
			this.data.stats = loadedData.stats;
			this.data.settings = loadedData.settings;
		}

		await this.saveData(this.data);

		// #endregion

		state.setToday();

		this.checkVaultCountStaleness();

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
			this.createHeatmapCodeBlock(),
		);

		this.registerMarkdownCodeBlockProcessor(
			"ktr-slots",
			this.createSlotsCodeBlock(),
		);

		this.registerMarkdownCodeBlockProcessor(
			"ktr-entries",
			this.createEntriesCodeBlock(),
		);

		state.on(EVENTS.REFRESH_EVERYTHING, async () => {
			if (this.JsonDebounceTimeout) {
				clearTimeout(this.JsonDebounceTimeout);
			}

			this.JsonDebounceTimeout = setTimeout(async () => {
				await this.saveDataToJSON();
			}, this.JSON_DEBOUNCE_TIME);
		});
	}

	private async checkVaultCountStaleness() {
		if (
			this.data.stats?.wholeVaultWordCount !== undefined &&
			this.data.stats?.wholeVaultCharCount !== undefined
		) {
			const recentActivity = await getDB()
				.dailyActivity.orderBy("date")
				.reverse()
				.first();

			if (recentActivity) {
				const daysSinceLastActivity = moment().diff(
					moment(recentActivity.date),
					"days",
				);
				if (daysSinceLastActivity > 7) {
					this.data.stats.wholeVaultWordCount = undefined;
					this.data.stats.wholeVaultCharCount = undefined;
					await this.saveData(this.data);
				}
			}
		}
	}

	private async backupDataToVaultFolder(data: any) {
		const folderPath = ".keep-the-rhythm";
		const typoOlderPath = ".keep-the-rhyhtm"; // there's a typo here and unfortuntely it will haunt me forever
		const fileName = `backup-${formatDate(new Date())}-${data.schema}.json`;
		const backupPath = `${folderPath}/${fileName}`;
		const jsonData = JSON.stringify(data, null, 2);

		const oldFolderExists =
			await this.app.vault.adapter.exists(typoOlderPath);

		if (oldFolderExists) {
			const correctFolderExists =
				await this.app.vault.adapter.exists(folderPath);
			if (!correctFolderExists) {
				await this.app.vault.adapter.mkdir(folderPath);
			}

			const oldFolderFiles =
				await this.app.vault.adapter.list(typoOlderPath);
			for (const filePath of oldFolderFiles.files) {
				const fileName = filePath.split("/").pop();
				if (!fileName) continue;

				const newPath = `${folderPath}/${fileName}`;
				await this.app.vault.adapter.rename(filePath, newPath);
				console.log(`Moved backup file to correct folder: ${fileName}`);
			}

			const remaining = await this.app.vault.adapter.list(typoOlderPath);
			if (
				remaining.files.length === 0 &&
				remaining.folders.length === 0
			) {
				await this.app.vault.adapter.rmdir(typoOlderPath, true);
				console.log("Removed old backup folder: .keep-the-rhyhtm");
			}
		}
		const folderExists = await this.app.vault.adapter.exists(folderPath);

		if (!folderExists) {
			await this.app.vault.adapter.mkdir(folderPath);
		}

		const filesOnBackupsFolder =
			await this.app.vault.adapter.list(folderPath);
		const backupFiles = filesOnBackupsFolder.files.filter((f) =>
			f.endsWith(".json"),
		);

		// only cleans backups if we have more than 3, which should avoid losing stuff even if its older
		if (backupFiles.length > 3) {
			await this.cleanOlderBackups(backupFiles);
		}

		// This if runs if the user has data from previous schemas, checking
		// every backup to see if the data was already backed up and saving it otherwise.
		if (data.schema !== "0.3") {
			// Compare against all existing backups
			for (const filePath of backupFiles) {
				const contents = await this.app.vault.adapter.read(filePath);
				if (contents && contents === jsonData) {
					new Notice("KTR: No changes to backup.");
					return;
				}
			}
			// No identical backup found, save new one
			await this.app.vault.adapter.write(backupPath, jsonData);
			new Notice("KTR: New backup saved.");
		} else {
			await this.app.vault.adapter.write(backupPath, jsonData);
			new Notice("KTR: First backup created.");
		}
	}

	private async cleanOlderBackups(backupPaths: string[]) {
		const now = window.moment();

		for (const fullPath of backupPaths) {
			// Check if file still exists before doing anything
			const fileExists = await this.app.vault.adapter.exists(fullPath);
			if (!fileExists) {
				console.warn(`File already missing: ${fullPath}`);
				continue;
			}

			const fileName = fullPath.split("/").pop();
			if (!fileName) continue;

			// Match: backup-YYYY-MM-DD(-optionalSchema).json
			const match = fileName.match(
				/^backup-(\d{4}-\d{2}-\d{2})(?:-[\w\d.]+)?\.json$/,
			);
			if (!match) continue;

			const dateStr = match[1];
			const fileDate = window.moment(dateStr, "YYYY-MM-DD", true);

			if (!fileDate.isValid()) {
				console.warn(`Skipping file with invalid date: ${fileName}`);
				continue;
			}

			const ageInDays = now.diff(fileDate, "days");

			if (ageInDays > 14) {
				await this.app.vault.adapter.remove(fullPath);
				console.log(`Deleted old backup: ${fileName}`);
			}
		}
	}

	private async migrateDataFromJSON(loadedData: any) {
		const previousStats = migrateDataFromOldFormat(loadedData);
		this.data.stats = previousStats.stats;
		this.data.schema = "0.2";

		if (this.data.stats) {
			await getDB().dailyActivity.bulkAdd(this.data.stats.dailyActivity);
		}
	}

	private async initializeDataFromJSON(loadedData: PluginData) {
		if (loadedData.settings) {
			this.data.settings = {
				...DEFAULT_SETTINGS,
				...loadedData.settings,
			};
		}
		if (loadedData.stats) {
			this.data.stats = loadedData.stats;
			await this.checkPreviousStreak();

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

	private applyColorStyles() {
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

	private createEntriesCodeBlock(): (
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	) => void {
		return (
			source: string,
			el: HTMLElement,
			ctx: MarkdownPostProcessorContext,
		) => {
			if (!this.data || !this.data.settings) {
				return;
			}

			const container = el.createDiv("slots-codeblock");
			const root = createRoot(container);
			this.codeBlockRoots.set(el, { root, ctx, source });

			let date;
			if (source.trim() !== "") {
				date = source.trim();
			}
			root.render(
				React.createElement(Entries, {
					date: date,
				}),
			);

			// ctx.addChild(
			// 	new (class extends MarkdownRenderChild {
			// 		constructor(containerEl: HTMLElement) {
			// 			super(containerEl);
			// 		}
			// 		onunload() {
			// 			root.unmount();
			// 		}
			// 	})(container),
			// );
			return;
		};
	}

	private createSlotsCodeBlock(): (
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	) => void {
		return (
			source: string,
			el: HTMLElement,
			ctx: MarkdownPostProcessorContext,
		) => {
			if (!this.data || !this.data.settings) {
				return;
			}

			const config = parseSlotQuery(source);
			if (config.length === 0) return;

			const container = el.createDiv("slots-codeblock");
			const root = createRoot(container);
			this.codeBlockRoots.set(el, { root, ctx, source });

			root.render(
				React.createElement(SlotWrapper, {
					slots: config,
					isCodeBlock: true,
				}),
			);

			// ctx.addChild(
			// 	new (class extends MarkdownRenderChild {
			// 		constructor(containerEl: HTMLElement) {
			// 			super(containerEl);
			// 		}
			// 		onunload() {
			// 			root.unmount();
			// 		}
			// 	})(container),
			// );
			return;
		};
	}

	private createHeatmapCodeBlock(): (
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	) => void {
		return (
			source: string,
			el: HTMLElement,
			ctx: MarkdownPostProcessorContext,
		) => {
			if (!this.data || !this.data.settings) {
				return;
			}

			// if (source.trim() !== "") return

			const query = parseQueryToJSEP(source.trim());
			if (!query?.options) return;

			const container = el.createDiv("heatmap-codeblock");
			const root = createRoot(container);
			this.codeBlockRoots.set(el, { root, ctx, source });

			root.render(
				React.createElement(Heatmap, {
					heatmapConfig: query?.options,
					query: query?.filter,
					isCodeBlock: true,
					amountOfWeeks: query?.options.numberOfWeeks,
				}),
			);

			ctx.addChild(
				new (class extends MarkdownRenderChild {
					constructor(containerEl: HTMLElement) {
						super(containerEl);
					}
					onunload() {
						root.unmount();
					}
				})(container),
			);
			return;
		};
	}

	private initializeCommands() {
		this.addRibbonIcon("calendar-days", "Word Count Stats", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-keep-the-rhythm",
			name: "Open sidebar view",
			callback: () => {
				this.activateView();
			},
		});

		this.addCommand({
			id: "check-ktr-streak",
			name: "Check writing goal from previous days",
			callback: () => {
				this.checkPreviousStreak();
			},
		});
	}

	private async checkPreviousStreak() {
		if (!this.data.settings) return;

		const activities = await getDB().dailyActivity.toArray();

		for (let i = 0; i < activities.length; i++) {
			const { totalWords } = utils.sumBothTimeEntries(activities[i]);
			if (
				totalWords > this.data.settings.dailyWritingGoal &&
				!this.data.stats?.daysWithCompletedGoal?.includes(
					activities[i].date,
				)
			) {
				this.data.stats?.daysWithCompletedGoal?.push(
					activities[i].date,
				);
			}
		}
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
		events.cleanDBTimeout();

		if (this.JsonDebounceTimeout) {
			clearTimeout(this.JsonDebounceTimeout);
		}
		this.saveDataToJSON();
		this.backupDataToVaultFolder(this.data);

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

				if (activity.id) {
					existingActivity = await getDB().dailyActivity.get(
						activity.id,
					);
				}

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
		state.emit(EVENTS.REFRESH_EVERYTHING);
	}

	public async quietSave() {
		await this.saveData(this.data);
	}

	// #endregion

	/**
	 * @function activateView opens the SIDEBAR plugin view
	 */
	async activateView() {
		// Return if view already exists
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) return;

		// Get the leaf and focus on it
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE,
				active: true,
			});
		}
	}
}
