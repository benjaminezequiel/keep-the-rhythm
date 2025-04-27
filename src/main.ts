import {
	historicDataCache,
	HistoricDataCache,
} from "./store/historicDataCache";
import { mockMonthDailyActivity } from "@/utils";
import { v4 as uuidv4 } from "uuid";
import { formatDate, setApp } from "@/utils";
import { PluginView, VIEW_TYPE } from "@/views/PluginView";
import { Plugin, TFile, TAbstractFile, MarkdownView } from "obsidian";
import { ColorConfig, DEFAULT_SETTINGS, PluginData } from "src/types";
import {
	handleFileCreate,
	handleFileDelete,
	handleEditorChange,
	handleFileModify,
	handleFileRename,
	handleFileOpen,
	handleEditorPaste,
	eventEmitter,
	EVENTS,
} from "@/events";
import { initializeFileStats } from "@/initializeFileStats";
import { db, removeDuplicatedDailyEntries } from "@/db/db";
import { log } from "@/utils";
import { FloatingUIManager } from "./components/floatingComponent";

export default class KeepTheRhythm extends Plugin {
	regex: RegExp;
	data: PluginData;
	deviceId: string;
	view: PluginView | null;
	private floatingUI: FloatingUIManager;

	async onload() {
		this.register(() => {
			this.floatingUI.cleanup();
		});
		console.log("PLUGIN LOADED");
		setApp(this.app);
		const loadedData = await this.loadData();
		if (!loadedData) {
			this.data = { settings: DEFAULT_SETTINGS };
			await this.saveData(this.data);
		} else {
			this.data = loadedData;
		}

		await initializeFileStats(
			this.app.vault,
			this.data.settings.enabledLanguages,
		);

		// await migrateFromJSON(previousData);

		this.setDeviceId();
		this.saveStatsDataToJSON();
		historicDataCache.resetCache();
		this.initializeViews();
		this.initializeCommands();
		this.initializeEvents();
		this.applyColorStyles();

		// setInterval(() => {
		// 	eventEmitter.emit(EVENTS.REFRESH_EVERYTHING);
		// }, 5000);
		this.floatingUI = new FloatingUIManager(this.app);
		const ribbonIconEl = this.addRibbonIcon(
			"layout-dashboard",
			"Toggle Floating UI",
			() => {
				this.floatingUI.toggle();
			},
		);

		this.addCommand({
			id: "toggle-floating-ui",
			name: "Toggle Floating UI",
			callback: () => {
				this.floatingUI.toggle();
			},
		});
	}

	private setDeviceId() {
		let id = localStorage.getItem("ktr-device-id");
		if (!id) {
			// id = randomUUID() as string;
			id = uuidv4();
			localStorage.setItem("ktr-device-id", id);
		}
		this.deviceId = id;
	}

	async activateView() {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) {
			return; // view is already opened
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE,
				active: true,
			});
		}
	}

	private initializeViews() {
		this.registerView(VIEW_TYPE, (leaf) => {
			this.view = new PluginView(leaf, this);
			return this.view;
		});
	}

	private initializeCommands() {
		this.addRibbonIcon("calendar-days", "Word Count Stats", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-keep-the-rhythm",
			name: "Open tracking heatmap",
			callback: () => {
				this.activateView();
			},
		});

		this.addCommand({
			id: "open-keep-the-rhythm",
			name: "Remove duplicated entries",
			callback: () => {
				removeDuplicatedDailyEntries();
			},
		});

		this.addCommand({
			id: "mock-data",
			name: "Mock data for last month",
			callback: () => {
				mockMonthDailyActivity();
			},
		});

		this.addCommand({
			id: "delete-db",
			name: "Delete database",
			callback: () => {
				db.dailyActivity.clear();
				db.fileStats.clear();
				// emit refresh
			},
		});

		this.addCommand({
			id: "reset-keep-the-rhythm",
			name: "Reset Settings",
			callback: () => {
				this.data.settings = DEFAULT_SETTINGS;
				this.saveData(this.data);
				console.log(this.data.settings.sidebarConfig.slots);
				log("settings reseted");
			},
		});
	}
	private initializeEvents() {
		this.registerEvent(
			this.app.vault.on("modify", (file: TAbstractFile) => {
				if (file instanceof TFile) handleFileModify(file, this);
			}),
		);
		// this.registerEvent(
		// 	this.app.workspace.on("editor-change", (file: TAbstractFile) => {
		// 		if (file instanceof TFile) handleEditorChange(file, this);
		// 	}),
		// );
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				handleEditorChange(editor, info, this);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-paste", (clip, editor, info) => {
				handleEditorPaste(clip, editor, info, this);
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile) handleFileDelete(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("create", (file: TAbstractFile) => {
				if (file instanceof TFile) handleFileCreate(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile) => {
				if (file instanceof TFile) handleFileRename(file);
			}),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (
					leaf?.view instanceof MarkdownView &&
					leaf?.view.file instanceof TFile
				) {
					handleFileOpen(leaf.view.file, this);
				} else {
					return;
				}
			}),
		);
	}

	private async saveStatsDataToJSON() {
		const t0 = performance.now();
		const fileStats = await db.fileStats.toArray();
		const dailyActivity = await db.dailyActivity.toArray();

		this.data.stats = {
			fileStats: fileStats,
			dailyActivity: dailyActivity,
		};

		await this.saveData(this.data);
		const t1 = performance.now();
		// console.info(
		// 	`%cKEEP THE RHYTHM%c Data saved in JSON in ${Math.round(t1 - t0)} milliseconds.`,
		// 	"font-weight: bold; color: purple;",
		// 	"font-weight: normal",
		// );
	}

	private applyColorStyles() {
		const containerStyle = this.app.workspace.containerEl.style;
		let light = undefined;
		let dark = undefined;

		if (this.data.settings.colors) {
			light = this.data.settings.colors?.light;
			dark = this.data.settings.colors?.dark;
		}

		if (light && dark) {
			for (let i = 0; i <= 4; i++) {
				const key = i as keyof ColorConfig;
				containerStyle.setProperty(`--light-${i}`, light[key]);
				containerStyle.setProperty(`--dark-${i}`, dark[key]);
			}
		}
	}
}

// import { db } from "@/db";
// import { v4 as uuidv4 } from "uuid";
// import {
// 	createRegex,
// 	getWordCount,
// 	getExternalWordCount,
// } from "@/wordCounting";
// import { WordCountView, VIEW_TYPE } from "./src/views/WordCountView";
// import { createRoot } from "react-dom/client";
// import React from "react";
// import { Heatmap } from "@/components/Heatmap";
// import { handleFileOpen } from "@/events/fileOpen";
// import { SettingsTab } from "./src/views/SettingsTab";
// import {
// 	getCurrentDate,
// 	parsePathFilters,
// 	parseToggles,
// 	formatDate,
// 	getFileNameWithoutExtension,
// } from "@/utils";
// import { db } from "@/db";
// import { Vault } from "obsidian";

// export default class WordCountPlugin extends Plugin {
// 	private readonly LOCAL_BACKUP_PREFIX = "ktr-backup";
// 	private readonly MAX_BACKUPS = 5;
// 	private codeBlockProcessor: MarkdownPostProcessor;
// 	private codeBlockRoots: Map<
// 		HTMLElement,
// 		{ root: any; ctx: MarkdownPostProcessorContext; source: string }
// 	> = new Map();
// 	pluginData: PluginData;
// 	mergedStats: Stats;

//

//

// 	private debouncedHandleModify = debounce(
// 		async (file: TFile) => {
// 			await handleFileModify(this, file);
// 		},
// 		300,
// 		true,
// 	);

// 	private filterStatsByPath(stats: Stats, pathFilter: string | null): Stats {
// 		if (!pathFilter) {
// 			return stats;
// 		}

// 		const filteredStats: Stats = {};

// 		for (const [date, dateData] of Object.entries(stats)) {
// 			const filteredFiles: Record<string, FileWordCount> = {};

// 			for (const [filePath, fileData] of Object.entries(dateData.files)) {
// 				if (filePath.includes(pathFilter)) {
// 					filteredFiles[filePath] = fileData;
// 				}
// 			}

// 			if (Object.keys(filteredFiles).length > 0) {
// 				filteredStats[date] = {
// 					totalDelta: dateData.totalDelta,
// 					files: filteredFiles,
// 				};
// 			}
// 		}

// 		return filteredStats;
// 	}

// 	private createCodeBlockProcessor(): (
// 		source: string,
// 		el: HTMLElement,
// 		ctx: MarkdownPostProcessorContext,
// 	) => void {
// 		return (
// 			source: string,
// 			el: HTMLElement,
// 			ctx: MarkdownPostProcessorContext,
// 		) => {
// 			if (!this.pluginData || !this.pluginData.settings) {
// 				el.createDiv({
// 					text: "Plugin data not loaded. Please try again.",
// 				});
// 				return;
// 			}

// 			const query = source.trim();
// 			const pathConditions = parsePathFilters(query);
// 			const toggles = parseToggles(query);

// 			if (pathConditions.length === 0) {
// 				const container = el.createDiv("heatmap-codeblock");
// 				const root = createRoot(container);
// 				this.codeBlockRoots.set(el, { root, ctx, source });

// 				root.render(
// 					React.createElement(Heatmap, {
// 						data: this.mergedStats,
// 						intensityLevels:
// 							this.pluginData.settings.intensityLevels,
// 						...toggles,
// 						plugin: this,
// 					}),
// 				);

// 				ctx.addChild(
// 					new (class extends MarkdownRenderChild {
// 						constructor(containerEl: HTMLElement) {
// 							super(containerEl);
// 						}
// 						onunload() {
// 							root.unmount();
// 						}
// 					})(container),
// 				);
// 				return;
// 			}

// 			const filteredStats: Stats = {};

// 			Object.entries(this.mergedStats).forEach(([date, dateData]) => {
// 				const matchingFiles = Object.entries(dateData.files).filter(
// 					([filePath]) => {
// 						let includeFile = [];
// 						for (const condition of pathConditions) {
// 							const pathIncluded = filePath.includes(
// 								condition.path,
// 							);
// 							if (pathIncluded && condition.isInclusion) {
// 								includeFile.push(true);
// 							} else if (
// 								!pathIncluded &&
// 								!condition.isInclusion
// 							) {
// 								includeFile.push(true);
// 							} else if (pathIncluded && !condition.isInclusion) {
// 								includeFile.push(false);
// 							} else if (!pathIncluded && condition.isInclusion) {
// 								includeFile.push(false);
// 							}
// 						}
// 						return includeFile.every(
// 							(condition) => condition === true,
// 						);
// 					},
// 				);

// 				if (matchingFiles.length > 0) {
// 					const dateDelta = matchingFiles.reduce(
// 						(total, [_, fileData]) =>
// 							total + (fileData.current - fileData.initial),
// 						0,
// 					);

// 					if (dateDelta !== 0) {
// 						filteredStats[date] = {
// 							totalDelta: dateDelta,
// 							files: Object.fromEntries(matchingFiles),
// 						};
// 					}
// 				}
// 			});

// 			const container = el.createDiv("heatmap-codeblock");
// 			const root = createRoot(container);
// 			this.codeBlockRoots.set(el, { root, ctx, source });

// 			root.render(
// 				React.createElement(Heatmap, {
// 					data: filteredStats,
// 					intensityLevels: this.pluginData.settings.intensityLevels,
// 					...toggles,
// 					plugin: this,
// 				}),
// 			);

// 			ctx.addChild(
// 				new (class extends MarkdownRenderChild {
// 					constructor(containerEl: HTMLElement) {
// 						super(containerEl);
// 					}
// 					onunload() {
// 						root.unmount();
// 					}
// 				})(container),
// 			);
// 		};
// 	}

// 	private refreshAllCodeBlocks() {
// 		for (const [
// 			el,
// 			{ root, ctx, source },
// 		] of this.codeBlockRoots.entries()) {
// 			el.style.minHeight = el.innerHeight + "px";
// 			el.empty();
// 			this.createCodeBlockProcessor()(source, el, ctx);
// 			el.style.minHeight = "unset";
// 		}
// 	}

// 	get settings() {
// 		return this.pluginData.settings;
// 	}

// 	private applyColorStyles() {
// 		const container = this.app.workspace.containerEl;
// 		const { light, dark } = this.pluginData.settings.colors;
// 		const style = container.style;

// 		const levels = [
// 			"level_0",
// 			"level_1",
// 			"level_2",
// 			"level_3",
// 			"level_4",
// 		] as const;

// 		levels.forEach((level) => {
// 			style.setProperty(`--light-${level}`, light[level]);
// 			style.setProperty(`--dark-${level}`, dark[level]);
// 		});
// 	}

// 	private setDeviceId() {
// 		let id = localStorage.getItem("ktr-device-id");
// 		if (!id) {
// 			id = uuidv4();
// 			localStorage.setItem("ktr-device-id", id);
// 		}
// 		this.deviceId = id;
// 	}

// 	async onExternalSettingsChange() {
// 		try {
// 			const externalData = (await this.loadData()) as PluginData | null;

// 			if (!externalData?.devices) {
// 				console.warn(
// 					"External data is null, undefined, or missing devices",
// 				);
// 				return;
// 			}

// 			Object.entries(externalData.devices).forEach(
// 				([deviceId, deviceData]) => {
// 					if (deviceId !== this.deviceId) {
// 						this.pluginData.devices[deviceId] = deviceData;
// 					}
// 				},
// 			);

// 			this.pluginData.settings = Object.assign(
// 				{},
// 				DEFAULT_SETTINGS,
// 				this.pluginData.settings,
// 				externalData?.settings ?? {},
// 			);

// 			await this.updateAndSave();
// 		} catch (error) {
// 			console.error("Error in onExternalSettingsChange:", error);
// 		}
// 	}

// 	private createSettingsTab() {
// 		const pluginWithSettings = {
// 			...this,
// 			settings: this.pluginData.settings,
// 		};

// 		this.addSettingTab(
// 			new SettingsTab(this.app, this, {
// 				intensityLevels: this.pluginData.settings.intensityLevels,
// 				showOverview: this.pluginData.settings.showOverview,
// 				showEntries: this.pluginData.settings.showEntries,
// 				showHeatmap: this.pluginData.settings.showHeatmap,
// 				colors: this.pluginData.settings.colors,
// 				enabledScripts: this.pluginData.settings.enabledScripts,
// 				onIntensityLevelsChange: (newLevels) => {
// 					this.pluginData.settings.intensityLevels = newLevels;
// 					this.updateAndSave();
// 				},
// 				onShowOverviewChange: (newShowOverview) => {
// 					this.pluginData.settings.showOverview = newShowOverview;
// 					this.updateAndSave();
// 				},
// 				onShowEntriesChange: (newShowEntries) => {
// 					this.pluginData.settings.showEntries = newShowEntries;
// 					this.updateAndSave();
// 				},
// 				onShowHeatmapChange: (newShowHeatmap) => {
// 					this.pluginData.settings.showHeatmap = newShowHeatmap;
// 					this.updateAndSave();
// 				},
// 				onColorsChange: (newColors) => {
// 					this.pluginData.settings.colors = newColors;
// 					this.applyColorStyles();
// 					this.updateAndSave();
// 				},
// 				onEnabledScriptsChange: (newEnabledScripts) => {
// 					this.pluginData.settings.enabledScripts = newEnabledScripts;
// 					this.regex = createRegex(this.settings.enabledScripts);
// 					this.updateAndSave();
// 				},
// 			}),
// 		);
// 	}

// 	public getDeviceData(date: string) {
// 		if (!this.pluginData.devices[this.deviceId]) {
// 			this.setDeviceId();
// 			this.update();
// 		}
// 		if (!this.pluginData.devices[this.deviceId][date]) {
// 			this.pluginData.devices[this.deviceId][date] = {
// 				totalDelta: 0,
// 				files: {},
// 			};
// 		}
// 		return this.pluginData.devices[this.deviceId][date];
// 	}

// 	private async initializePluginData() {
// 		const loadedData = await this.loadData();
// 		this.pluginData = {
// 			settings: Object.assign(
// 				{},
// 				DEFAULT_SETTINGS,
// 				loadedData?.settings ?? {},
// 			),
// 			devices: loadedData?.devices ?? {
// 				[this.deviceId]: {},
// 			},
// 		};
// 		await this.updateAndSave();
// 	}

// 	private async update() {
// 		await this.saveData(this.pluginData);
// 		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
// 			if (leaf.view instanceof WordCountView) {
// 				leaf.view.refresh();
// 			}
// 		});
// 	}

// 	private async restoreDataFromPreviousVersions() {
// 		const path = ".obsidian";

// 		const files = await this.app.vault.adapter.list(path);
// 		const deviceFiles = files.files.filter(
// 			(f) =>
// 				f.startsWith(`${path}/keep-the-rhythm-`) ||
// 				f.startsWith(`${path}/ktr-`),
// 		);

// 		if (deviceFiles.length === 0) {
// 			new Notice(
// 				"No previous data was found, contact the developer if you need more help!",
// 			);
// 		}

// 		const newDeviceSet: deviceStats = {};

// 		for (const file of deviceFiles) {
// 			const restoredData: Stats = {};
// 			try {
// 				const content = await this.app.vault.adapter.read(file);
// 				const parsedData = JSON.parse(content);

// 				const newDeviceName = "restored" + parsedData.deviceId;

// 				if (this.pluginData.devices[newDeviceName]) {
// 					new Notice(
// 						`Data from "${parsedData.deviceId}" of the files was already restored. If you think this is an error, contact the developer.`,
// 					);
// 					continue;
// 				}

// 				Object.entries(parsedData.dailyCounts).forEach(
// 					([date, value]) => {
// 						restoredData[date] = value as {
// 							totalDelta: number;
// 							files: {
// 								[filePath: string]: FileWordCount;
// 							};
// 						};
// 					},
// 				);

// 				newDeviceSet[newDeviceName] = restoredData;
// 			} catch (fileError) {
// 				new Notice(
// 					"Previous data couldn't be restored! Contact the plugin developer (Ezben) for help.",
// 				);
// 				console.error(`Error restoring data from ${file}:`, fileError);
// 			}
// 		}
// 		this.pluginData.devices = {
// 			...this.pluginData.devices,
// 			...newDeviceSet,
// 		};

// 		await this.updateAndSave();
// 		const recoveredFiles = Object.keys(newDeviceSet).length;
// 		if (recoveredFiles) {
// 			new Notice(`Data from ${recoveredFiles} files was recovered!`);
// 		}
// 	}

// 	public async updateAndSave() {
// 		await this.mergeDevicesData();
// 		await this.update();
// 		this.refreshAllCodeBlocks();
// 	}

// 	async activateView() {
// 		const { workspace } = this.app;
// 		if (workspace.getLeavesOfType(VIEW_TYPE).length > 0) {
// 			return;
// 		}
// 		const leaf = workspace.getRightLeaf(false);
// 		if (leaf) {
// 			await leaf.setViewState({
// 				type: VIEW_TYPE,
// 				active: true,
// 			});
// 		}
// 	}

// 	async onload() {
// 		await this.initializePluginData();

// 		const processor = this.createCodeBlockProcessor();
// 		this.registerMarkdownCodeBlockProcessor("keep-the-rhythm", processor);

// 		this.setDeviceId();
// 		this.createSettingsTab();
// 		this.applyColorStyles();

// 		this.addCommand({
// 			id: "open-keep-the-rhythm",
// 			name: "Open tracking heatmap",
// 			callback: () => {
// 				this.activateView();
// 			},
// 		});

// 		this.registerView(VIEW_TYPE, (leaf) => {
// 			this.view = new WordCountView(leaf, this);
// 			return this.view;
// 		});

// 		this.addRibbonIcon("calendar-days", "Word Count Stats", () => {
// 			this.activateView();
// 		});

// 		this.registerEvent(
// 			this.app.workspace.on("active-leaf-change", (leaf) => {
// 				if (!leaf) {
// 					return;
// 				}
// 				const view = leaf.view;
// 				if (view instanceof MarkdownView) {
// 					const file = view.file;
// 					if (file instanceof TFile) {
// 						handleFileOpen(this, file);
// 					}
// 				}
// 			}),
// 		);

// 		this.debouncedHandleModify = debounce(
// 			(file: TFile) => handleFileModify(this, file),
// 			1000,
// 			false,
// 		);

// 		this.registerEvent(
// 			this.app.vault.on("modify", (file: TAbstractFile) => {
// 				if (file instanceof TFile) {
// 					this.debouncedHandleModify(file);
// 				}
// 			}),
// 		);

// 		this.registerEvent(
// 			this.app.vault.on(
// 				"rename",
// 				(file: TAbstractFile, oldPath: string) => {
// 					if (file instanceof TFile) {
// 						handleFileRename(this, file, oldPath);
// 					}
// 				},
// 			),
// 		);

// 		this.registerEvent(
// 			this.app.vault.on("delete", (file: TAbstractFile) => {
// 				if (file instanceof TFile) {
// 					handleFileDelete(this, file);
// 				}
// 			}),
// 		);
// 	}

// 	async mergeDevicesData() {
// 		const mergedData: Stats = {};

// 		Object.entries(this.pluginData.devices).forEach(
// 			([deviceId, deviceData]) => {
// 				Object.entries(deviceData).forEach(([date, data]) => {
// 					if (!mergedData[date]) {
// 						mergedData[date] = {
// 							totalDelta: 0,
// 							files: {},
// 						};
// 					}

// 					mergedData[date].totalDelta += data.totalDelta;

// 					Object.entries(data.files).forEach(
// 						([filePath, fileCount]) => {
// 							if (mergedData[date].files[filePath]) {
// 								mergedData[date].files[filePath] = {
// 									initial: Math.min(
// 										mergedData[date].files[filePath]
// 											.initial,
// 										fileCount.initial,
// 									),
// 									current: Math.max(
// 										mergedData[date].files[filePath]
// 											.current,
// 										fileCount.current,
// 									),
// 								};
// 							} else {
// 								mergedData[date].files[filePath] = {
// 									...fileCount,
// 								};
// 							}
// 						},
// 					);
// 				});
// 			},
// 		);

// 		this.mergedStats = mergedData;
// 	}

// 	async onunload() {
// 		const style = this.app.workspace.containerEl.style;
// 		const levels = [
// 			"level_0",
// 			"level_1",
// 			"level_2",
// 			"level_3",
// 			"level_4",
// 		] as const;

// 		levels.forEach((level) => {
// 			style.removeProperty(`--light-${level}`);
// 			style.removeProperty(`--dark-${level}`);
// 		});
// 	}

// 	public handleDeleteEntry(filePath: string) {
// 		new ConfirmationModal(this.app, filePath, () => {
// 			this.deleteEntry(filePath); // Call the actual delete method after confirmation
// 		}).open();
// 	}

// 	private deleteEntry(filePath: string) {
// 		const todayStr = formatDate(new Date());

// 		const deviceData = this.pluginData.devices[this.deviceId];
// 		if (!deviceData) {
// 			console.warn("No device data found for today.");
// 			return;
// 		}

// 		const todayData = deviceData[todayStr];
// 		if (!todayData || !todayData.files) {
// 			console.warn("No data found for today.");
// 			return;
// 		}

// 		delete todayData.files[filePath];
// 		todayData.totalDelta = Object.values(todayData.files).reduce(
// 			(total, fileData) => total + (fileData.current - fileData.initial),
// 			0,
// 		);

// 		this.updateAndSave(); // Save the updated data after deletion
// 	}
// }

// import { Modal, App, ButtonComponent } from "obsidian";

// class ConfirmationModal extends Modal {
// 	private onConfirm: () => void;
// 	private filePath: string;

// 	constructor(app: App, filePath: string, onConfirm: () => void) {
// 		super(app);
// 		this.filePath = filePath;
// 		this.onConfirm = onConfirm;
// 	}

// 	onOpen() {
// 		const { contentEl } = this;
// 		this.containerEl.classList.add("KTR__modal");

// 		this.setTitle("Are you sure?");

// 		contentEl.createEl("p", {
// 			text: `Do you really want to delete the entry for this file?`,
// 		});

// 		contentEl.createEl("p", {
// 			text: `${this.filePath}`,
// 			cls: "KTR__file-to-delete",
// 		});

// 		contentEl.createEl("p", {
// 			text: `This action is irreversible!`,
// 		});

// 		const buttonsContainer = contentEl.createDiv("KTR__modal-buttons");

// 		new ButtonComponent(buttonsContainer)
// 			.setButtonText("Cancel")
// 			.onClick(() => {
// 				this.close();
// 			});

// 		new ButtonComponent(buttonsContainer)
// 			.setButtonText("Yes, Delete")
// 			.setClass("mod-warning")
// 			.onClick(() => {
// 				this.onConfirm();
// 				this.close();
// 			});
// 	}

// 	onClose() {
// 		const { contentEl } = this;
// 		contentEl.empty();
// 	}
// }
